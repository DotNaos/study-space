using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class MaterialMoodleTests : IDisposable
{
    private const string Site = "https://moodle.example.test";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-material-moodle-" + Guid.NewGuid());
    private readonly Metadata metadata = new();
    private readonly Downloads downloads = new();
    private readonly CredentialStore credentials;
    private readonly MoodleFileService files;
    private readonly MoodleMaterialSourceProvider provider;
    private readonly MaterialStore store;
    public MaterialMoodleTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["STUDY_DATA_DIR"] = directory, ["STUDY_PRIVATE_DIR"] = Path.Combine(directory, "private") }).Build();
        credentials = new(DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(directory, "keys"))), config);
        var moodle = new MoodleService(metadata, credentials, TimeProvider.System);
        files = new(moodle, credentials, downloads); provider = new(moodle, credentials, files); store = new(config);
    }
    private Task Connect(int user = 42) => credentials.Write(new(Site, "Fixture", user, "Fixture", "syntheticFixtureToken", DateTimeOffset.UtcNow));

    [Fact] public async Task InventoryPreservesHtmlStructureAndListsEveryUnfetchedReferenceWithoutAccessUrls()
    {
        await Connect(); var inventory = await provider.Inventory(7, default);
        Assert.Equal(8, inventory.Sources.Length);
        Assert.Equal(3, inventory.Sources.Count(item => item.Kind == "reference"));
        var summary = inventory.Sources.Single(item => item.Name == "Week 1" && item.Kind == "text");
        Assert.Contains("<h2>", summary.InlineText); Assert.Contains("<sub>", summary.InlineText);
        Assert.DoesNotContain("upstreamSecret", JsonSerializer.Serialize(inventory));
        Assert.DoesNotContain("tokenpluginfile", JsonSerializer.Serialize(inventory));
        var html = inventory.Sources.Single(item => item.Name == "index.html");
        Assert.Null(html.UnavailableReason); Assert.Equal("text/html", (await provider.Read(html, default)).MimeType);
        Assert.Equal(1, downloads.Reads);
        var oldId = html.Id; metadata.Modified++;
        Assert.Equal(oldId, (await provider.Inventory(7, default)).Sources.Single(item => item.Name == "index.html").Id);
        await Connect(43);
        Assert.Equal("moodle_connection_changed", (await Assert.ThrowsAsync<ApiFailure>(() => provider.Read(summary, default))).Code);
    }

    [MaterialToolsFact] public async Task RealMixedCourseImportPersistsReadableSourcesAndReusesExtractionAfterReconnect()
    {
        await Connect(); var extractor = new MaterialExtractor(store, new());
        downloads.ImageBytes = (await extractor.Extract(new(MaterialFixtures.Pdf(), "application/pdf", "scan.pdf"), default)).Assets[0].Bytes;
        using var catalog = new MaterialCatalog(store, provider, extractor, TimeProvider.System);
        await catalog.StartImport(7); await catalog.RunNext(default);
        var snapshot = await catalog.GetSnapshot(7);
        Assert.Equal("partial", snapshot.Status); Assert.Equal(5, snapshot.Coverage.Ready); Assert.Equal(3, snapshot.Coverage.Unsupported);
        foreach (var item in snapshot.Materials.Where(item => item.Status == "ready"))
        {
            var document = await catalog.GetDocument(item.Id, item.Revision!);
            Assert.NotEmpty(document.Blocks); Assert.NotEmpty((await catalog.GetAsset(item.Id, item.Revision!, "original")).Bytes);
        }
        var pdf = snapshot.Materials.Single(item => item.Name == "lecture.pdf");
        var pdfDocument = await catalog.GetDocument(pdf.Id, pdf.Revision!);
        Assert.Contains(pdfDocument.Blocks, block => block.Text.Contains("Cell membrane"));
        Assert.Contains(pdfDocument.Assets, asset => asset.Kind == "page-image");
        var presentation = snapshot.Materials.Single(item => item.Name == "slides.pptx");
        Assert.Contains((await catalog.GetDocument(presentation.Id, presentation.Revision!)).Blocks, block => block.Slide == 1);
        var page = snapshot.Materials.Single(item => item.Name == "index.html");
        Assert.Contains((await catalog.GetDocument(page.Id, page.Revision!)).Blocks, block => block.Kind == "heading" && block.Text == "Cell page");
        credentials.Delete();
        Assert.Equal(pdfDocument.Revision, (await catalog.GetDocument(pdf.Id, pdf.Revision!)).Revision);
        Assert.NotEmpty((await catalog.GetAsset(pdf.Id, pdf.Revision!, "page-0001")).Bytes);
        await Connect(); await catalog.StartImport(7); await catalog.RunNext(default);
        Assert.Equal(snapshot.SnapshotId, (await catalog.GetSnapshot(7)).SnapshotId);
    }
    public void Dispose() { files.Dispose(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class Metadata : IMoodleTransport
    {
        public int Modified { get; set; } = 1;
        public Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct) => throw new InvalidOperationException();
        public Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct)
        {
            if (method == "core_webservice_get_site_info") return Task.FromResult(JsonSerializer.SerializeToElement(new { siteurl = Site, userid = 42 }));
            if (method == "core_enrol_get_users_courses") return Task.FromResult(JsonSerializer.SerializeToElement(new[] { new { id = 7, fullname = "Biology" } }));
            Assert.Equal("core_course_get_contents", method);
            object File(string name) => new { type = "file", filename = name, filepath = "/", filesize = 0, timemodified = Modified,
                fileurl = Site + "/webservice/pluginfile.php/91/mod_resource/content/1/" + name + "?token=upstreamSecret" };
            object[] contents = [File("lecture.pdf"), File("slides.pptx"), File("index.html"), File("scan.png"),
                new { type = "url", filename = "Reading", fileurl = "https://external.example.test/?token=upstreamSecret" }];
            return Task.FromResult(JsonSerializer.SerializeToElement(new[] { new { id = 11, name = "Week 1",
                summary = "<h2>Water</h2><p>H<sub>2</sub>O <a href='https://external.example.test/?token=upstreamSecret'>Reading</a><img src='/tokenpluginfile.php/upstreamSecret/diagram.png' alt='Diagram'></p>",
                modules = new[] { new { id = 99, name = "Biology", modname = "resource", contents } } } }));
        }
    }
    private sealed class Downloads : IMoodleFileTransport
    {
        public int Reads { get; private set; }
        public byte[] ImageBytes { get; set; } = CourseImageTransportTests.Png;
        private readonly byte[] presentation = MaterialFixtures.Presentation();
        public Task<MoodleFile> Fetch(Uri site, Uri source, string token, string? previewKind, CancellationToken ct, string? expectedMime = null)
        {
            Reads++;
            var bytes = Path.GetFileName(source.AbsolutePath) switch
            {
                "lecture.pdf" => MaterialFixtures.Pdf(), "slides.pptx" => presentation,
                "index.html" => Encoding.UTF8.GetBytes("<h1>Cell page</h1><p>Membranes surround cells.</p>"),
                "scan.png" => ImageBytes, _ => throw new InvalidOperationException()
            };
            return Task.FromResult(new MoodleFile(bytes, "application/octet-stream"));
        }
    }
}
