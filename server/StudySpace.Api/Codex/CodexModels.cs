using System.Text.Json;

namespace StudySpace.Api.Codex;

public sealed record CodexConnection(string Status, string? AccountLabel = null, CodexLogin? Login = null, string? Message = null);
public sealed record CodexLogin(string Id, string UserCode, string VerificationUrl, DateTimeOffset ExpiresAt, string Status);
public sealed record CodexDelta(string Type, string? Text = null);
public sealed record CodexImage(string MimeType, string Base64);
public sealed record CodexGenerationRequest(string Prompt, JsonElement? OutputSchema, IReadOnlyList<CodexImage>? Images = null);

public interface ICodexRuntime
{
    Task<CodexConnection> ReadAsync(CancellationToken ct);
    Task<CodexLogin> StartLoginAsync(CancellationToken ct);
    Task<CodexLogin> ReadLoginAsync(string id, CancellationToken ct);
    Task CancelLoginAsync(string id, CancellationToken ct);
    Task LogoutAsync(CancellationToken ct);
    IAsyncEnumerable<CodexDelta> GenerateAsync(string prompt, JsonElement? outputSchema, CancellationToken ct, IReadOnlyList<CodexImage>? images = null);
}

public interface ICodexRpc : IAsyncDisposable
{
    event Action<JsonElement>? Notification;
    Task<JsonElement> CallAsync(string method, object parameters, CancellationToken ct);
    void Abort();
}

public sealed class CodexUnavailableException : Exception
{
    public CodexUnavailableException() : base("Codex could not complete this request. Check the connection and try again.") { }
}
