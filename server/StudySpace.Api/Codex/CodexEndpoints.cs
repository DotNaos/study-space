using System.Text.Json;
using StudySpace.Api.Infrastructure;

namespace StudySpace.Api.Codex;

public static class CodexEndpoints
{
    public static IServiceCollection AddStudyCodex(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddHttpClient("codex-bridge", client => client.Timeout = Timeout.InfiniteTimeSpan)
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false }).RemoveAllLoggers();
        services.AddSingleton<ICodexRuntime, CodexHttpRuntime>();
        return services;
    }

    public static void MapStudyCodex(this WebApplication app)
    {
        var routes = app.MapGroup("/api/codex");
        routes.AddEndpointFilter(async (context, next) =>
        {
            try { return await next(context); }
            catch (KeyNotFoundException) { throw new ApiFailure("codex_login_not_found", "The sign-in request was not found. Start again.", 404); }
            catch (OperationCanceledException) when (!context.HttpContext.RequestAborted.IsCancellationRequested)
            { throw new ApiFailure("codex_timeout", "Codex took too long to respond. Try again.", 504); }
            catch (Exception error) when (error is CodexUnavailableException or HttpRequestException or JsonException or InvalidOperationException)
            { throw new ApiFailure("codex_unavailable", "Codex could not complete this request. Check the connection and try again.", 503); }
        });
        routes.MapGet("", (ICodexRuntime runtime, CancellationToken ct) => runtime.ReadAsync(ct));
        routes.MapPost("/login", (ICodexRuntime runtime, CancellationToken ct) => runtime.StartLoginAsync(ct));
        routes.MapGet("/login/{id}", (string id, ICodexRuntime runtime, CancellationToken ct) => runtime.ReadLoginAsync(id, ct));
        routes.MapDelete("/login/{id}", async (string id, ICodexRuntime runtime, CancellationToken ct) =>
        { await runtime.CancelLoginAsync(id, ct); return Results.NoContent(); });
        routes.MapDelete("", async (ICodexRuntime runtime, CancellationToken ct) =>
        { await runtime.LogoutAsync(ct); return Results.NoContent(); });
    }
}
