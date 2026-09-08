using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Tests;

public sealed class LearningApiTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "learning-api-" + Guid.NewGuid());
    private readonly WebApplicationFactory<Program> factory;
    public LearningApiTests()
    {
        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["STUDY_DATA_DIR"] = Path.Combine(directory, "data"), ["STUDY_PRIVATE_DIR"] = Path.Combine(directory, "private"),
                ["STUDY_SKIP_MIGRATIONS"] = "true", ["STUDY_PUBLIC_URL"] = "https://study.example.test"
            }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IHostedService>();
                services.RemoveAll<IMaterialCatalog>(); services.AddSingleton<IMaterialCatalog, Catalog>();
                services.RemoveAll<ILearningModel>(); services.AddSingleton<ILearningModel, Model>();
            });
        });
    }
    [Fact] public async Task MaterialAssetsUseSafeAttachmentAndSandboxHeadersAndWritesRejectForeignOrigin()
    {
        using var client = factory.CreateClient();
        var asset = await client.GetAsync("/api/materials/test/revisions/test/assets/original");
        Assert.Equal(HttpStatusCode.OK, asset.StatusCode);
        Assert.Equal("application/octet-stream", asset.Content.Headers.ContentType!.MediaType);
        Assert.Equal("attachment", asset.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Contains("sandbox", asset.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("nosniff", asset.Headers.GetValues("X-Content-Type-Options").Single());
        client.DefaultRequestHeaders.Add("Origin", "https://untrusted.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/materials/courses/7/import", null)).StatusCode);
    }

    [Fact] public async Task StreamFinalMessageReplacesDraftTextAndSavedVersionIsUnchanged()
    {
        using var client = factory.CreateClient();
        var store = factory.Services.GetRequiredService<LearningStore>();
        var id = new string('a', 32);
        var source = new SourceRef(new('b', 64), new('c', 64), "one", 1);
        var version = new LearningVersion(id, DateTimeOffset.UtcNow, new('d', 64), "Cell biology", false, [],
            [new(new('e', 64), "Cells", "The membrane bounds a cell.", [source])], [], []);
        await store.WithCourse(7, async state =>
        {
            await store.WriteVersion(7, version, default);
            state.Versions.Add(new(id, version.CreatedAt, version.SnapshotId, version.Title, false, 1, 0));
            state.ActiveVersionId = id;
            await store.Save(state); return true;
        });
        var response = await client.PostAsJsonAsync("/api/learning/courses/7/chat", new { versionId = id, message = "Explain the membrane", consentToCodex = true });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType!.MediaType);
        var events = await response.Content.ReadAsStringAsync();
        Assert.Contains("event: delta", events); Assert.Contains("event: completed", events);
        var state = (await client.GetFromJsonAsync<LearningState>("/api/learning/courses/7"))!;
        Assert.Equal("Correct authoritative answer.", state.Messages.Last().Content);
        Assert.Equal("completed", state.Messages.Last().Status);
        Assert.Equal(version.Sections[0].Markdown, state.ActiveVersion!.Sections[0].Markdown);
        Assert.Equal(2, state.Messages.Length);
    }
    public void Dispose() { factory.Dispose(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class Model : ILearningModel
    {
        public Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct) => throw new NotSupportedException();
        public async IAsyncEnumerable<LearningModelDelta> Chat(string prompt, [EnumeratorCancellation] CancellationToken ct)
        { await Task.Yield(); ct.ThrowIfCancellationRequested(); yield return new("Draft answer."); yield return new("Correct authoritative answer.", true); }
    }
    private sealed class Catalog : IMaterialCatalog
    {
        public Task<MaterialAssetContent> GetAsset(string materialId, string revision, string assetId, CancellationToken ct = default) =>
            Task.FromResult(new MaterialAssetContent(Encoding.UTF8.GetBytes("<script>alert(1)</script>"), "text/html", "source.html"));
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialDocument> GetDocument(string materialId, string revision, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
