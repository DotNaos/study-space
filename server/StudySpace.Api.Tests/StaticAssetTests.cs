using System.Net;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
namespace StudySpace.Api.Tests;

public sealed class StaticAssetTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-static-" + Guid.NewGuid());

    [Fact] public async Task BundledPdfAssetsReturnExactBytesAndTypesInsteadOfTheFrontendFallback()
    {
        var webRoot = Path.Combine(directory, "wwwroot");
        Directory.CreateDirectory(Path.Combine(webRoot, "assets"));
        await File.WriteAllTextAsync(Path.Combine(webRoot, "index.html"), "<!doctype html><title>Fixture frontend</title>");
        var types = new Dictionary<string, string>
        {
            ["bcmap"] = "application/octet-stream", ["pfb"] = "application/octet-stream",
            ["ttf"] = "application/x-font-ttf", ["mjs"] = "text/javascript"
        };
        byte[] bytes = [0, 1, 2, 127, 128, 254, 255, 10];
        foreach (var extension in types.Keys.Append("unknownfixture"))
            await File.WriteAllBytesAsync(Path.Combine(webRoot, "assets", "fixture." + extension), bytes);
        await using var app = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing"); builder.UseWebRoot(webRoot);
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["STUDY_PRIVATE_DIR"] = Path.Combine(directory, "private"), ["STUDY_SKIP_MIGRATIONS"] = "true",
                ["ConnectionStrings:Database"] = "Host=127.0.0.1;Port=1;Database=unused;Username=fixture;Password=fixture;Timeout=1"
            }));
        });
        using var client = app.CreateClient();
        foreach (var (extension, mime) in types)
        {
            var response = await client.GetAsync("/assets/fixture." + extension);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal(mime, response.Content.Headers.ContentType!.MediaType);
            Assert.Equal(bytes, await response.Content.ReadAsByteArrayAsync());
            Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        }
        var unknown = await client.GetAsync("/assets/fixture.unknownfixture");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        Assert.Empty(await unknown.Content.ReadAsByteArrayAsync());
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
