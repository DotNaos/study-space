using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using StudySpace.Api.Data;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 16 * 1024);
var config = builder.Configuration;
builder.Services.AddDbContext<StudyDb>((services, options) => options.UseNpgsql(RuntimeConfiguration.Database(services.GetRequiredService<IConfiguration>())));
builder.Services.AddSingleton<IDataProtectionProvider>(services => RuntimeConfiguration.DataProtection(services.GetRequiredService<IConfiguration>()));
builder.Services.AddSingleton<CredentialStore>();
builder.Services.AddSingleton<ProjectConfigurationStore>();
builder.Services.AddSingleton<MoodleService>();
builder.Services.AddSingleton<MoodleImageService>();
builder.Services.AddSingleton<IMoodleImageTransport, MoodleImageTransport>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IMoodleTransport, MoodleTransport>();
builder.Services.AddHttpClient("moodle", client =>
{
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("StudySpace/0.1 (MoodleMobile)");
}).ConfigurePrimaryHttpMessageHandler(MoodleTransport.CreateHandler).RemoveAllLoggers();
builder.Services.AddProblemDetails();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.AddPolicy("moodle", _ => RateLimitPartition.GetFixedWindowLimiter("single-user", _ => new FixedWindowRateLimiterOptions
    { PermitLimit = 90, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    options.AddPolicy("moodle-images", _ => RateLimitPartition.GetFixedWindowLimiter("single-user-images", _ => new FixedWindowRateLimiterOptions
    { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.ForwardLimit = 1;
    // Loopback defaults remain; trust only the explicitly configured container gateway/proxy.
    if (IPAddress.TryParse(config["STUDY_TRUSTED_PROXY"], out var proxy)) options.KnownProxies.Add(proxy);
});
builder.Logging.AddFilter("Microsoft.AspNetCore.Hosting.Diagnostics", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore.Database.Command", LogLevel.Warning);
var app = builder.Build();
app.UseForwardedHeaders();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = context.Request.Path.StartsWithSegments("/api") ? "no-store" : "no-cache";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    try
    {
        if (context.Request.Path.StartsWithSegments("/api") && !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        {
            var expected = config["STUDY_PUBLIC_URL"] ?? "http://localhost:8080";
            var origin = context.Request.Headers.Origin.ToString();
            var fetchSite = context.Request.Headers["Sec-Fetch-Site"].ToString();
            if ((origin.Length > 0 && !OriginMatches(origin, expected)) || fetchSite is "cross-site" ||
                (origin.Length == 0 && fetchSite.Length > 0 && fetchSite != "same-origin"))
                throw new ApiFailure("origin_rejected", "Open Study Space at its configured address before making changes.", 403);
            if (context.Request.ContentLength > 0 && !context.Request.HasJsonContentType())
                throw new ApiFailure("json_required", "Send a JSON request.", 415);
        }
        await next(context);
    }
    catch (ApiFailure error) { await Failure(context, error.Status, error.Code, error.Message); }
    catch (BadHttpRequestException) { await Failure(context, 400, "request_invalid", "The request is invalid."); }
    catch (Exception error) when (error is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
    { await Failure(context, 502, "upstream_unavailable", "Moodle could not complete this request. Check the connection and try again."); }
    catch (Exception)
    { await Failure(context, 500, "server_error", "Study Space could not complete this request. Check server readiness and try again."); }
});
app.UseRateLimiter();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapStudyApi();
app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api") || context.Request.Path.StartsWithSegments("/health"))
    { await Failure(context, 404, "not_found", "This endpoint does not exist."); return; }
    var index = Path.Combine(app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot"), "index.html");
    if (File.Exists(index)) { context.Response.ContentType = "text/html"; await context.Response.SendFileAsync(index); }
    else await Failure(context, 503, "frontend_unavailable", "The Study Space web interface is not included in this build.");
});
if (config["STUDY_SKIP_MIGRATIONS"] != "true")
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<StudyDb>().Database.MigrateAsync();
}
app.Run();

static bool OriginMatches(string origin, string expected) => Uri.TryCreate(origin, UriKind.Absolute, out var left) &&
    Uri.TryCreate(expected, UriKind.Absolute, out var right) && left.GetLeftPart(UriPartial.Authority) == right.GetLeftPart(UriPartial.Authority) && left.AbsolutePath == "/" && left.Query == "";
static Task Failure(HttpContext context, int status, string code, string detail) => Results.Problem(statusCode: status, title: "Request could not be completed", detail: detail,
    extensions: new Dictionary<string, object?> { ["code"] = code }).ExecuteAsync(context);
public partial class Program;
