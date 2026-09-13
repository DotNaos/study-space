using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Tests;

public sealed class LearningWorkflowTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-workflow-" + Guid.NewGuid());
    private readonly LearningStore store;
    private readonly Catalog catalog = new(); private readonly Model model = new();
    private readonly LearningAttempts attempts; private readonly LearningEditing editing; private readonly LearningTaskReview review;
    private static readonly string VersionId = new('a', 32), SectionId = new('b', 64), TaskId = new('c', 64), DuplicateId = new('d', 64), MaterialId = new('e', 64), Revision = new('f', 64);
    private static readonly SourceRef Reference = new(MaterialId, Revision, "b-1", 1);
    public LearningWorkflowTests()
    {
        store = new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = directory }).Build());
        attempts = new(store, catalog, model, TimeProvider.System); editing = new(store, catalog, TimeProvider.System); review = new(store, TimeProvider.System);
    }
    private async Task Seed()
    {
        var text = "Original paragraph.";
        var version = new LearningVersion(VersionId, DateTimeOffset.UtcNow, new('0', 64), "Fixture course", false, [],
            [new(SectionId, "Topic", text, [Reference], new(LearningChunks.Hash(text), [new(0, text.Length, text, [Reference], "source")]))],
            [new(TaskId, "Question", "Explain the concept.", "", "", "source", [Reference]), new(DuplicateId, "Question repeated", "Explain the concept.", "", "", "source", [Reference])],
            [new(MaterialId, Revision, "Source")], PendingSolutions: [new(new('1', 64), MaterialId, MaterialId, "Solution", "A source-derived answer.", [Reference])]);
        await store.WithCourse(7, async state => { await store.WriteVersion(7, version, default); state.Versions.Add(new(version.Id, version.CreatedAt, version.SnapshotId, version.Title, false, 1, 2)); state.ActiveVersionId = version.Id; state.Drafts[DuplicateId] = "Old learner answer"; await store.Save(state); return true; });
    }
    [Fact] public async Task MdxEditCreatesCandidateAndLeavesActiveTextAndOldAnswersUntouched()
    {
        await Seed();
        var next = await editing.Edit(7, SectionId, new(VersionId, VersionId, "Updated title", "New paragraph.", "Clarified wording"), default);
        Assert.Equal(SectionId, next.Sections[0].Id); Assert.Equal("mdx", next.Sections[0].Format); Assert.Equal("stale", next.Sections[0].Provenance!.Status);
        Assert.Equal("Original paragraph.", (await store.Version(7, VersionId, default)).Sections[0].Markdown);
        await store.WithCourse(7, state => { Assert.Equal(VersionId, state.ActiveVersionId); Assert.Equal("Old learner answer", state.Drafts[DuplicateId]); return Task.FromResult(true); });
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiFailure>(() => editing.Edit(7, SectionId, new(VersionId, VersionId, "Another title", "Another paragraph.", "Concurrent edit"), default))).Status);
    }
    [Fact] public async Task MdxComponentsAreSourcePinnedAndNeverExecutable()
    {
        await Seed();
        var version = await store.Version(7, VersionId, default);
        await LearningMdx.Validate($"# Example\n\n<Figure materialId=\"{MaterialId}\" revision=\"{Revision}\" assetId=\"page-1\" alt=\"Source figure\" />\n\n<TaskRef id=\"{TaskId}\" />", version, catalog, default);
        await Assert.ThrowsAsync<ApiFailure>(() => LearningMdx.Validate($"<TaskRef id=\"{new string('2', 64)}\" />", version, catalog, default));
        await Assert.ThrowsAsync<ApiFailure>(() => LearningMdx.Validate($"<Figure materialId=\"{new string('2', 64)}\" revision=\"{Revision}\" assetId=\"page-1\" alt=\"unknown\" />", version, catalog, default));
    }
    [Theory]
    [InlineData("import thing from 'remote'")]
    [InlineData("export const secret = 1")]
    [InlineData("{globalThis.fetch('remote')}")]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("<TaskRef id={compute()} />")]
    [InlineData("<Unknown />")]
    [InlineData("<Figure src=\"https://external.test/image\" />")]
    public void UnsafeMdxRejected(string text) => Assert.Throws<ApiFailure>(() => LearningMdx.Parse(text));
    [Theory]
    [InlineData("Regular **Markdown** and `code { value }`. ")]
    [InlineData("```js\nimport x from 'y';\n{ console.log(1) }\n```")]
    [InlineData("$$\nx_{1} = \\frac{1}{2}\n$$")]
    [InlineData("Formula $x_{1}$ and escaped \\{text\\}.")]
    public void MarkdownCodeAndMathRemainData(string text) => Assert.Empty(LearningMdx.Parse(text));

    [Fact] public async Task AttemptsAreVersionBoundCasProtectedAndImmutableAfterSubmission()
    {
        await Seed();
        var draft = await attempts.Save(7, new(VersionId, TaskId, null, 0, "My own explanation"), default);
        await Assert.ThrowsAsync<ApiFailure>(() => attempts.Save(7, new(VersionId, TaskId, draft.Id, 0, "Stale edit"), default));
        await Assert.ThrowsAsync<ApiFailure>(() => attempts.Save(7, new(VersionId, DuplicateId, draft.Id, draft.Revision, "Wrong task"), default));
        var submitted = await attempts.Submit(7, draft.Id, new(draft.Revision), default);
        Assert.Equal("submitted", submitted.Status); Assert.Equal(2, submitted.Revision);
        await Assert.ThrowsAsync<ApiFailure>(() => attempts.Save(7, new(VersionId, TaskId, draft.Id, submitted.Revision, "Overwrite"), default));
        var next = await attempts.Save(7, new(VersionId, TaskId, null, 0, "Another attempt"), default);
        Assert.NotEqual(next.Id, submitted.Id); Assert.Equal(2, (await attempts.Get(7)).Attempts.Length);
        Assert.Equal("My own explanation", (await attempts.Get(7)).Attempts[0].Answer);
    }
    [Fact] public async Task FeedbackIsPinnedToExactAnswerAndConsentIsRequiredForCodex()
    {
        await Seed(); var draft = await attempts.Save(7, new(VersionId, TaskId, null, 0, "Answer"), default);
        var submitted = await attempts.Submit(7, draft.Id, new(draft.Revision), default);
        await Assert.ThrowsAsync<ApiFailure>(() => attempts.Feedback(7, draft.Id, new(submitted.Revision, "incorrect-hash", "reviewer", "correct", "Comment", []), default));
        await Assert.ThrowsAsync<ApiFailure>(() => attempts.Review(7, draft.Id, new(submitted.Revision, false), default)); Assert.Equal(0, model.Calls);
        var feedback = await attempts.Review(7, draft.Id, new(submitted.Revision, true), default);
        Assert.Equal(1, model.Calls); Assert.Equal(LearningChunks.Hash("Answer"), feedback.AnswerHash); Assert.Equal("codex", feedback.Reviewer);
        Assert.Equal("Answer", (await attempts.Get(7)).Attempts[0].Answer);
    }
    [Fact] public async Task HumanTaskReconciliationKeepsAliasesSolutionsAndAllPreviousData()
    {
        await Seed();
        var next = await review.Reconcile(7, VersionId, new(VersionId, TaskId, [DuplicateId], [new('1', 64)], "Verified source task and solution are the same"), default);
        var task = Assert.Single(next.Exercises); Assert.Equal(TaskId, task.Id); Assert.Equal("source", task.SolutionOrigin);
        Assert.Contains("source-derived answer", task.Solution); Assert.Equal(TaskId, next.TaskAliases![DuplicateId]); Assert.Empty(next.PendingSolutions!);
        Assert.Equal(2, (await store.Version(7, VersionId, default)).Exercises.Length);
        Assert.Equal("Old learner answer", await store.WithCourse(7, state => Task.FromResult(state.Drafts[DuplicateId])));
        Assert.Equal(409, (await Assert.ThrowsAsync<ApiFailure>(() => review.Reconcile(7, VersionId, new(VersionId, TaskId, [DuplicateId], [], "Concurrent review"), default))).Status);
    }
    [Fact] public void NotebookDetectionChecksBytesAndCellsWithoutExecutingOutputs()
    {
        var bytes = Encoding.UTF8.GetBytes("""{"nbformat":4,"cells":[{"cell_type":"markdown","source":["Task instruction"]},{"cell_type":"code","source":["print('do not run')"],"outputs":[{"output_type":"display_data","data":{"text/html":"<script>never execute</script>"}}]}]}""");
        Assert.Equal("application/x-ipynb+json", MaterialFormat.Detect(bytes, "example.ipynb", "text/html"));
        var extracted = MaterialNotebookExtractor.Extract(bytes);
        Assert.Equal(2, extracted.Blocks.Length); Assert.Equal("code", extracted.Blocks[1].Kind); Assert.Equal("cell-00002", extracted.Blocks[1].Id);
        Assert.False(extracted.Complete); Assert.Single(extracted.Warnings); Assert.DoesNotContain(extracted.Blocks, block => block.Text.Contains("never execute"));
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class Model : ILearningModel
    {
        public int Calls;
        public Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct, IReadOnlyList<LearningImage>? images = null) { Calls++; return Task.FromResult("""{"outcome":"partly-correct","comment":"Clarify the missing connection."}"""); }
        public async IAsyncEnumerable<LearningModelDelta> Chat(string prompt, [EnumeratorCancellation] CancellationToken ct) { await Task.Yield(); yield break; }
    }
    private sealed class Catalog : IMaterialCatalog
    {
        public Task<MaterialDocument> GetDocument(string id, string revision, CancellationToken ct = default) => Task.FromResult(new MaterialDocument(id, revision, "Source", "image/png", [new("b-1", "paragraph", "Source explanation", 0, 1, null, null)],
            [new("page-1", "page-image", "image/png", "Source", $"/api/materials/{id}/revisions/{revision}/assets/page-1", new('0', 64), 10, 1)], [], [], true));
        public Task<MaterialSnapshot> GetSnapshot(long id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> StartImport(long id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long id, string job, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialAssetContent> GetAsset(string id, string revision, string asset, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
