using System.IO.Pipelines;
using System.Text;
using StudySpace.Api.Codex;

namespace StudySpace.Api.Tests;

public sealed class CodexLineTests
{
    [Theory]
    [InlineData(32)]
    [InlineData(1024)]
    [InlineData(2048)]
    [InlineData(4096)]
    public async Task CompleteRecordIsDeliveredBeforePersistentConnectionCloses(int bytes)
    {
        var pipe = new Pipe();
        using var stream = new StreamReader(pipe.Reader.AsStream());
        using var cancellation = new CancellationTokenSource();
        await using var lines = CodexProcess.ReadLinesAsync(stream, cancellation.Token).GetAsyncEnumerator();
        var next = lines.MoveNextAsync().AsTask();
        try
        {
            await pipe.Writer.WriteAsync(Encoding.UTF8.GetBytes(new string('x', bytes - 1) + "\n"));
            Assert.True(await next.WaitAsync(TimeSpan.FromSeconds(2)));
            Assert.Equal(bytes - 1, lines.Current.Length);
        }
        finally
        {
            await cancellation.CancelAsync();
            await pipe.Writer.CompleteAsync();
            try { await next; } catch (OperationCanceledException) { }
        }
    }

    [Fact] public async Task Utf8SplitAcrossByteReadsIsPreserved()
    {
        var text = new string('x', 4095) + "🧬 Grüße";
        using var stream = new StreamReader(new MemoryStream(Encoding.UTF8.GetBytes(text + "\n")));
        var result = new List<string>();
        await foreach (var line in CodexProcess.ReadLinesAsync(stream, default)) result.Add(line);
        Assert.Equal([text], result);
    }

    [Fact] public async Task LargerRpcEnvelopeDoesNotRaiseTheOutputLineLimit()
    {
        var bytes = Encoding.UTF8.GetBytes(new string('x', CodexPolicy.MaximumLineCharacters + 1) + "\n");
        using (var output = new StreamReader(new MemoryStream(bytes)))
            await Assert.ThrowsAsync<CodexUnavailableException>(async () => { await foreach (var _ in CodexProcess.ReadLinesAsync(output, default)) { } });
        using var rpc = new StreamReader(new MemoryStream(bytes));
        var count = 0;
        await foreach (var line in CodexProcess.ReadLinesAsync(rpc, default, CodexPolicy.MaximumRpcLineCharacters)) count = line.Length;
        Assert.Equal(CodexPolicy.MaximumLineCharacters + 1, count);
    }
}
