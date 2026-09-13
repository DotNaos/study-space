using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

// Synthetic shared fixture for API tests and the local browser smoke test. No Moodle credentials.
public sealed class WorkflowApiFixture : IDisposable
{
    public readonly string DirectoryPath = Path.Combine(Path.GetTempPath(), "study-workflow-api-" + Guid.NewGuid());
    public WebApplicationFactory<Program> Factory { get; }
    public Inventory InventoryData { get; } = new();
    public Catalog CatalogData { get; } = new();
    public Model ModelData { get; } = new();
    public static string Id(char value) => new(value, 64);
    public static readonly string InitialVersion = new('0', 32), UnitId = new('1', 32), SectionId = Id('2'), TaskId = Id('3'), DuplicateId = Id('4');
    public WorkflowApiFixture()
    {
        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?> {
                ["STUDY_DATA_DIR"] = Path.Combine(DirectoryPath, "data"), ["STUDY_PRIVATE_DIR"] = Path.Combine(DirectoryPath, "private"),
                ["STUDY_SKIP_MIGRATIONS"] = "true", ["STUDY_PUBLIC_URL"] = "http://127.0.0.1:18168"
            }));
            builder.ConfigureServices(services => {
                services.RemoveAll<IHostedService>();
                services.RemoveAll<IPipelineInventory>(); services.AddSingleton<IPipelineInventory>(InventoryData);
                services.RemoveAll<IMaterialCatalog>(); services.AddSingleton<IMaterialCatalog>(CatalogData);
                services.RemoveAll<ILearningModel>(); services.AddSingleton<ILearningModel>(ModelData);
            });
        });
    }
    public HttpClient Client()
    {
        var client = Factory.CreateClient(); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:18168"); return client;
    }
    public async Task Seed()
    {
        var store = Factory.Services.GetRequiredService<LearningStore>();
        var refs = new[] { new SourceRef(Id('a'), Id('f'), "b-1", 1) };
        var text = "Eine ursprüngliche Erklärung.\n\nNoch ein Absatz.";
        var version = new LearningVersion(InitialVersion, DateTimeOffset.UtcNow, Id('e'), "Synthetischer Testkurs", false, [],
            [new(SectionId, "Bestehendes Kapitel", text, refs)],
            [new(TaskId, "Übung 1", "Erkläre den Zusammenhang.", "", "", "source", refs), new(DuplicateId, "Übung 1 aus zweiter Quelle", "Erkläre den Zusammenhang.", "", "", "source", [new(Id('b'), Id('f'), "b-1", 1)])],
            [new(Id('a'), Id('f'), "Skriptquelle"), new(Id('b'), Id('f'), "Aufgabenblatt"), new(Id('c'), Id('f'), "Lösungsblatt")],
            PendingSolutions: [new(Id('d'), Id('c'), Id('b'), "Musterlösung 1", "Die Verbindung besteht aus zwei Schritten.", [new(Id('c'), Id('f'), "b-1", 1)])]);
        await store.WithCourse(7, async state => { if (state.Versions.Count > 0) return false; await store.WriteVersion(7, version, default); state.ActiveVersionId = version.Id;
            state.Versions.Add(new(version.Id, version.CreatedAt, version.SnapshotId, version.Title, false, 1, 2)); state.Drafts[DuplicateId] = "Frühere Antwort bleibt erhalten."; await store.Save(state); return true; });
    }
    public Task Process() => new LearningWorker(Factory.Services.GetRequiredService<LearningStore>(), Factory.Services.GetRequiredService<LearningService>(), CatalogData, ModelData).Process(7, default);
    public void Dispose() { Factory.Dispose(); if (Directory.Exists(DirectoryPath)) Directory.Delete(DirectoryPath, true); }
    public sealed class Inventory : IPipelineInventory
    {
        public bool Offline; public int Change;
        public Task<PipelineObservation> Read(long courseId, CancellationToken ct)
        {
            if (Offline) throw new ApiFailure("fixture_offline", "Synthetic provider unavailable", 502);
            var sources = new List<PipelineSource> {
                new(Id('a'), 10, 100, "Skript in Allgemeine Informationen", "file", "application/pdf", Id(Change > 0 ? 'e' : 'f'), Id('f'), "ready", null, [], "", "/courses/7/activities/100", true, "teaching"),
                new(Id('b'), 20, 101, "Aufgabenblatt", "file", "application/pdf", Id('f'), Id('f'), "ready", null, [], "", "/courses/7/activities/101", true, "task"),
                new(Id('c'), 20, 102, "Musterlösung", "file", "application/pdf", Id('f'), Id('f'), "ready", null, [], "", "/courses/7/activities/102", true, "solution"),
                new(Id('d'), 21, null, "Unterricht ohne Datei", "text", "text/html", Id('f'), null, "not-imported", null, [], "Bearbeite eine Reflexion im Unterricht. Diese Aufgabe steht nur im Abschnittstext.", "/courses/7", true, "task")
            };
            if (Change > 0) sources.Add(new(Id('9'), 20, 103, "Neu hinzugefügte Quelle", "file", "text/plain", Id('e'), null, "not-imported", null, [], "", "/courses/7/activities/103", true, "unresolved"));
            return Task.FromResult(new PipelineObservation([new(10, "Allgemeine Informationen", 0), new(20, "Woche 1", 1), new(21, "Unterabschnitt", 2, 20), new(30, "Leerer Abschnitt", 3)], sources.ToArray(), "fixture-" + Change, null));
        }
    }
    public sealed class Catalog : IMaterialCatalog
    {
        public static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5c8AAAAASUVORK5CYII=");
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => Task.FromResult(new MaterialSnapshot(7, Id('e'), "ready", new(3, 3, 0, 0, 0, true),
            new[] { 'a', 'b', 'c' }.Select((letter, index) => new MaterialEntry(Id(letter), Id('f'), letter == 'a' ? "Skriptquelle" : letter == 'b' ? "Aufgabenblatt" : "Lösungsblatt", "file", "application/pdf", letter == 'a' ? 10 : 20, "Fixture", 100 + index, "ready", null, null, null, [])).ToArray(), null, null));
        public Task<MaterialDocument> GetDocument(string id, string revision, CancellationToken ct = default)
        {
            var text = id == Id('a') ? "Eine ursprüngliche Erklärung." : id == Id('b') ? "Erkläre den Zusammenhang." : "Die Verbindung besteht aus zwei Schritten.";
            return Task.FromResult(new MaterialDocument(id, revision, "Gespeicherte Testquelle", "application/pdf",
                [new("b-1", "paragraph", text, 0, 1, null, "page-1", new(.1, .1, .8, .3)), new("b-2", "paragraph", "Zusätzlicher Quellabsatz.", 1, 2, null, null)],
                [new("page-1", "page-image", "image/png", "Quellenseite", $"/api/materials/{id}/revisions/{revision}/assets/page-1", MaterialStore.Hash(Png), Png.Length, 1),
                 new("original", "original", "image/png", "Original", $"/api/materials/{id}/revisions/{revision}/assets/original", MaterialStore.Hash(Png), Png.Length, 1)], [], [], true));
        }
        public Task<MaterialAssetContent> GetAsset(string id, string revision, string assetId, CancellationToken ct = default) => Task.FromResult(new MaterialAssetContent(Png, "image/png", "Source.png"));
        public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => throw new InvalidOperationException("Unexpected import");
        public Task<MaterialSnapshot> Cancel(long courseId, string id, CancellationToken ct = default) => throw new InvalidOperationException("Unexpected cancel");
    }
    public sealed class Model : ILearningModel
    {
        public int Calls;
        public Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct, IReadOnlyList<LearningImage>? images = null)
        {
            Calls++;
            if (schema.GetProperty("properties").TryGetProperty("outcome", out _)) return Task.FromResult("""{"outcome":"partly-correct","comment":"Der erste Schritt stimmt. Erkläre noch den zweiten Schritt."}""");
            var start = prompt.IndexOf("Source blocks follow as JSON:", StringComparison.Ordinal);
            using var input = JsonDocument.Parse(prompt[(prompt.IndexOf('{', start))..]);
            var roles = input.RootElement.GetProperty("roles").EnumerateArray().Select(role => role.GetString()).ToArray();
            var block = input.RootElement.GetProperty("blocks")[0]; var text = block.GetProperty("text").GetString()!;
            object[] sections = roles.Contains("task") && !roles.Contains("teaching") ? [] : [new { title = "Erkannter Abschnitt", markdown = text, sources = new[] { 1 }, mappings = new[] { new { quote = text, origin = "source", sources = new[] { 1 } } } }];
            object[] tasks = roles.Contains("task") ? [new { title = "Erkannte Aufgabe", prompt = text, hint = "", solution = "", origin = "source", sources = new[] { 1 } }] : [];
            return Task.FromResult(JsonSerializer.Serialize(new { title = "Testeinheit", sections, exercises = tasks }));
        }
        public async IAsyncEnumerable<LearningModelDelta> Chat(string prompt, [EnumeratorCancellation] CancellationToken ct) { await Task.Yield(); yield break; }
    }
}
