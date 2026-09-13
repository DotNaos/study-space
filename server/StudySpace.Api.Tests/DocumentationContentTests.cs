using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace StudySpace.Api.Tests;

public sealed class DocumentationContentTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-docs-" + Guid.NewGuid());
    private const string Origin = "https://architecture.os-pc.vpn.os-home.net";
    [Fact]
    public async Task DocsRoutesHaveExactCorsMimeAndNoSpaFallback()
    {
        var web = Path.Combine(directory, "web");
        Directory.CreateDirectory(Path.Combine(web, "docs-content", "pages"));
        await File.WriteAllTextAsync(Path.Combine(web, "index.html"), "<html>application</html>");
        await File.WriteAllTextAsync(Path.Combine(web, "docs-content", "manifest.json"), "{\"schemaVersion\":1}");
        await File.WriteAllTextAsync(Path.Combine(web, "docs-content", "pages", "README.md"), "# Documentation");
        await using var app = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing"); builder.UseWebRoot(web);
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["STUDY_DATA_DIR"] = Path.Combine(directory, "data"), ["STUDY_PRIVATE_DIR"] = Path.Combine(directory, "private"),
                ["STUDY_SKIP_MIGRATIONS"] = "true", ["DOCS_CONTENT_ORIGIN"] = Origin,
                ["ConnectionStrings:Database"] = "Host=127.0.0.1;Port=1;Database=unused;Username=fixture;Password=fixture;Timeout=1"
            }));
        });
        using var client = app.CreateClient();
        client.DefaultRequestHeaders.Add("Origin", Origin);
        var manifest = await client.GetAsync("/docs-content/manifest.json");
        Assert.Equal(HttpStatusCode.OK, manifest.StatusCode);
        Assert.Equal("application/json", manifest.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Origin, Assert.Single(manifest.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Contains("Origin", manifest.Headers.Vary);
        Assert.Equal("no-store", manifest.Headers.CacheControl!.ToString());
        var page = await client.GetAsync("/docs-content/pages/README.md");
        Assert.Equal("text/plain", page.Content.Headers.ContentType!.MediaType);
        Assert.Equal("# Documentation", await page.Content.ReadAsStringAsync());
        foreach (var path in new[] { "missing", "pages/missing.md", "manifest.json?token=forbidden", "" })
        {
            var missing = await client.GetAsync("/docs-content/" + path);
            Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
            Assert.DoesNotContain("<html>", await missing.Content.ReadAsStringAsync());
        }
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(new(HttpMethod.Head, "/docs-content/pages/README.md"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(new(HttpMethod.Options, "/docs-content/manifest.json"))).StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await client.PostAsync("/docs-content/manifest.json", null)).StatusCode);
        var api = await client.GetAsync("/health/live");
        Assert.False(api.Headers.Contains("Access-Control-Allow-Origin"));
        client.DefaultRequestHeaders.Remove("Origin"); client.DefaultRequestHeaders.Add("Origin", "https://forbidden.example");
        var forbidden = await client.GetAsync("/docs-content/manifest.json");
        Assert.Equal(HttpStatusCode.Forbidden, forbidden.StatusCode);
        Assert.False(forbidden.Headers.Contains("Access-Control-Allow-Origin"));
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
