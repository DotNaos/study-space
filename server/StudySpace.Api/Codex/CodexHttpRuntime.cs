using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;

namespace StudySpace.Api.Codex;

public sealed class CodexHttpRuntime(IHttpClientFactory clients, IConfiguration config) : ICodexRuntime
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, object? body, CancellationToken ct)
    {
        var url = config["STUDY_CODEX_BRIDGE_URL"];
        var tokenFile = config["STUDY_CODEX_BRIDGE_TOKEN_FILE"];
        if (!Uri.TryCreate(url, UriKind.Absolute, out var origin) || origin.Scheme is not ("http" or "https") ||
            !string.IsNullOrEmpty(origin.UserInfo) || string.IsNullOrEmpty(tokenFile)) throw new CodexUnavailableException();
        string token;
        try { token = (await File.ReadAllTextAsync(tokenFile, ct)).Trim(); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { throw new CodexUnavailableException(); }
        if (token.Length < 32 || token.Length > 256) throw new CodexUnavailableException();
        using var request = new HttpRequestMessage(method, new Uri(origin, path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (body is not null) request.Content = JsonContent.Create(body, options: CodexPolicy.WireJson);
        var response = await clients.CreateClient("codex-bridge").SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) { response.Dispose(); throw new CodexUnavailableException(); }
        return response;
    }

    private async Task<T> ReadJsonAsync<T>(HttpMethod method, string path, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(35));
        using var response = await SendAsync(method, path, null, deadline.Token);
        await response.Content.LoadIntoBufferAsync(64_000, deadline.Token);
        return await response.Content.ReadFromJsonAsync<T>(Json, deadline.Token) ?? throw new CodexUnavailableException();
    }

    public async Task<CodexConnection> ReadAsync(CancellationToken ct)
    {
        try { return await ReadJsonAsync<CodexConnection>(HttpMethod.Get, "/api/codex", ct); }
        catch (Exception error) when (error is not OperationCanceledException || !ct.IsCancellationRequested)
        { return new("unavailable", Message: "The Codex connection is unavailable. Try again shortly."); }
    }
    public Task<CodexLogin> StartLoginAsync(CancellationToken ct) => ReadJsonAsync<CodexLogin>(HttpMethod.Post, "/api/codex/login", ct);
    public Task<CodexLogin> ReadLoginAsync(string id, CancellationToken ct) => ReadJsonAsync<CodexLogin>(HttpMethod.Get, "/api/codex/login/" + Uri.EscapeDataString(id), ct);
    public async Task CancelLoginAsync(string id, CancellationToken ct)
    { await DeleteAsync("/api/codex/login/" + Uri.EscapeDataString(id), ct); }
    public async Task LogoutAsync(CancellationToken ct)
    { await DeleteAsync("/api/codex", ct); }

    private async Task DeleteAsync(string path, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(35));
        using var response = await SendAsync(HttpMethod.Delete, path, null, deadline.Token);
    }

    public async IAsyncEnumerable<CodexDelta> GenerateAsync(string prompt, JsonElement? outputSchema, [EnumeratorCancellation] CancellationToken ct, IReadOnlyList<CodexImage>? images = null)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(CodexPolicy.GenerationTimeout + TimeSpan.FromSeconds(10));
        var validatedImages = CodexImages.Validate(images);
        using var response = await SendAsync(HttpMethod.Post, "/internal/generate", new CodexGenerationRequest(prompt, outputSchema, validatedImages), deadline.Token);
        using var stream = new StreamReader(await response.Content.ReadAsStreamAsync(deadline.Token));
        var count = 0;
        var completed = false;
        await foreach (var line in CodexProcess.ReadLinesAsync(stream, deadline.Token))
        {
            var delta = JsonSerializer.Deserialize<CodexDelta>(line, Json) ?? throw new CodexUnavailableException();
            if (completed || delta.Type is not ("text" or "completed")) throw new CodexUnavailableException();
            count += delta.Text?.Length ?? 0;
            if (count > CodexPolicy.MaximumOutputCharacters * 2) throw new CodexUnavailableException();
            completed = delta.Type == "completed";
            yield return delta;
        }
        if (!completed) throw new CodexUnavailableException();
    }
}
