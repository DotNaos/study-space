using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

public sealed class PipelineTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-pipeline-" + Guid.NewGuid());
    private readonly Inventory inventory = new();
    private readonly Catalog catalog = new();
    private readonly LearningStore store;
    private readonly PipelineService service;
    private static readonly PipelineUnit Unit = new(new('a', 32), "Reviewed topic", null, 0);
    private static readonly PipelineUnit OtherUnit = new(new('b', 32), "Second topic", null, 1);
    public PipelineTests()
    {
        store = new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = directory }).Build());
        service = new(store, inventory, catalog, TimeProvider.System);
    }
    [Fact] public async Task ObservationIncludesEmptyGroupsAndInlineOnlySourcesWithoutWritingOrGenerating()
    {
        var view = await service.Get(7);
        Assert.Equal(2, view.Groups.Length); Assert.Single(view.Sources); Assert.Equal("An entire inline lesson", view.Sources[0].Source.Text);
        Assert.Equal(0, view.Revision); Assert.Empty(view.Units); Assert.Equal(2, view.SuggestedUnits.Length);
        Assert.Equal("pending", view.Sources[0].Status); Assert.Equal("not-imported", view.Sources[0].Source.Acquisition);
        Assert.False(view.Persisted); Assert.Empty(store.Courses());
    }
    [Fact] public async Task DecisionsAreExplicitManyToManyAndConcurrentWritesConflict()
    {
        var state = await service.Structure(7, new(0, [Unit, OtherUnit], "Two parallel topics"), default);
        state = await service.Decide(7, Decision(state.Revision, [new(Unit.Id, "teaching"), new(OtherUnit.Id, "task")]), default);
        Assert.Equal(2, state.Sources[0].Decision!.Uses.Length); Assert.Equal("reviewed", state.Sources[0].Status);
        var error = await Assert.ThrowsAsync<ApiFailure>(() => service.Decide(7, Decision(1, [new(Unit.Id, "teaching")]), default));
        Assert.Equal(409, error.Status); Assert.Equal("pipeline_conflict", error.Code);
        Assert.Equal("Inspect and assign", (await service.Get(7)).Sources[0].Decision!.Reason);
    }
    [Fact] public async Task UnchangedRefreshRetainsDecisionAndChangesOnlyReopenAffectedSource()
    {
        await service.Structure(7, new(0, [Unit], "Actual teaching order"), default);
        var state = await service.Decide(7, Decision(1, [new(Unit.Id, "teaching")]), default);
        state = await service.Sync(7, new(state.Revision), default);
        Assert.Equal("reviewed", state.Sources[0].Status);
        inventory.Source = inventory.Source with { SourceVersion = new('d', 64), Name = "Renamed document" };
        state = await service.Get(7); Assert.Equal("stale", state.Sources[0].Status); Assert.Equal("Reviewed topic", state.Units[0].Title);
        Assert.Equal("Inspect and assign", state.Sources[0].Decision!.Reason);
        await Assert.ThrowsAsync<ApiFailure>(() => service.Decide(7, Decision(state.Revision, [new(Unit.Id, "teaching")]), default));
    }
    [Fact] public async Task ReadFailurePreservesInventoryAndCannotConfirmOrImplyRemoval()
    {
        var state = await service.Sync(7, new(0), default);
        inventory.Fail = true;
        state = await service.Get(7);
        Assert.NotNull(state.Problem); Assert.Single(state.Sources); Assert.True(state.Sources[0].Source.Present);
        Assert.Equal("pending", state.Sources[0].Status);
        Assert.Equal(502, (await Assert.ThrowsAsync<ApiFailure>(() => service.Sync(7, new(state.Revision), default))).Status);
    }
    [Fact] public async Task AbsentSourceIsRetainedAndNewSourceDoesNotRewriteApprovedUnits()
    {
        await service.Structure(7, new(0, [Unit], "Use actual topics"), default);
        await service.Decide(7, Decision(1, [new(Unit.Id, "teaching")]), default);
        inventory.Empty = true;
        var state = await service.Sync(7, new(2), default);
        Assert.Single(state.Sources); Assert.Equal("not-returned", state.Sources[0].Status);
        Assert.Single(state.Units); Assert.NotNull(state.Sources[0].Decision);
    }
    [Fact] public async Task ExclusionNeedsAReasonAndCannotEraseSourcesOrExistingDrafts()
    {
        await store.WithCourse(7, async state => { state.Drafts["old-task"] = "Keep my answer"; await store.Save(state); return true; });
        await Assert.ThrowsAsync<ApiFailure>(() => service.Decide(7, Decision(0, []) with { Disposition = "exclude", Reason = "" }, default));
        var view = await service.Decide(7, Decision(0, []) with { Disposition = "exclude", Reason = "Repeated layout separator, no learning content" }, default);
        Assert.Single(view.Sources); Assert.Equal("excluded", view.Sources[0].Status);
        Assert.Equal("Keep my answer", await store.WithCourse(7, state => Task.FromResult(state.Drafts["old-task"])));
    }
    [Fact] public async Task GenerationRequiresReviewedPreparedInputsAndPreservesTheirOrder()
    {
        Assert.Equal("pipeline_review_required", (await Assert.ThrowsAsync<ApiFailure>(() => service.SelectRun(7, null, Catalog.Snapshot, true, default))).Code);
        await service.Structure(7, new(0, [OtherUnit with { Order = 0 }, Unit with { Order = 1 }], "Teacher sequence, not filenames"), default);
        inventory.Source = inventory.Source with { MaterialRevision = Catalog.Revision, Acquisition = "ready" };
        await service.Decide(7, Decision(1, [new(Unit.Id, "teaching"), new(OtherUnit.Id, "task")]), default);
        var selected = await service.SelectRun(7, 2, Catalog.Snapshot, false, default);
        Assert.Equal([OtherUnit.Id, Unit.Id], selected.Inputs.Select(input => input.UnitId));
        Assert.False(selected.Partial); Assert.Equal(2, selected.PlanRevision);
    }
    [Fact] public async Task PageRangesAndSolutionsNeedRealReferences()
    {
        await service.Structure(7, new(0, [Unit], "Topic"), default);
        await Assert.ThrowsAsync<ApiFailure>(() => service.Decide(7, Decision(1, [new(Unit.Id, "teaching", 1, 2)]), default));
        await Assert.ThrowsAsync<ApiFailure>(() => service.Decide(7, Decision(1, [new(Unit.Id, "solution")]), default));
        inventory.Source = inventory.Source with { MaterialRevision = Catalog.Revision, Acquisition = "ready" };
        await Assert.ThrowsAsync<ApiFailure>(() => service.Decide(7, Decision(1, [new(Unit.Id, "teaching", 1, 500)]), default));
        var result = await service.Decide(7, Decision(1, [new(Unit.Id, "teaching", 1, 1)]), default);
        Assert.Equal(1, result.Sources[0].Decision!.Uses[0].LastPage);
    }
    [Fact] public void InvalidUnitTreesCannotTrapDrillDown()
    {
        Assert.Throws<ApiFailure>(() => PipelineService.ValidateUnits([Unit with { ParentId = OtherUnit.Id }]));
        Assert.Throws<ApiFailure>(() => PipelineService.ValidateUnits([Unit with { ParentId = OtherUnit.Id }, OtherUnit with { ParentId = Unit.Id }]));
        Assert.Throws<ApiFailure>(() => PipelineService.ValidateUnits([Unit, OtherUnit with { Order = 0 }]));
        PipelineService.ValidateUnits([Unit, OtherUnit with { ParentId = Unit.Id }]);
    }
    [Theory]
    [InlineData("Lernziele (Kopie)", "label", "text", "teaching")]
    [InlineData("Aufgabenblatt", "assign", "activity", "task")]
    [InlineData("submission_template.py", "resource", "file", "support")]
    [InlineData("index.html", "page", "file", "teaching")]
    [InlineData("Musterlösung.html", "resource", "file", "solution")]
    public void NamesSuggestRolesButNeverProduceDecisions(string name, string type, string kind, string role)
        => Assert.Equal(role, PipelineInventory.ProposeRole(name, type, kind));

    private static PlanDecisionRequest Decision(long revision, SourceUse[] uses) => new(revision, Catalog.Id, new('c', 64), "use", uses, "Inspect and assign");
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class Inventory : IPipelineInventory
    {
        public bool Fail, Empty;
        public PipelineSource Source = new(Catalog.Id, 10, null, "Section text", "text", "text/html", new('c', 64), null, "not-imported", null, [], "An entire inline lesson", "/courses/7", true, "teaching");
        public Task<PipelineObservation> Read(long courseId, CancellationToken ct)
        {
            if (Fail) throw new ApiFailure("offline", "Fixture offline", 502);
            return Task.FromResult(new PipelineObservation([new(10, "Week 1", 0), new(20, "Empty week", 1)], Empty ? [] : [Source], Source.SourceVersion + (Empty ? ":empty" : ""), null));
        }
    }
    private sealed class Catalog : IMaterialCatalog
    {
        public static readonly string Id = new('b', 64), Revision = new('e', 64);
        public static readonly MaterialSnapshot Snapshot = new(7, new('f', 64), "ready", new(1, 1, 0, 0, 0, true),
            [new(Id, Revision, "Fixture", "file", "text/plain", 10, "Week 1", null, "ready", null, null, null, [])], null, null);
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => Task.FromResult(Snapshot);
        public Task<MaterialDocument> GetDocument(string id, string revision, CancellationToken ct = default) => Task.FromResult(new MaterialDocument(id, revision, "Fixture", "text/plain", [new("b-1", "paragraph", "Text", 0, 1, null, null)], [], [], [], true));
        public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => throw new InvalidOperationException("No implicit import");
        public Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialAssetContent> GetAsset(string id, string revision, string assetId, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
