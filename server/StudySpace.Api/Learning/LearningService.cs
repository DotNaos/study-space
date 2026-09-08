using System.Collections.Concurrent;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Learning;

public sealed class LearningService(LearningStore store, IMaterialCatalog materials)
{
    private readonly ConcurrentDictionary<long, CancellationTokenSource> running = new();

    public Task<LearningState> Get(long courseId, CancellationToken ct = default) => store.WithCourse(courseId, state => View(state, ct), ct);
    public Task<LearningVersion> Version(long courseId, string id, CancellationToken ct) => store.WithCourse(courseId, async state =>
    {
        if (!state.Versions.Any(version => version.Id == id)) throw Missing();
        return await LearningPresentation.Version(await store.Version(courseId, id, ct), materials, ct);
    }, ct);

    public async Task<LearningState> Generate(long courseId, GenerateRequest request, CancellationToken ct)
    {
        if (!request.ConsentToCodex) throw new ApiFailure("codex_consent_required", "Confirm sending the selected course content to OpenAI through Codex before generating learning content.", 400);
        var snapshot = await materials.GetSnapshot(courseId, ct);
        if (snapshot.SnapshotId is null || snapshot.SnapshotId != request.SnapshotId)
            throw new ApiFailure("material_snapshot_changed", "The prepared materials changed. Review the current coverage before starting.", 409);
        if (snapshot.Coverage.Pending > 0 || snapshot.Job?.Status is "queued" or "running")
            throw new ApiFailure("material_import_running", "Wait for material preparation to finish before generating.", 409);
        if (!snapshot.Coverage.Complete && !request.AllowPartial)
            throw new ApiFailure("material_partial", "Some materials are not readable. Explicitly choose a partial learning version to continue.", 409);
        var inputs = snapshot.Materials.Where(item => item.Status == "ready" && item.Revision is not null)
            .Select(item => new LearningInput(item.Id, item.Revision!, item.Name, item.SectionName)).ToArray();
        if (inputs.Length == 0) throw new ApiFailure("learning_no_material", "Prepare readable course materials first.", 409);
        return await store.WithCourse(courseId, async state =>
        {
            if (state.Job?.Status is "queued" or "running") throw new ApiFailure("learning_busy", "This course is already being processed.", 409);
            var resume = state.SnapshotId == snapshot.SnapshotId && state.Job?.Status is "failed" or "cancelled";
            var id = Guid.NewGuid().ToString("N");
            state.ChunkJobId = resume ? state.ChunkJobId ?? state.Job!.Id : id;
            state.Job = new(id, "queued", resume ? "Resuming saved work" : "Preparing source chapters", resume ? state.CompletedChunks.Count : 0, 0, null, null);
            if (!resume) state.CompletedChunks = [];
            state.SnapshotId = snapshot.SnapshotId;
            state.Inputs = inputs;
            state.Partial = !snapshot.Coverage.Complete;
            state.Warnings = snapshot.Materials.Where(item => item.Status != "ready")
                .Select(item => item.Name + ": " + (item.Reason ?? item.Status))
                .Concat(snapshot.Materials.SelectMany(item => item.Warnings.Select(warning => item.Name + ": " + warning))).Distinct().ToArray();
            await store.Save(state, ct);
            return await View(state, ct);
        }, ct);
    }

    public Task<LearningState> Cancel(long courseId, string jobId, CancellationToken ct) => store.WithCourse(courseId, async state =>
    {
        if (state.Job?.Id != jobId) throw new ApiFailure("learning_job_missing", "This processing job is not current.", 404);
        if (state.Job.Status is "queued" or "running")
        {
            state.Job = state.Job with { Status = "cancelled", Stage = "Cancelled; completed work is saved" };
            await store.Save(state, ct);
            if (running.TryGetValue(courseId, out var source)) await source.CancelAsync();
        }
        return await View(state, ct);
    }, ct);

    public Task<LearningState> Activate(long courseId, string id, CancellationToken ct) => store.WithCourse(courseId, async state =>
    {
        if (!state.Versions.Any(version => version.Id == id)) throw Missing();
        await store.Version(courseId, id, ct);
        state.ActiveVersionId = id;
        state.ReadingSectionId = null;
        await store.Save(state, ct);
        return await View(state, ct);
    }, ct);

    public Task<LearningState> SaveDraft(long courseId, string id, string answer, CancellationToken ct) => store.WithCourse(courseId, async state =>
    {
        if (answer is null || answer.Length > 12000) throw new ApiFailure("draft_length", "Keep the answer within 12000 characters.", 400);
        var version = state.ActiveVersionId is not null ? await store.Version(courseId, state.ActiveVersionId, ct) : null;
        if (version is null || !version.Exercises.Any(exercise => exercise.Id == id)) throw Missing();
        state.Drafts[id] = answer;
        await store.Save(state, ct);
        return await View(state, ct);
    }, ct);

    public Task<LearningState> SavePosition(long courseId, string id, CancellationToken ct) => store.WithCourse(courseId, async state =>
    {
        var version = state.ActiveVersionId is not null ? await store.Version(courseId, state.ActiveVersionId, ct) : null;
        if (version is null || !version.Sections.Any(section => section.Id == id)) throw Missing();
        state.ReadingSectionId = id;
        await store.Save(state, ct);
        return await View(state, ct);
    }, ct);

    internal bool Register(long courseId, CancellationTokenSource source) => running.TryAdd(courseId, source);
    internal void Unregister(long courseId) => running.TryRemove(courseId, out _);
    private async Task<LearningState> View(LearningManifest state, CancellationToken ct) => new(state.CourseId, state.ActiveVersionId,
        state.Versions.ToArray(), state.ActiveVersionId is null ? null : await LearningPresentation.Version(await store.Version(state.CourseId, state.ActiveVersionId, ct), materials, ct),
        state.Job, new(state.Drafts), state.ReadingSectionId, state.Messages.ToArray());
    private static ApiFailure Missing() => new("learning_content_missing", "This saved learning content is not available.", 404);
}
