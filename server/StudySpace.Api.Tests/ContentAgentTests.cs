using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Content;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Pipeline;

namespace StudySpace.Api.Tests;

public sealed class ContentAgentTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-content-agent-" + Guid.NewGuid());
    private readonly LearningStore learning;
    private readonly ContentStore store;
    private readonly Catalog catalog = new();
    private readonly Model model = new();
    private readonly ContentService content;
    private readonly ContentAgentService agent;

    private static readonly string SourceId = new('b', 64);
    private static readonly string SourceId2 = new('e', 64);
    private static readonly string SourceVersion = new('c', 64);
    private static readonly string SourceVersion2 = new('f', 64);
    private static readonly string MaterialRevision = new('d', 64);
    private static readonly string MaterialRevision2 = new('1', 64);
    private static readonly PipelineUnit Unit = new(new('a', 32), "Block 1", null, 0, "script", false, null, 10, []);

    public ContentAgentTests()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["STUDY_DATA_DIR"] = directory
        }).Build();
        learning = new(configuration);
        store = new(configuration);
        content = new(store, learning, catalog, TimeProvider.System);
        agent = new(content, catalog, model);
    }

    [Fact]
    public async Task CodexEditUsesExactRevisionSelectionAndSourceEvidence()
    {
        var initial = await Materialized();
        model.Content = "## DNA\n\nDNA besteht aus Nukleotiden.\n";
        var result = await agent.Edit(7, SourceId, new(initial.Id, "Formuliere das klarer.", true,
            "Die Bausteine von DNA sind Nukleotide.", 10, ["b-00001", "b-00002"]), default);

        Assert.Equal("codex", result.View.Revision!.Actor);
        Assert.Equal(initial.Id, result.View.Revision.ParentRevisionId);
        Assert.Equal(model.Content, result.View.Revision.Content);
        Assert.Equal("Klarer formuliert", result.Summary);
        Assert.Contains("\"editableRevision\":\"" + initial.Id + "\"", model.Prompt);
        Assert.Contains("\"page\":10", model.Prompt);
        Assert.Contains("b-00001", model.Prompt);
        Assert.Contains("Die Bausteine von DNA sind Nukleotide.", model.Prompt);
        Assert.Equal(initial.Content, (await content.Revision(7, SourceId, initial.Id)).Content);
    }

    [Fact]
    public async Task AgentReceivesOtherBlocksFromTheSelectedScope()
    {
        var initial = await Materialized();
        var other = (await content.Block(7, SourceId2)).Revision!;
        model.Content = initial.Content;

        var result = await agent.Edit(7, SourceId, new(initial.Id, "Keep terminology consistent.", true,
            ScopeBlockIds: [SourceId, SourceId2], ScopeLabel: "Gesamtes Skript"), default);

        Assert.Equal(initial.Id, result.View.Revision!.Id);
        Assert.Contains("\"label\":\"Gesamtes Skript\"", model.Prompt);
        Assert.Contains(SourceId2, model.Prompt);
        Assert.Contains("2026_CDS303_Block1_2.pdf", model.Prompt);
        Assert.Contains(other.Content, model.Prompt);
    }

    [Fact]
    public async Task AgentCannotOverwriteANewerRevisionAndUnsafeOutputIsRejected()
    {
        var initial = await Materialized();
        var manual = await content.Edit(7, SourceId, new(initial.Id, "## DNA\n\nManuell.\n", "Manual"));
        var conflict = await Assert.ThrowsAsync<ApiFailure>(() => agent.Edit(7, SourceId,
            new(initial.Id, "Rewrite", true), default));
        Assert.Equal("content_edit_conflict", conflict.Code);
        Assert.Equal(0, model.Calls);

        model.Content = "<script>alert(1)</script>";
        var invalid = await Assert.ThrowsAsync<ApiFailure>(() => agent.Edit(7, SourceId,
            new(manual.Revision!.Id, "Unsafe", true), default));
        Assert.Equal("learning_mdx_invalid", invalid.Code);
        Assert.Equal("## DNA\n\nManuell.\n", (await content.Block(7, SourceId)).Revision!.Content);
    }

    [Fact]
    public async Task UndoCreatesARevisionInsteadOfMutatingHistory()
    {
        var initial = await Materialized();
        var manual = await content.Edit(7, SourceId, new(initial.Id, "## DNA\n\nManuell.\n", "Manual"));
        var undo = await content.Undo(7, SourceId, new(manual.Revision!.Id, "Undo manual edit"));
        Assert.Equal("undo", undo.Revision!.Kind);
        Assert.Equal(manual.Revision.Id, undo.Revision.ParentRevisionId);
        Assert.Equal(initial.Content, undo.Revision.Content);
        Assert.Equal("## DNA\n\nManuell.\n", (await content.Revision(7, SourceId, manual.Revision.Id)).Content);
    }

    [Fact]
    public async Task AgentRequiresExplicitCodexConsent()
    {
        var initial = await Materialized();
        var error = await Assert.ThrowsAsync<ApiFailure>(() => agent.Edit(7, SourceId,
            new(initial.Id, "Rewrite", false), default));
        Assert.Equal("codex_consent_required", error.Code);
        Assert.Equal(0, model.Calls);
    }

    private async Task<ContentRevision> Materialized()
    {
        await learning.WithCourse(7, async state =>
        {
            state.Pipeline.Revision = 3;
            state.Pipeline.Units = [Unit];
            state.Pipeline.Sources =
            [
                new PipelineSource(SourceId, 10, 100, "2026_CDS303_Block1_1.pdf", "file", "application/pdf",
                    SourceVersion, MaterialRevision, "ready", null, [], "", "/courses/7/activities/100", true, "teaching"),
                new PipelineSource(SourceId2, 10, 101, "2026_CDS303_Block1_2.pdf", "file", "application/pdf",
                    SourceVersion2, MaterialRevision2, "ready", null, [], "", "/courses/7/activities/101", true, "teaching"),
            ];
            state.Pipeline.Decisions =
            [
                new SourceDecision(SourceId, SourceVersion, "use", [new SourceUse(Unit.Id, "teaching", 10, 12, Order: 2)],
                    "Reviewed", "user", DateTimeOffset.UtcNow),
                new SourceDecision(SourceId2, SourceVersion2, "use", [new SourceUse(Unit.Id, "teaching", 13, 14, Order: 3)],
                    "Reviewed", "user", DateTimeOffset.UtcNow),
            ];
            await learning.Save(state);
            return true;
        });
        await content.Materialize(7, new(3, "Create deterministic source draft"));
        return (await content.Block(7, SourceId)).Revision!;
    }

    public void Dispose()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    private sealed class Catalog : IMaterialCatalog
    {
        private static readonly MaterialDocument Document = new(SourceId, MaterialRevision, "2026_CDS303_Block1_1.pdf", "application/pdf",
            [
                new("b-00001", "heading", "DNA – das Alphabet", 0, 10, null, "page-0010"),
                new("b-00002", "paragraph", "Die Bausteine von DNA sind Nukleotide.", 1, 10, null, "page-0010"),
                new("b-00003", "paragraph", "Replikation", 2, 11, null, "page-0011")
            ], [], [], [], true);
        private static readonly MaterialDocument Document2 = new(SourceId2, MaterialRevision2, "2026_CDS303_Block1_2.pdf", "application/pdf",
            [
                new("c-00001", "heading", "RNA", 0, 13, null, "page-0013"),
                new("c-00002", "paragraph", "RNA enthält Ribose.", 1, 13, null, "page-0013")
            ], [], [], [], true);
        public Task<MaterialDocument> GetDocument(string materialId, string revision, CancellationToken ct = default) =>
            Task.FromResult(materialId == SourceId2 ? Document2 : Document);
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialAssetContent> GetAsset(string materialId, string revision, string assetId, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class Model : ILearningModel
    {
        public string Prompt { get; private set; } = "";
        public string Content { get; set; } = "## DNA\n\nEdited.\n";
        public int Calls { get; private set; }
        public Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct, IReadOnlyList<LearningImage>? images = null)
        {
            Calls++;
            Prompt = prompt;
            return Task.FromResult(JsonSerializer.Serialize(new { content = Content, summary = "Klarer formuliert" }, LearningStore.Json));
        }
        public async IAsyncEnumerable<LearningModelDelta> Chat(string prompt, [EnumeratorCancellation] CancellationToken ct)
        {
            await Task.CompletedTask;
            yield break;
        }
    }
}
