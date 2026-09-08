using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Learning;

public sealed class LearningWorker(LearningStore store, LearningService service, IMaterialCatalog materials, ILearningModel model) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            foreach (var courseId in store.Courses())
            {
                try { await Process(courseId, stoppingToken); }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
                catch (Exception) { /* Preserve unreadable state; API gives an actionable failure without logging private content. */ }
            }
            try { await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
        }
    }

    public async Task Process(long courseId, CancellationToken stoppingToken)
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
        if (!service.Register(courseId, cancellation)) return;
        string? jobId = null;
        try
        {
            var state = await store.WithCourse(courseId, async state =>
            {
                if (state.Job?.Status is not ("queued" or "running")) return null;
                state.Job = state.Job with { Status = "running", Stage = "Reading prepared sources", Error = null };
                await store.Save(state, stoppingToken);
                return state;
            }, stoppingToken);
            if (state is null) return;
            jobId = state.Job!.Id;
            var chunkJobId = state.ChunkJobId ?? jobId;
            var documents = new List<(LearningInput, MaterialDocument)>();
            foreach (var input in state.Inputs)
                documents.Add((input, await materials.GetDocument(input.MaterialId, input.Revision, cancellation.Token)));
            var chunks = LearningChunks.Build(documents);
            var results = new List<ChunkResult>();
            for (var index = 0; index < chunks.Length; index++)
            {
                cancellation.Token.ThrowIfCancellationRequested();
                var chunk = chunks[index];
                await Progress(courseId, jobId, index, chunks.Length + 1, cancellation.Token);
                var result = await store.ReadChunk(courseId, chunkJobId, chunk.Id, cancellation.Token);
                if (result is null)
                {
                    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);
                    deadline.CancelAfter(TimeSpan.FromMinutes(4));
                    string raw;
                    try
                    {
                        var images = await LearningImages.Load(chunk, materials, deadline.Token);
                        raw = await model.Generate(LearningChunks.Prompt(chunk), LearningChunks.Schema, deadline.Token, images);
                    }
                    catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                    { throw new ApiFailure("learning_timeout", "Codex took too long for one source chapter. Completed chapters are saved; try again to resume.", 504); }
                    result = LearningChunks.Validate(raw, chunk);
                    await store.WriteChunk(courseId, chunkJobId, chunk.Id, result, cancellation.Token);
                }
                results.Add(result);
                await store.WithCourse(courseId, async current =>
                {
                    EnsureCurrent(current, jobId);
                    if (!current.CompletedChunks.Contains(chunk.Id)) current.CompletedChunks.Add(chunk.Id);
                    await store.Save(current, cancellation.Token);
                    return true;
                }, cancellation.Token);
            }
            await Progress(courseId, jobId, chunks.Length, chunks.Length + 1, cancellation.Token);
            CourseOutline outline;
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token))
            {
                deadline.CancelAfter(TimeSpan.FromMinutes(4));
                try { outline = LearningOutline.Validate(await model.Generate(LearningOutline.Prompt(chunks, results), LearningOutline.Schema, deadline.Token), chunks); }
                catch (OperationCanceledException) when (!cancellation.IsCancellationRequested)
                { throw new ApiFailure("learning_timeout", "Codex took too long to arrange the course. Completed chapters are saved for retry.", 504); }
            }
            var ordered = outline.ChapterOrder.Select(id => results[Array.FindIndex(chunks, chunk => chunk.Id == id)]).ToArray();
            var introduction = new LearningSection(LearningChunks.Hash(jobId + "overview"), "Überblick", outline.Introduction,
                ordered.SelectMany(result => result.Sections).SelectMany(section => section.Sources).Distinct().Take(12).ToArray());
            var sections = new[] { introduction }.Concat(ordered.SelectMany(result => result.Sections)).DistinctBy(section => section.Id).ToArray();
            var exercises = ordered.SelectMany(result => result.Exercises).DistinctBy(exercise => exercise.Id).ToArray();
            if (exercises.Length == 0) throw new ApiFailure("learning_exercises_missing", "The result contained no exercises. Completed chapters are saved, and your existing version is unchanged.", 502);
            var version = new LearningVersion(jobId, DateTimeOffset.UtcNow, state.SnapshotId!,
                outline.Title, state.Partial || documents.Any(document => !document.Item2.Complete), state.Warnings,
                sections, exercises, state.Inputs.Select(input => new LearningSource(input.MaterialId, input.Revision, input.Name)).ToArray());
            await store.WithCourse(courseId, async current =>
            {
                EnsureCurrent(current, jobId);
                await store.WriteVersion(courseId, version, cancellation.Token);
                if (!current.Versions.Any(item => item.Id == version.Id))
                    current.Versions.Add(new(version.Id, version.CreatedAt, version.SnapshotId, version.Title, version.Partial, sections.Length, exercises.Length));
                current.ActiveVersionId ??= version.Id;
                current.Job = current.Job! with { Status = "completed", Stage = "Learning version ready", CompletedSteps = chunks.Length + 1, TotalSteps = chunks.Length + 1, CandidateVersionId = version.Id };
                await store.Save(current, cancellation.Token);
                return true;
            }, cancellation.Token);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { /* Persist running state for restart. */ }
        catch (OperationCanceledException)
        { if (jobId is not null) await Fail(courseId, jobId, "cancelled", "Cancelled; completed work is saved", null); }
        catch (Exception error)
        {
            if (jobId is not null) await Fail(courseId, jobId, "failed", "Processing paused",
                error is ApiFailure failure ? failure.Message : "This learning job could not finish. Completed work and existing versions are preserved.");
        }
        finally { service.Unregister(courseId); }
    }

    private Task<bool> Progress(long courseId, string id, int index, int total, CancellationToken ct) => store.WithCourse(courseId, async state =>
    {
        EnsureCurrent(state, id);
        state.Job = state.Job! with { CompletedSteps = index, TotalSteps = total, Stage = $"Preparing source chapter {index + 1} of {total}" };
        await store.Save(state, ct); return true;
    }, ct);
    private Task<bool> Fail(long courseId, string id, string status, string stage, string? error) => store.WithCourse(courseId, async state =>
    {
        if (state.Job?.Id == id && state.Job.Status is "running" or "queued")
        {
            state.Job = state.Job with { Status = status, Stage = stage, Error = error };
            await store.Save(state);
        }
        return true;
    });
    private static void EnsureCurrent(LearningManifest state, string id)
    { if (state.Job?.Id != id || state.Job.Status != "running") throw new OperationCanceledException(); }
}
