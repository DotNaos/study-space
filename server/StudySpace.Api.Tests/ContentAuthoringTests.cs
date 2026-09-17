using Microsoft.Extensions.Configuration;
using StudySpace.Api.Content;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Pipeline;

namespace StudySpace.Api.Tests;

public sealed class ContentAuthoringTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-content-" + Guid.NewGuid());
    private readonly LearningStore learning;
    private readonly ContentStore content;
    private readonly Catalog catalog = new();
    private readonly ContentService service;

    private static readonly string SourceId = new('b', 64);
    private static readonly string SourceVersion = new('c', 64);
    private static readonly string MaterialRevision = new('d', 64);
    private static readonly PipelineUnit Unit = new(new('a', 32), "Block 1", null, 0, "script", false, null, 10, []);

    public ContentAuthoringTests()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["STUDY_DATA_DIR"] = directory
        }).Build();
        learning = new(configuration);
        content = new(configuration);
        service = new(content, learning, catalog, TimeProvider.System);
    }

    [Fact]
    public async Task ReviewedSourceMaterializesToOneStableEditableBlock()
    {
        await Seed();
        var workspace = await service.Materialize(7, new(3, "Create deterministic source drafts"));
        var block = Assert.Single(workspace.Blocks);
        Assert.Equal(SourceId, block.Id);
        Assert.Equal("ready", block.Status);
        Assert.Equal(Unit.Id, Assert.Single(block.Placements).UnitId);
        Assert.NotNull(block.CurrentRevisionId);

        var view = await service.Block(7, SourceId);
        Assert.Equal("materialized", view.Revision!.Kind);
        Assert.Contains("## DNA – das Alphabet", view.Revision.Content);
        Assert.Contains("- Adenin", view.Revision.Content);
        Assert.Contains("A &lt; B &#123;raw&#125;", view.Revision.Content);
        Assert.Equal(3, view.Revision.Provenance.Length);
        Assert.All(view.Revision.Provenance, reference => Assert.True(reference.Length > 0));
    }

    [Fact]
    public async Task EditsAreRevisionBoundAndResetCreatesANewRevisionFromRawExtraction()
    {
        await Seed();
        await service.Materialize(7, new(3, "Create deterministic source drafts"));
        var initial = (await service.Block(7, SourceId)).Revision!;
        var edited = await service.Edit(7, SourceId, new(initial.Id, "## DNA\n\nA clearer explanation.\n", "Clarify the text"));

        Assert.Equal("edit", edited.Revision!.Kind);
        Assert.Equal(initial.Id, edited.Revision.ParentRevisionId);
        Assert.Equal("stale", edited.Revision.ProvenanceStatus);
        Assert.Equal("## DNA\n\nA clearer explanation.\n", edited.Revision.Content);
        Assert.Equal(initial.Content, (await service.Revision(7, SourceId, initial.Id)).Content);
        var conflict = await Assert.ThrowsAsync<ApiFailure>(() => service.Edit(7, SourceId,
            new(initial.Id, "## Old sibling", "Conflicting edit")));
        Assert.Equal(409, conflict.Status);
        Assert.Equal("content_edit_conflict", conflict.Code);

        var reset = await service.Reset(7, SourceId, new(edited.Revision.Id, "Restore the current source extraction"));
        Assert.Equal("reset", reset.Revision!.Kind);
        Assert.Equal(edited.Revision.Id, reset.Revision.ParentRevisionId);
        Assert.Contains("## DNA – das Alphabet", reset.Revision.Content);
        Assert.Equal("current", reset.Revision.ProvenanceStatus);
    }

    [Fact]
    public async Task NewSourceRevisionMarksExistingEditableBlockStaleWithoutOverwritingIt()
    {
        await Seed();
        await service.Materialize(7, new(3, "Create deterministic source drafts"));
        var initial = (await service.Block(7, SourceId)).Revision!;
        var edited = await service.Edit(7, SourceId, new(initial.Id, "## DNA\n\nKeep this manual edit.\n", "Manual rewrite"));

        var nextSourceVersion = new string('e', 64);
        var nextMaterialRevision = new string('f', 64);
        catalog.Documents[nextMaterialRevision] = Document(nextMaterialRevision, "New source text");
        await learning.WithCourse(7, async state =>
        {
            state.Pipeline.Revision = 4;
            state.Pipeline.Sources = [state.Pipeline.Sources[0] with
            {
                SourceVersion = nextSourceVersion,
                MaterialRevision = nextMaterialRevision
            }];
            state.Pipeline.Decisions = [state.Pipeline.Decisions[0] with { SourceVersion = nextSourceVersion }];
            await learning.Save(state);
            return true;
        });

        var workspace = await service.Materialize(7, new(4, "Refresh observed source metadata"));
        var summary = Assert.Single(workspace.Blocks);
        Assert.True(summary.Stale);
        Assert.Equal("stale", summary.Status);
        Assert.Equal(nextMaterialRevision, summary.ObservedMaterialRevision);
        Assert.Equal(MaterialRevision, summary.BaselineMaterialRevision);
        Assert.Equal(edited.Revision!.Id, summary.CurrentRevisionId);
        Assert.Equal("## DNA\n\nKeep this manual edit.\n", (await service.Block(7, SourceId)).Revision!.Content);
    }

    [Fact]
    public async Task LegacySourceWithoutDecisionMaterializesAtDefaultStructurePlacement()
    {
        await Seed();
        await learning.WithCourse(7, async state =>
        {
            state.Pipeline.Decisions = [];
            await learning.Save(state);
            return true;
        });
        var workspace = await service.Materialize(7, new(3, "Use default source placement"));
        var block = Assert.Single(workspace.Blocks);
        Assert.Equal(Unit.Id, Assert.Single(block.Placements).UnitId);
        Assert.Equal("teaching", block.Placements[0].Role);
    }

    [Fact]
    public async Task HiddenReviewedUnitsDoNotMaterializeContent()
    {
        await Seed(hidden: true);
        var workspace = await service.Materialize(7, new(3, "Respect reviewed hidden structure"));
        Assert.Empty(workspace.Blocks);
    }

    private async Task Seed(bool hidden = false)
    {
        await learning.WithCourse(7, async state =>
        {
            state.Pipeline.Revision = 3;
            state.Pipeline.Units = [Unit with { Hidden = hidden }];
            state.Pipeline.Sources = [new PipelineSource(SourceId, 10, 100, "2026_CDS303_Block1_1.pdf", "file", "application/pdf",
                SourceVersion, MaterialRevision, "ready", null, [], "", "/courses/7/activities/100", true, "teaching")];
            state.Pipeline.Decisions = [new SourceDecision(SourceId, SourceVersion, "use", [new SourceUse(Unit.Id, "teaching", Order: 2)],
                "Reviewed source mapping", "user", DateTimeOffset.UtcNow)];
            await learning.Save(state);
            return true;
        });
    }

    private static MaterialDocument Document(string revision, string tail = "A < B {raw}") => new(SourceId, revision,
        "2026_CDS303_Block1_1.pdf", "application/pdf",
        [
            new("b-00001", "heading", "DNA – das Alphabet", 0, 10, null, "page-0010"),
            new("b-00002", "list", "Adenin\nGuanin", 1, 10, null, "page-0010"),
            new("b-00003", "paragraph", tail, 2, 11, null, "page-0011")
        ], [], [], [], true);

    public void Dispose()
    {
        if (Directory.Exists(directory)) Directory.Delete(directory, true);
    }

    private sealed class Catalog : IMaterialCatalog
    {
        public Dictionary<string, MaterialDocument> Documents { get; } = new()
        {
            [MaterialRevision] = Document(MaterialRevision)
        };

        public Task<MaterialDocument> GetDocument(string materialId, string revision, CancellationToken ct = default) =>
            Task.FromResult(Documents[revision]);
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialAssetContent> GetAsset(string materialId, string revision, string assetId, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
