using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using StudySpace.Api.Infrastructure;

namespace StudySpace.Api.Codex;

public static class CodexBridge
{
    public static async Task<bool> CheckHealthAsync()
    {
        try
        {
            var file = Environment.GetEnvironmentVariable("STUDY_CODEX_BRIDGE_TOKEN_FILE");
            if (string.IsNullOrEmpty(file)) return false;
            var token = (await File.ReadAllTextAsync(file)).Trim();
            using var client = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(5) };
            using var request = new HttpRequestMessage(HttpMethod.Get, "http://127.0.0.1:8080/health");
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            using var response = await client.SendAsync(request);
            return response.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    public static async Task RunAsync(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 12 * 1024 * 1024);
        var tokenFile = builder.Configuration["STUDY_CODEX_BRIDGE_TOKEN_FILE"] ?? throw new InvalidOperationException("The bridge token file is required.");
        var token = (await File.ReadAllTextAsync(tokenFile)).Trim();
        if (token.Length is < 32 or > 256) throw new InvalidOperationException("The bridge token is invalid.");
        var expected = SHA256.HashData(Encoding.UTF8.GetBytes("Bearer " + token));
        builder.Services.AddSingleton<ICodexRpc, CodexProcess>();
        builder.Services.AddSingleton<ICodexRuntime, CodexRuntime>();
        var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            var supplied = context.Request.Headers.Authorization.ToString();
            if (supplied.Length > 300 || !CryptographicOperations.FixedTimeEquals(expected, SHA256.HashData(Encoding.UTF8.GetBytes(supplied))))
            { context.Response.StatusCode = 401; return; }
            try { await next(context); }
            catch (Exception error)
            {
                if (context.Response.HasStarted) { context.Abort(); return; }
                context.Response.StatusCode = error is ApiFailure api ? api.Status : error is ArgumentException ? 400 : 503;
                await context.Response.WriteAsJsonAsync(new { message = "Codex could not complete this request." });
            }
        });
        app.MapStudyCodex();
        app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
        app.MapPost("/internal/generate", async (CodexGenerationRequest request, ICodexRuntime runtime, HttpContext context) =>
        {
            context.Response.ContentType = "application/x-ndjson";
            await foreach (var delta in runtime.GenerateAsync(request.Prompt, request.OutputSchema, context.RequestAborted, request.Images))
            {
                await context.Response.WriteAsync(JsonSerializer.Serialize(delta, new JsonSerializerOptions(JsonSerializerDefaults.Web)) + "\n", context.RequestAborted);
                await context.Response.Body.FlushAsync(context.RequestAborted);
            }
        });
        await app.RunAsync();
    }
}
