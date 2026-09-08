using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Tests;

public sealed class LearningTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-learning-" + Guid.NewGuid());
    private readonly Catalog catalog = new();
    private readonly Model model = new();
    private readonly LearningStore store;
    private readonly LearningService service;
    private readonly LearningWorker worker;
    public LearningTests()
    {
        store = new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = directory }).Build());
        service = new(store, catalog); worker = new(store, service, catalog, model);
    }

    [Fact] public async Task GenerationRequiresConsentCurrentSnapshotAndExplicitPartialChoice()
    {
        Assert.Equal("codex_consent_required", (await Assert.ThrowsAsync<ApiFailure>(() => service.Generate(7, new(Catalog.SnapshotId, false, false), default))).Code);
        Assert.Equal("material_snapshot_changed", (await Assert.ThrowsAsync<ApiFailure>(() => service.Generate(7, new(new string('f', 64), false, true), default))).Code);
        catalog.Complete = false;
        Assert.Equal("material_partial", (await Assert.ThrowsAsync<ApiFailure>(() => service.Generate(7, new(Catalog.SnapshotId, false, true), default))).Code);
        await service.Generate(7, new(Catalog.SnapshotId, true, true), default);
        await worker.Process(7, default);
        Assert.True((await service.Get(7)).ActiveVersion!.Partial);
    }

    [Fact] public void LongBlocksAreSplitWithoutDroppingSourceTextOrLosingPositions()
    {
        var text = string.Concat(Enumerable.Repeat("A meaningful source sentence. 🧬 ", 1200));
        var document = Catalog.Document with { Blocks = [Catalog.Block with { Text = text, Page = 3 }] };
        var chunks = LearningChunks.Build([(Catalog.Input, document)]);
        Assert.True(chunks.Length > 1);
        Assert.Equal(text, string.Concat(chunks.SelectMany(chunk => chunk.Blocks).Select(block => block.Text)));
        Assert.All(chunks.SelectMany(chunk => chunk.Blocks), block => Assert.Equal(3, block.Source.Page));
    }

    [Fact] public void InvalidSourceReferencesNeverBecomeSavedCitations()
    {
        var chunk = LearningChunks.Build([(Catalog.Input, Catalog.Document)])[0];
        var json = Model.Result(chunk.Blocks[0].Source with { MaterialId = new string('f', 64) });
        Assert.Equal("learning_result_invalid", Assert.Throws<ApiFailure>(() => LearningChunks.Validate(json, chunk)).Code);
        Assert.Throws<ApiFailure>(() => LearningChunks.Validate("not JSON", chunk));
    }

    [Fact] public void GeneratedExerciseCannotMisrepresentItselfAsVerbatimSourceExercise()
    {
        var chunk = LearningChunks.Build([(Catalog.Input, Catalog.Document)])[0];
        var result = LearningChunks.Validate(Model.Result(chunk.Blocks[0].Source, "source"), chunk);
        Assert.Equal("generated", result.Exercises[0].Origin);
    }

    [Fact] public void EmptyExerciseOutputIsRejectedBeforeItCanPoisonResumeCache()
    {
        var chunk = LearningChunks.Build([(Catalog.Input, Catalog.Document)])[0];
        var value = JsonSerializer.Serialize(new { title = "Cells", sections = new[] {
            new { title = "Membrane", markdown = "A membrane bounds a cell.", sources = new[] { chunk.Blocks[0].Source } }
        }, exercises = Array.Empty<object>() }, LearningStore.Json);
        Assert.Throws<ApiFailure>(() => LearningChunks.Validate(value, chunk));
    }

    [Fact] public async Task NewGenerationKeepsActiveVersionAnswersAndOlderVersionsUntilActivation()
    {
        await StartAndProcess();
        var first = (await service.Get(7)).ActiveVersion!;
        await service.SaveDraft(7, first.Exercises[0].Id, "My own answer", default);
        await service.SavePosition(7, first.Sections[0].Id, default);
        await StartAndProcess();
        var state = await service.Get(7);
        Assert.Equal(2, state.Versions.Length);
        Assert.Equal(first.Id, state.ActiveVersionId);
        Assert.Equal(first.Sections[0].Id, state.ReadingSectionId);
        Assert.Equal("My own answer", state.Drafts[first.Exercises[0].Id]);
        await service.Activate(7, state.Job!.CandidateVersionId!, default);
        Assert.NotEqual(first.Id, (await service.Get(7)).ActiveVersionId);
        Assert.Equal(first.Id, (await service.Version(7, first.Id, default)).Id);
        Assert.Equal("My own answer", (await service.Get(7)).Drafts[first.Exercises[0].Id]);
    }

    [Fact] public async Task FailedChapterResumesSavedChaptersWithoutDuplicatingModelCalls()
    {
        catalog.Long = true; model.FailAt = 2;
        await StartAndProcess();
        var failed = await service.Get(7);
        Assert.Equal("failed", failed.Job!.Status);
        Assert.Null(failed.ActiveVersion);
        model.FailAt = 0;
        await StartAndProcess();
        var recovered = await service.Get(7);
        Assert.Equal("completed", recovered.Job!.Status);
        Assert.NotEqual(failed.Job.Id, recovered.Job.Id);
        Assert.Equal(4, model.Calls); // First chapter once, second failed then retried, then course outline.
        Assert.Single(recovered.Versions);
    }

    [Fact] public async Task CancelledQueueDoesNotInvokeModelAndRestartPreservesSavedState()
    {
        var queued = await service.Generate(7, new(Catalog.SnapshotId, false, true), default);
        await service.Cancel(7, queued.Job!.Id, default);
        await worker.Process(7, default);
        Assert.Equal(0, model.Calls);
        var reopened = new LearningService(new(new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = directory }).Build()), catalog);
        Assert.Equal("cancelled", (await reopened.Get(7)).Job!.Status);
    }

    [Fact] public async Task InterruptedRunningJobIsRecoveredAfterRestart()
    {
        await service.Generate(7, new(Catalog.SnapshotId, false, true), default);
        await store.WithCourse(7, async state => { state.Job = state.Job! with { Status = "running" }; await store.Save(state); return true; });
        await worker.Process(7, default);
        Assert.Equal("completed", (await service.Get(7)).Job!.Status);
        Assert.Equal(2, model.Calls);
    }

    [Fact] public async Task ImmediateResumeCannotBeCancelledByThePreviousAttemptUnwinding()
    {
        model.PauseUntilCancelled = true;
        var first = await service.Generate(7, new(Catalog.SnapshotId, false, true), default);
        var processing = worker.Process(7, default);
        await model.Entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        await service.Cancel(7, first.Job!.Id, default);
        var resumed = await service.Generate(7, new(Catalog.SnapshotId, false, true), default);
        Assert.NotEqual(first.Job.Id, resumed.Job!.Id);
        model.ReleaseCancellation.TrySetResult(true);
        await processing;
        Assert.Equal("queued", (await service.Get(7)).Job!.Status);
        model.PauseUntilCancelled = false;
        await worker.Process(7, default);
        Assert.Equal("completed", (await service.Get(7)).Job!.Status);
    }

    [Fact] public async Task ForeignVersionAndExerciseCannotChangeSavedCourse()
    {
        await StartAndProcess();
        await Assert.ThrowsAsync<ApiFailure>(() => service.Activate(7, new string('a', 32), default));
        await Assert.ThrowsAsync<ApiFailure>(() => service.SaveDraft(7, "unknown", "answer", default));
        var versionId = (await service.Get(7)).ActiveVersionId!;
        await Assert.ThrowsAsync<ApiFailure>(() => service.Version(8, versionId, default));
        Assert.Empty((await service.Get(7)).Drafts);
    }

    [Fact] public async Task CorruptStateIsPreservedAndReportedInsteadOfReset()
    {
        await StartAndProcess();
        var path = Path.Combine(directory, "learning", "7", "state.json");
        await File.WriteAllTextAsync(path, "broken");
        Assert.Equal("learning_state_unreadable", (await Assert.ThrowsAsync<ApiFailure>(() => service.Get(7))).Code);
        Assert.Equal("broken", await File.ReadAllTextAsync(path));
    }

    [Fact] public async Task ChatUsesSelectedLearningTextAndDisclosesPartialContext()
    {
        await StartAndProcess();
        var version = (await service.Get(7)).ActiveVersion!;
        var prompt = LearningChat.BuildPrompt(version, version.Sections[0].Id, [], "Explain the cell");
        Assert.Contains("relevance-selected subset", prompt);
        Assert.Contains("cannot edit", prompt);
        Assert.Contains(version.Sections[0].Markdown, prompt);
    }

    [Fact] public async Task SerializedChatBudgetIncludesUnicodeHistoryAndAllSourceReferences()
    {
        await StartAndProcess();
        var version = (await service.Get(7)).ActiveVersion!;
        version = version with { Sections = Enumerable.Range(0, 2560).Select(index => version.Sections[0] with {
            Id = index.ToString(), Title = new string('ä', 250), Markdown = new string('ü', 20000)
        }).ToArray() };
        var history = Enumerable.Range(0, 8).Select(index => new ChatMessage(index.ToString(), "assistant", new string('ö', 32000), "completed")).ToArray();
        var prompt = LearningChat.BuildPrompt(version, "0", history, "Keep my exact question 🧬");
        Assert.True(prompt.Length <= 120000);
        Assert.Contains("Keep my exact question", prompt);
        Assert.Contains("relevance-selected subset", prompt);
    }

    private async Task StartAndProcess()
    { await service.Generate(7, new(Catalog.SnapshotId, !catalog.Complete, true), default); await worker.Process(7, default); }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    private sealed class Catalog : IMaterialCatalog
    {
        public static readonly string SnapshotId = new('a', 64);
        public static readonly LearningInput Input = new(new('b', 64), new('c', 64), "Synthetic biology", "Cell structure");
        public static readonly MaterialBlock Block = new("block-1", "paragraph", "A cell has a membrane.", 1, 1, null, null);
        public static readonly MaterialDocument Document = new(Input.MaterialId, Input.Revision, Input.Name, "application/pdf", [Block], [], [], [], true);
        public bool Complete { get; set; } = true;
        public bool Long { get; set; }
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => Task.FromResult(new MaterialSnapshot(courseId, SnapshotId, Complete ? "ready" : "partial",
            new(Complete ? 1 : 2, 1, Complete ? 0 : 1, 0, 0, Complete),
            [new(Input.MaterialId, Input.Revision, Input.Name, "file", "application/pdf", 1, Input.SectionName, 1, "ready", null, null, null, [])], null, DateTimeOffset.UtcNow));
        public Task<MaterialDocument> GetDocument(string materialId, string revision, CancellationToken ct = default) =>
            Task.FromResult(Long ? Document with { Blocks = [Block with { Text = new string('x', 17000) }] } : Document);
        public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialAssetContent> GetAsset(string materialId, string revision, string assetId, CancellationToken ct = default) => throw new NotSupportedException();
    }
    private sealed class Model : ILearningModel
    {
        public int Calls { get; private set; }
        public int FailAt { get; set; }
        public bool PauseUntilCancelled { get; set; }
        public TaskCompletionSource<bool> Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource<bool> ReleaseCancellation { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct)
        {
            Calls++;
            if (PauseUntilCancelled)
            {
                Entered.TrySetResult(true);
                try { await Task.Delay(Timeout.InfiniteTimeSpan, ct); }
                catch (OperationCanceledException) { await ReleaseCancellation.Task; throw; }
            }
            if (Calls == FailAt) throw new ApiFailure("synthetic_failure", "Synthetic interrupted model call", 503);
            if (prompt.Contains("{\"chapters\"", StringComparison.Ordinal))
            {
                using var outline = JsonDocument.Parse(prompt[prompt.IndexOf("{\"chapters\"", StringComparison.Ordinal)..]);
                return JsonSerializer.Serialize(new { title = "Cells", introduction = "Start with cell structure, then practise the questions.",
                    chapterOrder = outline.RootElement.GetProperty("chapters").EnumerateArray().Select(chapter => chapter.GetProperty("id").GetString()).ToArray() }, LearningStore.Json);
            }
            using var json = JsonDocument.Parse(prompt[prompt.IndexOf("{\"name\"", StringComparison.Ordinal)..]);
            var source = json.RootElement.GetProperty("blocks")[0].GetProperty("source").Deserialize<SourceRef>(LearningStore.Json)!;
            return Result(source);
        }
        public static string Result(SourceRef source, string origin = "generated") => JsonSerializer.Serialize(new
        {
            title = "Cells", sections = new[] { new { title = "Cell membrane", markdown = "The membrane bounds a cell.", sources = new[] { source } } },
            exercises = new[] { new { title = "Cell question", prompt = "What bounds a cell?", hint = "Consider its boundary.", solution = "Generated suggestion: its membrane.", origin, sources = new[] { source } } }
        }, LearningStore.Json);
        public async IAsyncEnumerable<LearningModelDelta> Chat(string prompt, [EnumeratorCancellation] CancellationToken ct)
        { await Task.Yield(); ct.ThrowIfCancellationRequested(); yield return new("Synthetic answer", true); }
    }
}
