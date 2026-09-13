using System.Text.Json;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

public sealed class PipelineFreshnessTests
{
    private static readonly string SourceId = new('a', 64), Revision = new('b', 64), Unit = new('c', 32);

    [Fact] public async Task CachedBytesCannotApproveAnUpdatedProviderFile()
    {
        var provider = new Provider(); var catalog = new Catalog(provider.Source);
        var inventory = new PipelineInventory(provider, catalog);
        var first = Assert.Single((await inventory.Read(7, default)).Sources);
        Assert.Equal("ready", first.Acquisition);
        provider.Source = provider.Source with { ModifiedAt = 2, Size = 20 };
        var changed = Assert.Single((await inventory.Read(7, default)).Sources);
        Assert.Equal("needs-reimport", changed.Acquisition);
        Assert.Equal(first.MaterialRevision, changed.MaterialRevision); // Original remains available.
        Assert.NotEqual(first.SourceVersion, changed.SourceVersion);
        Assert.Contains(changed.Warnings, warning => warning.Contains("erneut aufbereiten"));
        catalog.Captured = provider.Source;
        Assert.Equal("ready", Assert.Single((await inventory.Read(7, default)).Sources).Acquisition);
    }

    [Fact] public void SolutionApprovalReopensWhenTheRelatedTaskSourceChanges()
    {
        var task = Source(SourceId); var solution = Source(new('d', 64));
        var decision = new SourceDecision(solution.Id, solution.SourceVersion, "use", [new(Unit, "solution", RelatedSourceId: task.Id)],
            "Compared with the task statement", "user", DateTimeOffset.UtcNow, new() { [task.Id] = task.SourceVersion });
        var plan = new PipelinePlan { Sources = [task, solution], Decisions = [decision] };
        var observed = new PipelineObservation([], [task, solution], "first", null);
        Assert.Equal("reviewed", PipelineService.Project(7, plan, observed, null).Sources.Single(item => item.Source.Id == solution.Id).Status);
        observed = observed with { Sources = [task with { SourceVersion = new('e', 64) }, solution] };
        Assert.Equal("stale", PipelineService.Project(7, plan, observed, null).Sources.Single(item => item.Source.Id == solution.Id).Status);
        observed = observed with { Sources = [solution] };
        Assert.Equal("stale", PipelineService.Project(7, plan, observed, null).Sources.Single(item => item.Source.Id == solution.Id).Status);
    }

    [Fact] public void RolesAreEnforcedAfterModelOutputNotOnlyInThePrompt()
    {
        var source = new SourceRef(SourceId, Revision, "b-1", 1);
        var chunk = new LearningChunk("chunk", "Fixture", "Unit", [new(source, "A question?")]) { UnitId = Unit, Roles = ["solution"] };
        var task = new { title = "Task", prompt = "A question?", hint = "", solution = "", origin = "source", sources = new[] { 1 } };
        var section = new { title = "Explanation", markdown = "A question?", sources = new[] { 1 } };
        var tasks = JsonSerializer.Serialize(new { title = "Fixture", sections = Array.Empty<object>(), exercises = new[] { task } });
        Assert.Throws<ApiFailure>(() => LearningChunks.Validate(tasks, chunk));
        var sections = JsonSerializer.Serialize(new { title = "Fixture", sections = new[] { section }, exercises = Array.Empty<object>() });
        Assert.Throws<ApiFailure>(() => LearningChunks.Validate(sections, chunk with { Roles = ["task"] }));
    }

    private static PipelineSource Source(string id) => new(id, 10, 100, "Source", "file", "application/pdf", Revision, Revision,
        "ready", null, [], "", "/courses/7", true, "teaching");
    private sealed class Provider : IMaterialSourceProvider
    {
        public MaterialSource Source = new(SourceId, "fixture", 7, 10, "Week", 100, "source.pdf", "file", "application/pdf", "resource", null, null, 1, 10);
        public Task<MaterialInventory> Inventory(long courseId, CancellationToken ct) => Task.FromResult(new MaterialInventory("fixture", [Source]));
        public Task<MaterialInput> Read(MaterialSource source, CancellationToken ct) => throw new InvalidOperationException("Inventory must not fetch file bytes");
    }
    private sealed class Catalog(MaterialSource captured) : IMaterialCatalog
    {
        public MaterialSource Captured = captured;
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => Task.FromResult(new MaterialSnapshot(7, Revision, "ready", new(1, 1, 0, 0, 0, true),
            [new(SourceId, Revision, Captured.Name, Captured.Kind, Captured.MimeType, 10, "Week", 100, "ready", null, null, null, []) { CapturedSourceHash = Captured.AcquisitionHash() }], null, null));
        public Task<MaterialDocument> GetDocument(string id, string revision, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> StartImport(long id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long id, string job, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialAssetContent> GetAsset(string id, string revision, string asset, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
