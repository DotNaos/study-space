using System.Text.Json;
using System.Text.RegularExpressions;

namespace StudySpace.Api.Codex;

public sealed partial class CodexRuntime : ICodexRuntime, IDisposable
{
    private readonly ICodexRpc rpc;
    private readonly SemaphoreSlim mutations = new(1);
    private readonly object sync = new();
    private CodexLogin? login;
    private string? providerLoginId;
    private (string Id, bool Success)? earlyCompletion;
    private bool startingLogin;
    private readonly CodexGeneration generation;

    public CodexRuntime(ICodexRpc rpc)
    {
        this.rpc = rpc;
        generation = new(rpc);
        rpc.Notification += OnNotification;
    }

    public async Task<CodexConnection> ReadAsync(CancellationToken ct)
    {
        try
        {
            var result = await rpc.CallAsync("account/read", new { refreshToken = false }, ct);
            if (result.TryGetProperty("account", out var account) && account.ValueKind == JsonValueKind.Object &&
                account.TryGetProperty("type", out var type) && type.GetString() == "chatgpt")
                return new("connected", "ChatGPT");
            lock (sync)
            {
                ExpireLogin();
                return login?.Status == "pending" ? new("pending", Login: login) : new("disconnected");
            }
        }
        catch (Exception error) when (error is not OperationCanceledException || !ct.IsCancellationRequested)
        { return new("unavailable", Message: "The Codex connection is unavailable. Try again shortly."); }
    }

    public async Task<CodexLogin> StartLoginAsync(CancellationToken ct)
    {
        await mutations.WaitAsync(ct);
        try
        {
            lock (sync) { ExpireLogin(); if (login?.Status == "pending") return login; }
            lock (sync) { startingLogin = true; earlyCompletion = null; }
            var result = await rpc.CallAsync("account/login/start", new { type = "chatgptDeviceCode" }, ct);
            var providerId = result.GetProperty("loginId").GetString();
            var url = result.GetProperty("verificationUrl").GetString();
            var code = result.GetProperty("userCode").GetString();
            if (result.GetProperty("type").GetString() != "chatgptDeviceCode" || string.IsNullOrWhiteSpace(providerId) ||
                url != "https://auth.openai.com/codex/device" || code is null || !DeviceCode().IsMatch(code))
            { rpc.Abort(); throw new CodexUnavailableException(); }
            lock (sync)
            {
                providerLoginId = providerId;
                login = new(Guid.NewGuid().ToString("N"), code, url, DateTimeOffset.UtcNow.AddMinutes(15), "pending");
                if (earlyCompletion?.Id == providerId) login = login with { Status = earlyCompletion.Value.Success ? "success" : "failed" };
                return login;
            }
        }
        finally { lock (sync) { startingLogin = false; earlyCompletion = null; } mutations.Release(); }
    }

    public Task<CodexLogin> ReadLoginAsync(string id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        lock (sync) { ExpireLogin(); return Task.FromResult(FindLogin(id)); }
    }

    public async Task CancelLoginAsync(string id, CancellationToken ct)
    {
        await mutations.WaitAsync(ct);
        try
        {
            string? providerId;
            lock (sync)
            {
                var found = FindLogin(id);
                if (found.Status != "pending") return;
                providerId = providerLoginId;
            }
            await rpc.CallAsync("account/login/cancel", new { loginId = providerId }, ct);
            lock (sync) { if (login?.Id == id) login = login with { Status = "cancelled" }; }
        }
        finally { mutations.Release(); }
    }

    public async Task LogoutAsync(CancellationToken ct)
    {
        await mutations.WaitAsync(ct);
        try
        {
            // Stop any active turn before revoking this application's isolated login.
            rpc.Abort();
            await rpc.CallAsync("account/logout", new { }, ct);
            lock (sync) { login = null; providerLoginId = null; }
        }
        finally { mutations.Release(); }
    }

    public IAsyncEnumerable<CodexDelta> GenerateAsync(string prompt, JsonElement? outputSchema, CancellationToken ct)
        => generation.RunAsync(prompt, outputSchema, ct);

    private CodexLogin FindLogin(string id) => login?.Id == id ? login : throw new KeyNotFoundException("The sign-in request was not found.");
    private void ExpireLogin()
    {
        if (login?.Status == "pending" && login.ExpiresAt <= DateTimeOffset.UtcNow) login = login with { Status = "expired" };
    }
    private void OnNotification(JsonElement message)
    {
        var method = message.GetProperty("method").GetString();
        lock (sync)
        {
            if (startingLogin && method == "account/login/completed")
            {
                var early = message.GetProperty("params");
                earlyCompletion = (early.GetProperty("loginId").GetString() ?? "", early.GetProperty("success").GetBoolean());
            }
            if (login?.Status != "pending") return;
            if (method == "study/process-stopped") { login = login with { Status = "failed" }; return; }
            if (method != "account/login/completed") return;
            var parameters = message.GetProperty("params");
            if (parameters.GetProperty("loginId").GetString() != providerLoginId) return;
            login = login with { Status = parameters.GetProperty("success").GetBoolean() ? "success" : "failed" };
        }
    }

    [GeneratedRegex("^[A-Z0-9-]{4,32}$", RegexOptions.CultureInvariant)] private static partial Regex DeviceCode();
    public void Dispose() { rpc.Notification -= OnNotification; mutations.Dispose(); generation.Dispose(); }
}
