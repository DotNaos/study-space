using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace StudySpace.Api.Codex;

public sealed class CodexProcess(IConfiguration config) : ICodexRpc
{
    private readonly SemaphoreSlim lifecycle = new(1);
    private readonly SemaphoreSlim writes = new(1);
    private readonly ConcurrentDictionary<long, TaskCompletionSource<JsonElement>> pending = new();
    private Process? process;
    private long sequence;
    private Task? reader;
    private Task? stderr;
    public event Action<JsonElement>? Notification;

    public async Task<JsonElement> CallAsync(string method, object parameters, CancellationToken ct)
    {
        await lifecycle.WaitAsync(ct);
        try
        {
            if (process is null || process.HasExited)
            {
                Abort();
                var directory = config["STUDY_CODEX_PRIVATE_DIR"] ?? "/var/lib/study-codex";
                CodexPolicy.PrepareDirectory(directory);
                process = Process.Start(CodexPolicy.Process(config["STUDY_CODEX_BINARY"] ?? "/opt/codex/bin/codex", directory)) ?? throw new CodexUnavailableException();
                var current = process;
                reader = PumpAsync(current);
                stderr = DiscardAsync(current.StandardError);
                await RequestAsync("initialize", new { clientInfo = new { name = "study-space", title = "Study Space", version = "0.1.0" },
                    capabilities = new { experimentalApi = true, requestAttestation = false } }, ct);
                await WriteAsync(new { method = "initialized", @params = new { } }, ct);
            }
        }
        catch { Abort(); throw new CodexUnavailableException(); }
        finally { lifecycle.Release(); }
        return await RequestAsync(method, parameters, ct);
    }

    private async Task<JsonElement> RequestAsync(string method, object parameters, CancellationToken ct)
    {
        var id = Interlocked.Increment(ref sequence);
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            await WriteAsync(new { id, method, @params = parameters }, timeout.Token);
            return await completion.Task.WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) { Abort(); throw; }
        catch { throw new CodexUnavailableException(); }
        finally { pending.TryRemove(id, out _); }
    }

    private async Task WriteAsync(object value, CancellationToken ct)
    {
        await writes.WaitAsync(ct);
        try
        {
            var current = process ?? throw new CodexUnavailableException();
            await current.StandardInput.WriteLineAsync(JsonSerializer.Serialize(value).AsMemory(), ct);
            await current.StandardInput.FlushAsync(ct);
        }
        finally { writes.Release(); }
    }

    private async Task PumpAsync(Process current)
    {
        try
        {
            await foreach (var line in ReadLinesAsync(current.StandardOutput, CancellationToken.None))
            {
                using var document = JsonDocument.Parse(line);
                var message = document.RootElement;
                if (message.TryGetProperty("method", out _))
                {
                    // A server request is never a client response, even when its id collides.
                    // No approvals or tool calls are supported. Terminating fails closed.
                    if (message.TryGetProperty("id", out _)) throw new CodexUnavailableException();
                    Notification?.Invoke(message.Clone());
                }
                else if (message.TryGetProperty("id", out var id) && id.TryGetInt64(out var number) && pending.TryRemove(number, out var completion))
                {
                    if (message.TryGetProperty("error", out _) || !message.TryGetProperty("result", out var result)) completion.TrySetException(new CodexUnavailableException());
                    else completion.TrySetResult(result.Clone());
                }
            }
        }
        catch { /* Provider output and errors may contain private content. Never log them. */ }
        finally { if (ReferenceEquals(process, current)) Abort(); }
    }

    public static async IAsyncEnumerable<string> ReadLinesAsync(StreamReader stream, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        var buffer = new char[4096];
        var line = new StringBuilder();
        int count;
        while ((count = await stream.ReadAsync(buffer.AsMemory(), ct)) > 0)
        {
            for (var index = 0; index < count; index++)
            {
                if (buffer[index] == '\n') { yield return line.ToString().TrimEnd('\r'); line.Clear(); }
                else
                {
                    if (line.Length >= CodexPolicy.MaximumLineCharacters) throw new CodexUnavailableException();
                    line.Append(buffer[index]);
                }
            }
        }
        if (line.Length > 0) yield return line.ToString();
    }

    private static async Task DiscardAsync(StreamReader stream)
    {
        try { var buffer = new char[4096]; while (await stream.ReadAsync(buffer.AsMemory()) > 0) { } }
        catch { }
    }

    public void Abort()
    {
        var current = Interlocked.Exchange(ref process, null);
        if (current is not null)
        {
            try { if (!current.HasExited) current.Kill(entireProcessTree: true); }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception) { }
            finally { current.Dispose(); }
        }
        foreach (var item in pending) if (pending.TryRemove(item.Key, out var completion)) completion.TrySetException(new CodexUnavailableException());
        Notification?.Invoke(JsonSerializer.SerializeToElement(new { method = "study/process-stopped", @params = new { } }));
    }

    public async ValueTask DisposeAsync()
    {
        Abort();
        try { await Task.WhenAll(reader ?? Task.CompletedTask, stderr ?? Task.CompletedTask).WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        lifecycle.Dispose(); writes.Dispose();
    }
}
