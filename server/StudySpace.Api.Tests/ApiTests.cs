using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class ApiTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-api-" + Guid.NewGuid());
    [Fact] public async Task LivenessAndUnknownApiNeverReturnFrontend()
    {
        await using var app = Factory();
        using var client = app.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
        var unknown = await client.GetAsync("/api/not-a-route");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Equal("application/problem+json", unknown.Content.Headers.ContentType!.MediaType);
    }
    [Fact] public async Task CrossOriginAndSimpleFormMutationsAreRejected()
    {
        await using var app = Factory(); using var client = app.CreateClient();
        using var foreign = new HttpRequestMessage(HttpMethod.Post, "/api/providers/moodle/discover") { Content = JsonContent.Create(new { siteUrl = "https://moodle.example.test" }) };
        foreign.Headers.Add("Origin", "https://attacker.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(foreign)).StatusCode);
        var form = await client.PostAsync("/api/providers/moodle/discover", new FormUrlEncodedContent(new Dictionary<string, string> { ["siteUrl"] = "https://moodle.example.test" }));
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, form.StatusCode);
        using var fetch = new HttpRequestMessage(HttpMethod.Delete, "/api/providers/moodle");
        fetch.Headers.Add("Sec-Fetch-Site", "cross-site");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(fetch)).StatusCode);
    }
    [Fact] public async Task SameOriginValidationAndUnknownSessionsReturnSafeProblems()
    {
        await using var app = Factory(); using var client = app.CreateClient();
        client.DefaultRequestHeaders.Add("Origin", "https://study.example.test");
        var invalid = await client.PostAsJsonAsync("/api/providers/moodle/discover", new { siteUrl = "http://127.0.0.1" });
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Contains("site_invalid", await invalid.Content.ReadAsStringAsync());
        Assert.Equal("no-store", invalid.Headers.CacheControl!.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/providers/moodle/login/unknown")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync("/api/providers/moodle/login/unknown")).StatusCode);
        var browserReturn = await client.PostAsJsonAsync("/api/providers/moodle/browser-return", new { callbackUrl = "synthetic-invalid-return" });
        Assert.Equal(HttpStatusCode.NotFound, browserReturn.StatusCode);
        Assert.Contains("login_unknown", await browserReturn.Content.ReadAsStringAsync());
        Assert.DoesNotContain("synthetic-invalid-return", await browserReturn.Content.ReadAsStringAsync());
    }
    [Fact] public async Task ActivityDetailIsReadOnlyAndOnlyTheOwnedReaderIsEmbeddable()
    {
        await using var app = Factory(); using var client = app.CreateClient();
        var detail = await client.GetAsync("/api/providers/moodle/courses/7/modules/99");
        Assert.Equal(HttpStatusCode.Conflict, detail.StatusCode);
        Assert.Contains("moodle_disconnected", await detail.Content.ReadAsStringAsync());
        Assert.Equal("application/problem+json", detail.Content.Headers.ContentType!.MediaType);
        Assert.Equal("DENY", Assert.Single(detail.Headers.GetValues("X-Frame-Options")));
        var write = await client.PostAsync("/api/providers/moodle/courses/7/modules/99", null);
        Assert.False(write.IsSuccessStatusCode);
        var reader = await client.GetAsync("/reader.html");
        Assert.Equal("SAMEORIGIN", Assert.Single(reader.Headers.GetValues("X-Frame-Options")));
        var policy = Assert.Single(reader.Headers.GetValues("Content-Security-Policy"));
        Assert.Contains("frame-ancestors 'self'", policy);
        Assert.Contains("connect-src 'self'", policy);
        Assert.Contains("object-src 'none'", policy);
    }
    [Fact] public async Task ProtectedCredentialsSurviveHostRestartWithEncryptedKeyRing()
    {
        const string token = "syntheticRestartCredential12345678";
        await using (var first = Factory())
        {
            using var client = first.CreateClient();
            await first.Services.GetRequiredService<CredentialStore>().Write(new("https://moodle.example.test", "Fixture", 42, "Fixture", token, DateTimeOffset.UtcNow));
        }
        await using (var second = Factory())
        {
            using var client = second.CreateClient();
            var credential = await second.Services.GetRequiredService<CredentialStore>().Read();
            Assert.Equal(token, credential!.Token);
        }
        var keyFiles = Directory.GetFiles(Path.Combine(directory, "keys"), "key-*.xml");
        Assert.NotEmpty(keyFiles);
        foreach (var key in keyFiles) Assert.Contains("encryptedSecret", await File.ReadAllTextAsync(key));
        if (!OperatingSystem.IsWindows())
        {
            var mode = File.GetUnixFileMode(Path.Combine(directory, "keys", "data-protection.pfx"));
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, mode);
        }
    }
    private WebApplicationFactory<Program> Factory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["STUDY_DATA_DIR"] = System.IO.Path.Combine(directory, "data"), ["STUDY_PRIVATE_DIR"] = directory, ["STUDY_SKIP_MIGRATIONS"] = "true", ["STUDY_PUBLIC_URL"] = "https://study.example.test",
            ["ConnectionStrings:Database"] = "Host=127.0.0.1;Port=1;Database=unused;Username=fixture;Password=fixture;Timeout=1"
        }));
    });
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
