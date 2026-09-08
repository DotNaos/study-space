using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class ConfigurationTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-config-" + Guid.NewGuid());
    private string ConfigFile => Path.Combine(directory, "data", "config.json");

    [Fact] public async Task FreshConfigurationIsGeneratedBlankAndPersistsAcrossRestart()
    {
        await using (var first = Factory())
        {
            using var client = first.CreateClient();
            Assert.Null(await Site(client));
            Assert.True(File.Exists(ConfigFile));
            if (!OperatingSystem.IsWindows()) Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(ConfigFile));
            var saved = await client.PutAsJsonAsync("/api/config", new { moodle = new { siteUrl = "  https://MOODLE.example.test/learning/  " } });
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
            Assert.Equal("https://moodle.example.test/learning", await Site(client));
        }
        await using (var restarted = Factory())
        {
            using var client = restarted.CreateClient();
            Assert.Equal("https://moodle.example.test/learning", await Site(client));
        }
        Assert.DoesNotContain("token", await File.ReadAllTextAsync(ConfigFile), StringComparison.OrdinalIgnoreCase);
        Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(ConfigFile)!, "*.tmp"));
    }

    [Fact] public async Task CredentialSiteSeedsMissingFileButExplicitClearAndSiteChangePreserveCredential()
    {
        const string token = "syntheticConfigurationSecret123456";
        await using (var first = Factory())
        {
            using var client = first.CreateClient();
            var credentials = first.Services.GetRequiredService<CredentialStore>();
            await credentials.Write(new("https://moodle.example.test", "Fixture", 42, "Fixture", token, DateTimeOffset.UtcNow));
            Assert.Equal("https://moodle.example.test", await Site(client));
            var updated = await client.PutAsJsonAsync("/api/config", new { moodle = new { siteUrl = "https://other.example.test" } });
            Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
            Assert.Equal("https://moodle.example.test", (await credentials.Read())!.SiteUrl);
            var cleared = await client.PutAsJsonAsync("/api/config", new { moodle = new { siteUrl = (string?)null } });
            Assert.Equal(HttpStatusCode.OK, cleared.StatusCode);
            Assert.Null(await Site(client));
            Assert.Equal(token, (await credentials.Read())!.Token);
        }
        await using (var restarted = Factory())
        {
            using var client = restarted.CreateClient();
            Assert.Null(await Site(client));
        }
        Assert.DoesNotContain(token, await File.ReadAllTextAsync(ConfigFile));
    }

    [Theory]
    [InlineData("http://moodle.example.test")]
    [InlineData("https://user:secret@moodle.example.test")]
    [InlineData("https://moodle.example.test/?token=secret")]
    [InlineData("")]
    public async Task InvalidConfigurationNeverOverwritesSavedAddress(string value)
    {
        await using var app = Factory(); using var client = app.CreateClient();
        await client.PutAsJsonAsync("/api/config", new { moodle = new { siteUrl = "https://moodle.example.test" } });
        var response = await client.PutAsJsonAsync("/api/config", new { moodle = new { siteUrl = value } });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("secret", await response.Content.ReadAsStringAsync());
        Assert.Equal("https://moodle.example.test", await Site(client));
    }

    [Fact] public async Task MalformedConfigurationFailsWithoutReplacingFile()
    {
        await using var app = Factory(); using var client = app.CreateClient();
        await Site(client);
        await File.WriteAllTextAsync(ConfigFile, "{ broken PRIVATE }");
        var response = await client.GetAsync("/api/config");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.DoesNotContain("PRIVATE", await response.Content.ReadAsStringAsync());
        Assert.Equal("{ broken PRIVATE }", await File.ReadAllTextAsync(ConfigFile));
    }

    private static async Task<string?> Site(HttpClient client) => (await client.GetFromJsonAsync<JsonElement>("/api/config"))
        .GetProperty("moodle").GetProperty("siteUrl").GetString();
    private WebApplicationFactory<Program> Factory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["STUDY_PRIVATE_DIR"] = Path.Combine(directory, "private"), ["STUDY_DATA_DIR"] = Path.Combine(directory, "data"),
            ["STUDY_SKIP_MIGRATIONS"] = "true", ["STUDY_PUBLIC_URL"] = "https://study.example.test",
            ["ConnectionStrings:Database"] = "Host=127.0.0.1;Port=1;Database=unused;Username=fixture;Password=fixture;Timeout=1"
        }));
    });
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
