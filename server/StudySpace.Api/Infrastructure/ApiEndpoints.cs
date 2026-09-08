using Microsoft.EntityFrameworkCore;
using StudySpace.Api.Data;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Infrastructure;

public static class ApiEndpoints
{
    public static void MapStudyApi(this WebApplication app)
    {
        app.MapGet("/health/live", () => Results.Ok(new { status = "alive" }));
        app.MapGet("/health/ready", async (StudyDb db, CancellationToken ct) =>
            await db.Database.CanConnectAsync(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));
        app.MapGet("/api/status", async (StudyDb db, IConfiguration config, CancellationToken ct) => Results.Ok(new
        {
            app = "study-space", version = config["STUDY_VERSION"] ?? "0.1.0-dev", commit = config["STUDY_COMMIT"] ?? "development",
            hostname = config["STUDY_HOSTNAME"] ?? Environment.MachineName, publicUrl = config["STUDY_PUBLIC_URL"] ?? "http://localhost:8080",
            database = await db.Database.CanConnectAsync(ct) ? "ready" : "unavailable"
        }));
        app.MapGet("/api/settings", async (StudyDb db, CancellationToken ct) =>
        { var settings = await db.Settings.AsNoTracking().SingleOrDefaultAsync(ct) ?? new AppSettings(); return Results.Ok(new { settings.DisplayName, settings.Locale }); });
        app.MapPut("/api/settings", async (SettingsRequest request, StudyDb db, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(request.DisplayName) || request.DisplayName.Length > 100 || request.Locale is not ("de" or "en"))
                throw new ApiFailure("settings_invalid", "Use a display name of 1–100 characters and select German or English.");
            var settings = await db.Settings.SingleOrDefaultAsync(ct);
            if (settings is null) { settings = new AppSettings(); db.Settings.Add(settings); }
            settings.DisplayName = request.DisplayName.Trim(); settings.Locale = request.Locale;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { settings.DisplayName, settings.Locale });
        });
        app.MapGet("/api/config", (ProjectConfigurationStore store, CancellationToken ct) => store.Read(ct));
        app.MapPut("/api/config", (ProjectConfiguration request, ProjectConfigurationStore store, CancellationToken ct) => store.Write(request, ct));
        var moodle = app.MapGroup("/api/providers/moodle").RequireRateLimiting("moodle");
        moodle.MapGet("", (MoodleService service, CancellationToken ct) => service.State(ct));
        moodle.MapPost("/discover", (SiteRequest request, MoodleService service, CancellationToken ct) => service.Discover(request.SiteUrl, ct));
        moodle.MapPost("/login/start", (LoginRequest request, MoodleService service, CancellationToken ct) => service.Start(request, ct));
        moodle.MapPost("/browser-return", (CompleteRequest request, MoodleService service, CancellationToken ct) => service.CompleteBrowserReturn(request, ct));
        moodle.MapGet("/login/{id}", (string id, MoodleService service) => service.Status(id));
        moodle.MapDelete("/login/{id}", async (string id, MoodleService service, CancellationToken ct) => { await service.Cancel(id, ct); return Results.NoContent(); });
        moodle.MapPost("/login/{id}/complete", (string id, CompleteRequest request, MoodleService service, CancellationToken ct) => service.Complete(id, request, ct));
        moodle.MapDelete("", async (MoodleService service, CancellationToken ct) => { await service.Disconnect(ct); return Results.NoContent(); });
        moodle.MapGet("/courses", (MoodleService service, CancellationToken ct) => service.Courses(ct));
        moodle.MapGet("/courses/{id:long}/contents", (long id, MoodleService service, CancellationToken ct) => service.Contents(id, ct));
    }
    public sealed record SettingsRequest(string DisplayName, string Locale);
}
