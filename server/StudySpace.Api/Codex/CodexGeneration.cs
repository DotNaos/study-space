using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace StudySpace.Api.Codex;

public sealed class CodexGeneration(ICodexRpc rpc) : IDisposable
{
    private readonly SemaphoreSlim active = new(1);

    public async IAsyncEnumerable<CodexDelta> RunAsync(string prompt, JsonElement? schema, [EnumeratorCancellation] CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(prompt) || prompt.Length > CodexPolicy.MaximumPromptCharacters ||
            (schema?.GetRawText().Length ?? 0) > 64_000) throw new ArgumentException("The generation request is too large or empty.");
        if (!await active.WaitAsync(0, ct)) throw new InvalidOperationException("Codex is already generating study material.");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(CodexPolicy.GenerationTimeout);
        var events = Channel.CreateBounded<JsonElement>(new BoundedChannelOptions(512) { SingleReader = true, SingleWriter = false });
        string? threadId = null;
        string? turnId = null;
        var completed = false;
        var queuedCharacters = 0;
        void Receive(JsonElement message)
        {
            var method = message.GetProperty("method").GetString();
            if (method is not ("study/process-stopped" or "turn/completed" or "item/agentMessage/delta" or "item/started" or "item/completed")) return;
            if (Interlocked.Add(ref queuedCharacters, message.GetRawText().Length) > CodexPolicy.MaximumLineCharacters || !events.Writer.TryWrite(message))
                events.Writer.TryComplete(new CodexUnavailableException());
        }
        rpc.Notification += Receive;
        try
        {
            var account = await rpc.CallAsync("account/read", new { refreshToken = false }, deadline.Token);
            if (!account.TryGetProperty("account", out var accountValue) || accountValue.ValueKind != JsonValueKind.Object ||
                accountValue.GetProperty("type").GetString() != "chatgpt") throw new CodexUnavailableException();
            var thread = await rpc.CallAsync("thread/start", CodexPolicy.ThreadStart(), deadline.Token);
            threadId = thread.GetProperty("thread").GetProperty("id").GetString() ?? throw new CodexUnavailableException();
            var turn = await rpc.CallAsync("turn/start", CodexPolicy.TurnStart(threadId, prompt, schema), deadline.Token);
            turnId = turn.GetProperty("turn").GetProperty("id").GetString() ?? throw new CodexUnavailableException();
            var text = new StringBuilder();
            string? authoritative = null;
            await foreach (var message in events.Reader.ReadAllAsync(deadline.Token))
            {
                Interlocked.Add(ref queuedCharacters, -message.GetRawText().Length);
                var method = message.GetProperty("method").GetString();
                if (method == "study/process-stopped") throw new CodexUnavailableException();
                if (!message.TryGetProperty("params", out var parameters) ||
                    !parameters.TryGetProperty("threadId", out var eventThread) || eventThread.GetString() != threadId) continue;
                if (method == "turn/completed")
                {
                    var finalTurn = parameters.GetProperty("turn");
                    if (finalTurn.GetProperty("id").GetString() != turnId) continue;
                    if (finalTurn.GetProperty("status").GetString() != "completed") throw new CodexUnavailableException();
                    var output = authoritative ?? text.ToString();
                    if (string.IsNullOrWhiteSpace(output)) throw new CodexUnavailableException();
                    completed = true;
                    yield return new("completed", output);
                    yield break;
                }
                if (!parameters.TryGetProperty("turnId", out var eventTurn) || eventTurn.GetString() != turnId) continue;
                if (method == "item/agentMessage/delta")
                {
                    var delta = parameters.GetProperty("delta").GetString() ?? "";
                    if (text.Length + delta.Length > CodexPolicy.MaximumOutputCharacters) throw new CodexUnavailableException();
                    text.Append(delta);
                    yield return new("text", delta);
                }
                if (method is "item/started" or "item/completed")
                {
                    var item = parameters.GetProperty("item");
                    var itemType = item.GetProperty("type").GetString();
                    if (itemType is not ("agentMessage" or "reasoning" or "userMessage")) throw new CodexUnavailableException();
                    if (method != "item/completed" || itemType != "agentMessage") continue;
                    authoritative = item.GetProperty("text").GetString();
                    if (authoritative?.Length > CodexPolicy.MaximumOutputCharacters) throw new CodexUnavailableException();
                }
            }
            throw new CodexUnavailableException();
        }
        finally
        {
            rpc.Notification -= Receive;
            events.Writer.TryComplete();
            if (!completed)
            {
                if (threadId is not null && turnId is not null)
                {
                    using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    try { await rpc.CallAsync("turn/interrupt", new { threadId, turnId }, stop.Token); } catch { }
                }
            }
            // Ephemeral threads are never persisted; dropping their process also bounds retained memory.
            rpc.Abort();
            active.Release();
        }
    }

    public void Dispose() => active.Dispose();
}
