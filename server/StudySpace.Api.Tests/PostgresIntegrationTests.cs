using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
namespace StudySpace.Api.Tests;

public sealed class PostgresIntegrationTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-pg-" + Guid.NewGuid());
    [PostgresFact]
    public async Task MigrationSettingsRestartAndDatabaseUnavailableAreReal()
    {
        var connection = Environment.GetEnvironmentVariable("STUDY_TEST_POSTGRES")!;
        var displayName = "Persistent fixture " + Guid.NewGuid().ToString("N")[..8];
        await using (var first = Factory(connection))
        {
            using var client = first.CreateClient();
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
            var saved = await client.PutAsJsonAsync("/api/settings", new { displayName, locale = "en" });
            Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        }
        await using (var restarted = Factory(connection))
        {
            using var client = restarted.CreateClient();
            var settings = await client.GetFromJsonAsync<JsonElement>("/api/settings");
            Assert.Equal(displayName, settings.GetProperty("displayName").GetString());
            Assert.Equal("en", settings.GetProperty("locale").GetString());
        }
        await using (var unavailable = Factory("Host=127.0.0.1;Port=1;Database=unavailable;Username=fixture;Password=fixture;Timeout=1", skipMigrations: true))
        {
            using var client = unavailable.CreateClient();
            Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/health/ready")).StatusCode);
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/live")).StatusCode);
            var status = await client.GetFromJsonAsync<JsonElement>("/api/status");
            Assert.Equal("unavailable", status.GetProperty("database").GetString());
        }
    }
    private WebApplicationFactory<Program> Factory(string connection, bool skipMigrations = false) => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["STUDY_DATA_DIR"] = System.IO.Path.Combine(directory, "data"), ["STUDY_PRIVATE_DIR"] = directory, ["STUDY_SKIP_MIGRATIONS"] = skipMigrations ? "true" : "false",
            ["STUDY_PUBLIC_URL"] = "https://study.example.test", ["ConnectionStrings:Database"] = connection
        }));
    });
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
public sealed class PostgresFactAttribute : FactAttribute
{
    public PostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("STUDY_TEST_POSTGRES")))
            Skip = "Set STUDY_TEST_POSTGRES to an isolated PostgreSQL database to test real migrations and persistence.";
    }
}
