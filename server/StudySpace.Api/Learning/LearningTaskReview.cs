using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Learning;

public sealed record LearningSolution(string Id, string MaterialId, string RelatedSourceId, string Title, string Text, SourceRef[] Sources);
public sealed record TaskReviewDecision(string BaseVersionId, string CanonicalTaskId, string[] MergedTaskIds,
    string[] SolutionIds, string Actor, string Reason, DateTimeOffset At);
public sealed record TaskReconcileRequest(string? ExpectedActiveVersionId, string CanonicalTaskId, string[] MergeTaskIds,
    string[] SolutionIds, string Reason, string Actor = "user");

public sealed class LearningTaskReview(LearningStore store, TimeProvider clock)
{
    public Task<LearningVersion> Reconcile(long courseId, string versionId, TaskReconcileRequest request, CancellationToken ct) => store.WithCourse(courseId, async state =>
    {
        if (state.ActiveVersionId != request.ExpectedActiveVersionId) throw new ApiFailure("task_review_conflict", "Die aktive Fassung hat sich geändert. Prüfe den aktuellen Stand.", 409);
        if (!state.Versions.Any(version => version.Id == versionId)) throw Invalid("Lernversion nicht gefunden.");
        if (string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Length > 2000 || string.IsNullOrWhiteSpace(request.Actor) || request.Actor.Length > 100 ||
            request.MergeTaskIds is null || request.SolutionIds is null || request.MergeTaskIds.Length > 100 || request.SolutionIds.Length > 100)
            throw Invalid("Eine nachvollziehbare Begründung ist erforderlich.");
        var version = await store.Version(courseId, versionId, ct);
        var canonical = version.Exercises.SingleOrDefault(task => task.Id == request.CanonicalTaskId) ?? throw Invalid("Zielaufgabe nicht gefunden.");
        var ids = request.MergeTaskIds.Append(canonical.Id).ToHashSet();
        if (request.MergeTaskIds.Contains(canonical.Id) || request.MergeTaskIds.Distinct().Count() != request.MergeTaskIds.Length ||
            ids.Any(id => !version.Exercises.Any(task => task.Id == id))) throw Invalid("Die gewählten Aufgaben müssen eindeutig in dieser Fassung vorhanden sein.");
        if (state.TaskReviews.Any(review => review.BaseVersionId == versionId && (ids.Contains(review.CanonicalTaskId) || review.MergedTaskIds.Any(ids.Contains))))
            throw new ApiFailure("task_review_conflict", "Diese Aufgaben wurden bereits abgeglichen. Öffne die neue Kandidatenfassung.", 409);
        var solutions = (version.PendingSolutions ?? []).Where(solution => request.SolutionIds.Contains(solution.Id)).ToArray();
        if (solutions.Length != request.SolutionIds.Distinct().Count()) throw Invalid("Eine gewählte Lösung ist nicht vorhanden.");
        var tasks = version.Exercises.Where(task => ids.Contains(task.Id)).ToArray();
        if (solutions.Any(solution => !tasks.Any(task => task.Sources.Any(source => source.MaterialId == solution.RelatedSourceId))))
            throw Invalid("Die Lösungsquelle ist einer anderen Aufgabenquelle zugeordnet. Korrigiere zuerst die Quellenverwendung.");
        if (ids.Count == 1 && solutions.Length == 0) throw Invalid("Wähle eine doppelte Aufgabe oder eine zuzuordnende Lösung.");
        var references = tasks.SelectMany(task => task.Sources).Concat(solutions.SelectMany(solution => solution.Sources)).Distinct().ToArray();
        var merged = canonical with { Sources = references, UnitIds = tasks.SelectMany(task => task.UnitIds ?? []).Distinct().ToArray() };
        if (solutions.Length > 0) merged = merged with {
            Solution = string.Join("\n\n", solutions.Select(solution => "## " + solution.Title + "\n\n" + solution.Text)),
            SolutionOrigin = "source", SolutionSources = solutions.SelectMany(solution => solution.Sources).Distinct().ToArray()
        };
        var aliases = new Dictionary<string, string>(version.TaskAliases ?? []);
        foreach (var key in aliases.Keys.ToArray()) if (ids.Contains(aliases[key])) aliases[key] = canonical.Id;
        foreach (var id in request.MergeTaskIds) aliases[id] = canonical.Id;
        var decision = new TaskReviewDecision(version.Id, canonical.Id, request.MergeTaskIds, request.SolutionIds,
            request.Actor.Trim(), request.Reason.Trim(), clock.GetUtcNow());
        var next = version with {
            Id = Guid.NewGuid().ToString("N"), CreatedAt = clock.GetUtcNow(), ParentVersionId = version.Id,
            Exercises = version.Exercises.Where(task => !request.MergeTaskIds.Contains(task.Id)).Select(task => task.Id == canonical.Id ? merged : task).ToArray(),
            PendingSolutions = (version.PendingSolutions ?? []).Where(solution => !request.SolutionIds.Contains(solution.Id)).ToArray(),
            TaskAliases = aliases, TaskReview = decision
        };
        await store.WriteVersion(courseId, next, ct);
        state.Versions.Add(new(next.Id, next.CreatedAt, next.SnapshotId, next.Title, next.Partial, next.Sections.Length, next.Exercises.Length));
        state.TaskReviews = state.TaskReviews.Append(decision).ToArray();
        await store.Save(state, ct); return next;
    }, ct);
    public static string Resolve(LearningVersion version, string id) => version.TaskAliases?.GetValueOrDefault(id) ?? id;
    private static ApiFailure Invalid(string message) => new("task_review_invalid", message, 400);
}
