using System.Text.Json;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

public sealed class MaterialCatalog(MaterialStore store, IMaterialSourceProvider provider, IMaterialExtractor extractor, TimeProvider clock) : IMaterialCatalog, IDisposable
{
    private readonly SemaphoreSlim changes = new(1, 1);
    private readonly SemaphoreSlim executions = new(1, 1);
    private string? activeJob;
    private CancellationTokenSource? activeCancellation;

    public async Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default)
    {
        await changes.WaitAsync(ct);
        try { return Snapshot(await store.Read(courseId, ct) ?? new() { CourseId = courseId }); }
        finally { changes.Release(); }
    }
    public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => StartImport(courseId, false, null, ct);
    public Task<MaterialSnapshot> StartPdfReextract(long courseId, CancellationToken ct = default) => StartImport(courseId, true, null, ct);
    public Task<MaterialSnapshot> StartSourceImport(long courseId, string sourceId, CancellationToken ct = default) => StartImport(courseId, false, sourceId, ct);
    private async Task<MaterialSnapshot> StartImport(long courseId, bool reextractPdfs, string? sourceId, CancellationToken ct)
    {
        if (courseId <= 0 || sourceId is not null && !ValidSourceId(sourceId)) throw MaterialStore.Missing();
        await changes.WaitAsync(ct);
        try
        {
            var state = await store.Read(courseId, ct) ?? new() { CourseId = courseId };
            if (state.Job?.Status is "queued" or "running") return Snapshot(state);
            state.Job = new(Guid.NewGuid().ToString("N"), "queued", 0, 0, clock.GetUtcNow(), null, null, reextractPdfs, sourceId);
            state.Status = "queued"; state.SnapshotId = null; state.InventoryReady = false; state.UpdatedAt = clock.GetUtcNow();
            await store.Write(state); return Snapshot(state);
        }
        finally { changes.Release(); }
    }
    public async Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default)
    {
        await changes.WaitAsync(ct);
        try
        {
            var state = await store.Read(courseId, ct) ?? throw MaterialStore.Missing();
            if (state.Job?.Id != jobId) throw MaterialStore.Missing();
            if (state.Job.Status is not ("queued" or "running")) return Snapshot(state);
            if (activeJob == jobId) activeCancellation?.Cancel();
            foreach (var item in JobItems(state).Where(item => item.Status is "pending" or "downloading" or "extracting"))
            { item.Status = "cancelled"; item.Reason = "Import cancelled. Previously imported source copies remain available."; }
            await Finish(state, "cancelled", null); return Snapshot(state);
        }
        finally { changes.Release(); }
    }
    public async Task<MaterialDocument> GetDocument(string materialId, string revision, CancellationToken ct = default) =>
        await store.Document(materialId, revision, ct) ?? throw MaterialStore.Missing();
    public async Task<MaterialAssetContent> GetAsset(string materialId, string revision, string assetId, CancellationToken ct = default)
    {
        var document = await GetDocument(materialId, revision, ct);
        var asset = document.Assets.SingleOrDefault(asset => asset.Id == assetId) ?? throw MaterialStore.Missing();
        return new(await store.Blob(asset.Sha256, ct), asset.MimeType, asset.Name);
    }

    // A single durable coordinator serializes imports. HTTP requests only enqueue/cancel/read state.
    public async Task<bool> RunNext(CancellationToken stoppingToken)
    {
        if (!await executions.WaitAsync(0, stoppingToken)) return false;
        MaterialCourseState? state = null;
        CancellationTokenSource? run = null;
        try
        {
            await changes.WaitAsync(stoppingToken);
            try
            {
                foreach (var courseId in store.Courses())
                {
                    var candidate = await store.Read(courseId, stoppingToken);
                    if (candidate?.Job?.Status is "queued" or "running") { state = candidate; break; }
                }
                if (state is null) return false;
                run = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                activeJob = state.Job!.Id; activeCancellation = run;
                state.Job = state.Job with { Status = "running" }; state.Status = "running";
                // An interrupted process never marks an unfinished item successful.
                foreach (var item in JobItems(state).Where(item => item.Status is "downloading" or "extracting")) item.Status = "pending";
                await store.Write(state);
            }
            finally { changes.Release(); }
            var course = state.CourseId; var job = state.Job!.Id;
            if (!state.InventoryReady)
            {
                var inventory = await provider.Inventory(course, run.Token);
                await Update(course, job, current =>
                {
                    var previous = current.Items.ToDictionary(item => item.Source.Id);
                    var selectedSourceId = current.Job!.SourceId;
                    current.Items = inventory.Sources.Select(source =>
                    {
                        previous.TryGetValue(source.Id, out var prior);
                        if (source.UnavailableReason is not null) return new MaterialItemState
                        {
                            Source = source, Revision = prior?.Revision, Status = "unsupported", Reason = source.UnavailableReason,
                            Warnings = prior?.Warnings ?? [], Complete = prior?.Complete ?? false
                        };
                        if (selectedSourceId is null || source.Id == selectedSourceId) return new MaterialItemState
                        {
                            Source = source, Revision = prior?.Revision, Status = "pending", Warnings = prior?.Warnings ?? [],
                            Complete = prior?.Complete ?? false
                        };
                        if (prior is not null) return new MaterialItemState
                        {
                            Source = source, Revision = prior.Revision, Status = prior.Status, Reason = prior.Reason, Warnings = prior.Warnings,
                            Attempts = prior.Attempts, CandidateRevision = prior.CandidateRevision, Complete = prior.Complete
                        };
                        return new MaterialItemState { Source = source, Status = "not-imported" };
                    }).ToList();
                    if (selectedSourceId is not null && !current.Items.Any(item => item.Source.Id == selectedSourceId)) throw MaterialStore.Missing();
                    current.InventoryReady = true;
                }, run.Token);
            }
            while (true)
            {
                run.Token.ThrowIfCancellationRequested();
                var current = await store.Read(course, run.Token) ?? throw MaterialStore.Missing();
                var pending = JobItems(current).FirstOrDefault(item => item.Status == "pending");
                if (pending is null) break;
                await ImportOne(course, job, pending, current.Job!.ReextractPdfs, run.Token);
            }
            await changes.WaitAsync(stoppingToken);
            try
            {
                var current = await store.Read(course, stoppingToken);
                if (current?.Job?.Id == job && current.Job.Status == "running") await Finish(current, "completed", null);
            }
            finally { changes.Release(); }
            return true;
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
        catch (OperationCanceledException) { return true; } // Explicit cancellation was already committed by Cancel.
        catch (Exception error)
        {
            if (state?.Job is not null)
            {
                await changes.WaitAsync(stoppingToken);
                try
                {
                    var current = await store.Read(state.CourseId, stoppingToken);
                    if (current?.Job?.Id == state.Job.Id && current.Job.Status == "running")
                        await Finish(current, "failed", SafeError(error));
                }
                finally { changes.Release(); }
            }
            return true;
        }
        finally
        {
            await changes.WaitAsync(CancellationToken.None);
            try { activeJob = null; activeCancellation = null; run?.Dispose(); }
            finally { changes.Release(); executions.Release(); }
        }
    }

    private async Task ImportOne(long courseId, string jobId, MaterialItemState pending, bool reextractPdfs, CancellationToken ct)
    {
        var source = pending.Source;
        if (pending.CandidateRevision is not null && await store.Document(source.Id, pending.CandidateRevision, ct) is { } recovered)
        {
            await UpdateItem(courseId, jobId, source.Id, item =>
            { item.Status = "ready"; item.Revision = recovered.Revision; item.Reason = null; item.Warnings = recovered.Warnings; item.Complete = recovered.Complete; }, ct);
            return;
        }
        if (pending.Attempts >= 2)
        {
            await UpdateItem(courseId, jobId, source.Id, item =>
            { item.Status = "failed"; item.Complete = false; item.Reason = "Processing was interrupted twice. Start a fresh import to retry this material."; }, ct);
            return;
        }
        for (var attempt = pending.Attempts + 1; attempt <= 2; attempt++)
        {
            try
            {
                await UpdateItem(courseId, jobId, source.Id, item => { item.Status = "downloading"; item.Attempts++; }, ct);
                var input = await provider.Read(source, ct);
                if (input.Bytes.Length > MaterialFormat.MaximumBytes) throw new ApiFailure("material_too_large", "This file exceeds the 32 MB import limit.", 413);
                var sourceHash = await store.PutBlob(input.Bytes);
                var detectedType = MaterialFormat.Detect(input.Bytes, input.Name, input.MimeType);
                var revisionKey = sourceHash + ":" + MaterialFormat.ExtractionProfile(detectedType);
                if (reextractPdfs && detectedType == "application/pdf") revisionKey += ":manual:" + jobId;
                var revision = MaterialStore.Hash(revisionKey);
                var document = await store.Document(source.Id, revision, ct);
                if (document is null)
                {
                    await UpdateItem(courseId, jobId, source.Id, item => { item.Status = "extracting"; item.CandidateRevision = revision; }, ct);
                    var output = await extractor.Extract(input, ct);
                    if (output.Blocks.Length == 0 || !output.Blocks.Any(block => !string.IsNullOrWhiteSpace(block.Text) || block.AssetId is not null))
                        throw new ApiFailure("material_empty", "No readable content or source image was extracted from this material.", 422);
                    var assets = new List<MaterialAsset>
                    { Asset(source.Id, revision, "original", "original", input.MimeType, input.Name, sourceHash, input.Bytes.Length, null, null) };
                    foreach (var asset in output.Assets)
                    {
                        if (asset.Bytes.Length > MaterialFormat.MaximumBytes) throw new ApiFailure("material_asset_too_large", "An extracted source image exceeds the size limit.", 413);
                        var hash = await store.PutBlob(asset.Bytes);
                        assets.Add(Asset(source.Id, revision, asset.Id, asset.Kind, asset.MimeType, asset.Name, hash, asset.Bytes.Length, asset.Page, asset.Slide));
                    }
                    document = new(source.Id, revision, source.Name, input.MimeType, output.Blocks, assets.ToArray(), output.Provenance, output.Warnings, output.Complete);
                    ct.ThrowIfCancellationRequested();
                    await store.SaveDocument(document);
                }
                await UpdateItem(courseId, jobId, source.Id, item =>
                { item.Status = "ready"; item.Revision = revision; item.Reason = null; item.Warnings = document.Warnings; item.Complete = document.Complete; }, ct);
                return;
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception error)
            {
                var retry = attempt < 2 && error is ApiFailure { Status: 502 or 503 or 504 } or HttpRequestException;
                if (retry) { await Task.Delay(TimeSpan.FromMilliseconds(300), ct); continue; }
                await UpdateItem(courseId, jobId, source.Id, item =>
                {
                    item.Status = error is ApiFailure { Status: 415 } ? "unsupported" : "failed";
                    item.Reason = SafeError(error); item.Complete = false;
                }, ct);
                return;
            }
        }
    }
    private Task UpdateItem(long courseId, string jobId, string materialId, Action<MaterialItemState> update, CancellationToken ct) =>
        Update(courseId, jobId, state => update(state.Items.Single(item => item.Source.Id == materialId)), ct);
    private async Task Update(long courseId, string jobId, Action<MaterialCourseState> update, CancellationToken ct)
    {
        await changes.WaitAsync(ct);
        try
        {
            var state = await store.Read(courseId, ct) ?? throw MaterialStore.Missing();
            if (state.Job?.Id != jobId || state.Job.Status != "running") throw new OperationCanceledException();
            update(state); state.UpdatedAt = clock.GetUtcNow();
            var jobItems = JobItems(state).ToArray();
            state.Job = state.Job with { Total = jobItems.Length, Completed = jobItems.Count(item => IsTerminal(item.Status)) };
            await store.Write(state);
        }
        finally { changes.Release(); }
    }
    private async Task Finish(MaterialCourseState state, string jobStatus, string? error)
    {
        state.UpdatedAt = clock.GetUtcNow();
        var jobItems = JobItems(state).ToArray();
        state.Job = state.Job! with { Status = jobStatus, FinishedAt = state.UpdatedAt, Error = error,
            Completed = jobItems.Count(item => IsTerminal(item.Status)), Total = jobItems.Length };
        state.Status = jobStatus == "cancelled" ? "cancelled" : jobStatus == "failed" ? "failed" :
            state.Items.Count > 0 && state.Items.All(item => item.Status == "ready" && item.Complete) ? "ready" : "partial";
        var identity = Snapshot(state) with { SnapshotId = null, Job = null, UpdatedAt = null };
        state.SnapshotId = MaterialStore.Hash(JsonSerializer.SerializeToUtf8Bytes(identity, MaterialStore.Json));
        await store.Write(state); await store.WriteSnapshot(Snapshot(state));
    }
    private static IEnumerable<MaterialItemState> JobItems(MaterialCourseState state) =>
        state.Job?.SourceId is { } sourceId ? state.Items.Where(item => item.Source.Id == sourceId) : state.Items;
    private static bool ValidSourceId(string value) => value.Length == 64 && value.All(ch => ch is >= 'a' and <= 'f' or >= '0' and <= '9');
    private static MaterialSnapshot Snapshot(MaterialCourseState state)
    {
        var entries = state.Items.Select(item => new MaterialEntry(item.Source.Id, item.Revision, item.Source.Name, item.Source.Kind,
            item.Source.MimeType, item.Source.SectionId, item.Source.SectionName, item.Source.ModuleId, item.Status, item.Reason,
            item.Revision is null ? null : DocumentUrl(item.Source.Id, item.Revision),
            item.Revision is null ? null : DocumentUrl(item.Source.Id, item.Revision) + "/assets/original", item.Warnings) { CapturedSourceHash = item.Status == "ready" ? item.Source.AcquisitionHash() : null }).ToArray();
        var coverage = new MaterialCoverage(entries.Length, entries.Count(item => item.Status == "ready"), entries.Count(item => item.Status is "failed" or "cancelled"),
            entries.Count(item => item.Status == "unsupported"), entries.Count(item => item.Status is "pending" or "downloading" or "extracting"), state.Status == "ready");
        return new(state.CourseId, state.SnapshotId, state.Status, coverage, entries, state.Job, state.UpdatedAt);
    }
    private static bool IsTerminal(string status) => status is "ready" or "unsupported" or "failed" or "cancelled";
    private static string SafeError(Exception error) => error is ApiFailure failure ? failure.Message : "The material could not be processed. Existing source copies and previous results are preserved.";
    private static string DocumentUrl(string id, string revision) => $"/api/materials/{id}/revisions/{revision}";
    private static MaterialAsset Asset(string id, string revision, string assetId, string kind, string mime, string name, string hash, long size, int? page, int? slide) =>
        new(assetId, kind, mime, name, DocumentUrl(id, revision) + "/assets/" + assetId, hash, size, page, slide);
    public void Dispose() { changes.Dispose(); executions.Dispose(); activeCancellation?.Dispose(); }
}
