using System.Text;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Tests;

public sealed class MaterialCatalogTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-materials-" + Guid.NewGuid());
    private readonly Source source = new();
    private readonly Extractor extractor = new();
    private readonly MaterialStore store;
    public MaterialCatalogTests() => store = new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = directory }).Build());
    private MaterialCatalog Catalog() => new(store, source, extractor, TimeProvider.System);

    [Fact] public async Task QueueIsIdempotentAndUnchangedSourcesReuseImmutableDocuments()
    {
        using var catalog = Catalog(); var requests = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => catalog.StartImport(7)));
        Assert.Single(requests.Select(item => item.Job!.Id).Distinct()); Assert.All(requests, item => Assert.Null(item.SnapshotId));
        Assert.Equal(0, source.Reads); Assert.True(await catalog.RunNext(default));
        var first = await catalog.GetSnapshot(7); Assert.Equal("ready", first.Status); Assert.True(first.Coverage.Complete);
        Assert.Equal(2, first.Coverage.Ready); Assert.Equal(2, extractor.Calls);
        await catalog.StartImport(7); await catalog.RunNext(default);
        var next = await catalog.GetSnapshot(7); Assert.Equal(first.SnapshotId, next.SnapshotId); Assert.Equal(2, extractor.Calls);
        Assert.Equal(4, source.Reads); Assert.False(await catalog.RunNext(default));
    }

    [Fact] public async Task ChangedBytesCreateNewRevisionWhileOldSourceRemainsReadableOffline()
    {
        using var catalog = Catalog(); await catalog.StartImport(7); await catalog.RunNext(default);
        var first = (await catalog.GetSnapshot(7)).Materials[0];
        source.Content = "Changed course content";
        await catalog.StartImport(7); await catalog.RunNext(default);
        var next = (await catalog.GetSnapshot(7)).Materials[0]; Assert.Equal(first.Id, next.Id); Assert.NotEqual(first.Revision, next.Revision);
        source.FailAll = true;
        var oldDocument = await catalog.GetDocument(first.Id, first.Revision!);
        Assert.Equal("First course content", Assert.Single(oldDocument.Blocks).Text);
        Assert.Equal("First course content", Encoding.UTF8.GetString((await catalog.GetAsset(first.Id, first.Revision!, "original")).Bytes));
        await Assert.ThrowsAsync<ApiFailure>(() => catalog.GetAsset(first.Id, next.Revision!, "../../private"));
        await Assert.ThrowsAsync<ApiFailure>(() => catalog.GetDocument("../private", first.Revision!));
    }

    [Fact] public async Task FailedDownloadIsVisibleWithoutAPlaceholderAndPreservesOtherSuccesses()
    {
        source.FailSecond = true; using var catalog = Catalog();
        await catalog.StartImport(7); await catalog.RunNext(default);
        var snapshot = await catalog.GetSnapshot(7);
        Assert.Equal("partial", snapshot.Status); Assert.False(snapshot.Coverage.Complete);
        Assert.Equal(1, snapshot.Coverage.Ready); Assert.Equal(1, snapshot.Coverage.Failed);
        var failed = snapshot.Materials.Single(item => item.Status == "failed"); Assert.Null(failed.Revision); Assert.Null(failed.DocumentUrl);
        Assert.Contains("temporarily unavailable", failed.Reason); Assert.Equal(3, source.Reads); Assert.Equal(1, extractor.Calls);
        source.FailSecond = false; await catalog.StartImport(7); await catalog.RunNext(default);
        Assert.True((await catalog.GetSnapshot(7)).Coverage.Complete); Assert.Equal(2, extractor.Calls);
    }

    [Fact] public async Task RefreshFailureDoesNotRemoveTheLastUsableDocument()
    {
        using var catalog = Catalog(); await catalog.StartImport(7); await catalog.RunNext(default);
        var previous = (await catalog.GetSnapshot(7)).Materials[1]; source.FailSecond = true;
        await catalog.StartImport(7); await catalog.RunNext(default);
        var failed = (await catalog.GetSnapshot(7)).Materials[1]; Assert.Equal("failed", failed.Status);
        Assert.Equal(previous.Revision, failed.Revision); Assert.NotNull(failed.DocumentUrl);
        Assert.NotEmpty((await catalog.GetDocument(failed.Id, failed.Revision!)).Blocks);
    }

    [Fact] public async Task CancelAndProcessRestartResumeOnlyUnfinishedMaterial()
    {
        using var first = Catalog(); extractor.PauseSecond = true;
        var queued = await first.StartImport(7); using var stop = new CancellationTokenSource();
        var running = first.RunNext(stop.Token); await extractor.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        stop.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running);
        extractor.PauseSecond = false;
        using var restarted = Catalog(); await restarted.RunNext(default);
        Assert.True((await restarted.GetSnapshot(7)).Coverage.Complete); Assert.Equal(1, extractor.FirstCalls);
        await restarted.StartImport(7); source.Pause = true;
        var active = restarted.RunNext(default); await source.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var state = await restarted.GetSnapshot(7);
        await Assert.ThrowsAsync<ApiFailure>(() => restarted.Cancel(7, queued.Job!.Id));
        var cancelled = await restarted.Cancel(7, state.Job!.Id); await active;
        Assert.Equal("cancelled", cancelled.Status); Assert.All(cancelled.Materials, item => Assert.Equal("cancelled", item.Status));
        Assert.False(await restarted.RunNext(default));
    }

    [Fact] public async Task RepeatedProcessInterruptionsRespectTheDurableAttemptLimit()
    {
        extractor.PauseSecond = true;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var catalog = Catalog();
            if (attempt == 0) await catalog.StartImport(7);
            extractor.Started = new(TaskCreationOptions.RunContinuationsAsynchronously);
            using var stop = new CancellationTokenSource(); var running = catalog.RunNext(stop.Token);
            await extractor.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
            stop.Cancel(); await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running);
        }
        using var resumed = Catalog(); await resumed.RunNext(default);
        var snapshot = await resumed.GetSnapshot(7);
        Assert.Equal(1, snapshot.Coverage.Ready); Assert.Equal(1, snapshot.Coverage.Failed);
        Assert.Equal(3, extractor.Calls); Assert.Contains("interrupted twice", snapshot.Materials[1].Reason);
        extractor.PauseSecond = false; await resumed.StartImport(7); await resumed.RunNext(default);
        Assert.True((await resumed.GetSnapshot(7)).Coverage.Complete); Assert.Equal(1, extractor.FirstCalls);
    }

    [Fact] public async Task UnsupportedReferencesAndIncompleteVisualsNeverReportCompleteCoverage()
    {
        source.WithReference = true; extractor.Incomplete = true; using var catalog = Catalog();
        await catalog.StartImport(7); await catalog.RunNext(default);
        var snapshot = await catalog.GetSnapshot(7); Assert.Equal(3, snapshot.Coverage.Total); Assert.Equal(1, snapshot.Coverage.Unsupported);
        Assert.Equal(2, snapshot.Coverage.Ready); Assert.False(snapshot.Coverage.Complete);
        Assert.All(snapshot.Materials.Where(item => item.Status == "ready"), item => Assert.NotEmpty(item.Warnings));
        Assert.Contains("separate access", snapshot.Materials.Single(item => item.Status == "unsupported").Reason);
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class Source : IMaterialSourceProvider
    {
        public string Content { get; set; } = "First course content";
        public bool FailSecond { get; set; }
        public bool FailAll { get; set; }
        public bool WithReference { get; set; }
        public bool Pause { get; set; }
        public int Reads { get; private set; }
        public TaskCompletionSource Started { get; set; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<MaterialInventory> Inventory(long courseId, CancellationToken ct)
        {
            var materials = new List<MaterialSource> { Item(courseId, "first"), Item(courseId, "second") };
            if (WithReference) materials.Add(Item(courseId, "link") with { Kind = "reference", UnavailableReason = "This link requires separate access." });
            return Task.FromResult(new MaterialInventory("scope", materials.ToArray()));
        }
        public async Task<MaterialInput> Read(MaterialSource item, CancellationToken ct)
        {
            Reads++;
            if (Pause) { Started.TrySetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, ct); }
            if (FailAll || FailSecond && item.Name == "second") throw new ApiFailure("fixture_unavailable", "The material is temporarily unavailable.", 502);
            return new(Encoding.UTF8.GetBytes(item.Name == "first" ? Content : "Second course content"), "text/plain", item.Name + ".txt");
        }
        private static MaterialSource Item(long courseId, string name) => new(MaterialStore.Hash("scope:" + courseId + ":" + name), "scope", courseId, 1, "Week 1", 99,
            name, "file", "text/plain", "resource", null, null);
    }
    private sealed class Extractor : IMaterialExtractor
    {
        public int Calls { get; private set; }
        public int FirstCalls { get; private set; }
        public bool PauseSecond { get; set; }
        public bool Incomplete { get; set; }
        public TaskCompletionSource Started { get; set; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<MaterialExtraction> Extract(MaterialInput input, CancellationToken ct)
        {
            Calls++; if (input.Name == "first.txt") FirstCalls++;
            if (PauseSecond && input.Name == "second.txt") { Started.TrySetResult(); await Task.Delay(Timeout.InfiniteTimeSpan, ct); }
            return new([new("b-00001", "paragraph", Encoding.UTF8.GetString(input.Bytes), 0, 1, null, null)], [],
                [new("fixture", "1", 1, MaterialStore.Hash(input.Bytes))], Incomplete ? ["A diagram needs visual review."] : [], !Incomplete);
        }
    }
}
