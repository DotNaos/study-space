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
            await current.StandardInput.WriteLineAsync(JsonSerializer.Serialize(value, CodexPolicy.WireJson).AsMemory(), ct);
            await current.StandardInput.FlushAsync(ct);
        }
        finally { writes.Release(); }
    }

    private async Task PumpAsync(Process current)
    {
        try
        {
            await foreach (var line in ReadLinesAsync(current.StandardOutput, CancellationToken.None, CodexPolicy.MaximumRpcLineCharacters))
            {
                using var document = JsonDocument.Parse(line);
                var message = document.RootElement;
                if (message.TryGetProperty("method", out _))
                {
                    // A server request is never a client response, even when its id collides.
                    // No approvals or tool calls are supported. Terminating fails closed.
                    if (message.TryGetProperty("id", out _)) throw new CodexUnavailableException();
                    // Codex echoes inline image bytes in userMessage items. They
                    // are our own bounded inputs, not model output or tool activity.
                    // Discard the echo before cloning or queueing notifications.
                    if (IsInputEcho(message)) continue;
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

    private static bool IsInputEcho(JsonElement message) =>
        message.GetProperty("method").GetString() is "item/started" or "item/completed" &&
        message.TryGetProperty("params", out var parameters) && parameters.TryGetProperty("item", out var item) &&
        item.TryGetProperty("type", out var type) && type.GetString() == "userMessage";

    public static async IAsyncEnumerable<string> ReadLinesAsync(StreamReader stream, [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct,
        int maximumCharacters = CodexPolicy.MaximumLineCharacters)
    {
        if (maximumCharacters is < 1 or > CodexPolicy.MaximumRpcLineCharacters) throw new ArgumentOutOfRangeException(nameof(maximumCharacters));
        var bytes = new byte[4096];
        var characters = new char[4097];
        var decoder = new UTF8Encoding(false, true).GetDecoder();
        var line = new StringBuilder();
        var firstCharacter = true;
        while (true)
        {
            // StreamReader.ReadAsync can wait for another read after receiving an
            // exact internal buffer. A byte-stream read returns available bytes,
            // letting complete NDJSON records through while the connection stays open.
            var count = await stream.BaseStream.ReadAsync(bytes.AsMemory(), ct);
            var decoded = decoder.GetChars(bytes.AsSpan(0, count), characters.AsSpan(), flush: count == 0);
            for (var index = 0; index < decoded; index++)
            {
                var character = characters[index];
                if (firstCharacter) { firstCharacter = false; if (character == '\uFEFF') continue; }
                if (character == '\n') { yield return line.ToString().TrimEnd('\r'); line.Clear(); }
                else
                {
                    if (line.Length >= maximumCharacters) throw new CodexUnavailableException();
                    line.Append(character);
                }
            }
            if (count == 0) break;
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
        // Lazy startup calls Abort to clear stale state. A missing process is not
        // a failure event for a generation that subscribed before its first RPC.
        if (current is not null)
            Notification?.Invoke(JsonSerializer.SerializeToElement(new { method = "study/process-stopped", @params = new { } }));
    }

    public async ValueTask DisposeAsync()
    {
        Abort();
        try { await Task.WhenAll(reader ?? Task.CompletedTask, stderr ?? Task.CompletedTask).WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        lifecycle.Dispose(); writes.Dispose();
    }
}
