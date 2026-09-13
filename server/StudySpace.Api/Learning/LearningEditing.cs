using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Learning;

public sealed record SectionEditRequest(string BaseVersionId, string? ExpectedActiveVersionId, string Title, string Content, string Reason, string Actor = "user");
public sealed record LearningEdit(string ParentVersionId, string SectionId, string Actor, string Reason, DateTimeOffset At);

public sealed class LearningEditing(LearningStore store, IMaterialCatalog materials, TimeProvider clock)
{
    public async Task<LearningVersion> Edit(long courseId, string sectionId, SectionEditRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Length > 250 || request.Content is null ||
            string.IsNullOrWhiteSpace(request.Reason) || request.Reason.Length > 2000 || string.IsNullOrWhiteSpace(request.Actor) || request.Actor.Length > 100)
            throw new ApiFailure("learning_edit_invalid", "Titel, Inhalt, Bearbeiter und Begründung sind erforderlich.", 400);
        LearningVersion original = await store.WithCourse(courseId, async state =>
        {
            if (state.ActiveVersionId != request.ExpectedActiveVersionId) throw Conflict();
            if (!state.Versions.Any(version => version.Id == request.BaseVersionId)) throw Missing();
            var version = await store.Version(courseId, request.BaseVersionId, ct);
            if (!version.Sections.Any(section => section.Id == sectionId)) throw Missing();
            return version;
        }, ct);
        await LearningMdx.Validate(request.Content, original, materials, ct);
        return await store.WithCourse(courseId, async state =>
        {
            if (state.ActiveVersionId != request.ExpectedActiveVersionId) throw Conflict();
            // Sibling edits based on the same section revision need explicit reconciliation.
            if (state.Edits.Any(edit => edit.ParentVersionId == original.Id && edit.SectionId == sectionId))
                throw new ApiFailure("learning_edit_conflict", "Dieser Abschnitt hat bereits eine neue Bearbeitung. Öffne zuerst die neueste Kandidatenfassung.", 409);
            var now = clock.GetUtcNow();
            var edit = new LearningEdit(original.Id, sectionId, request.Actor.Trim(), request.Reason.Trim(), now);
            var next = original with
            {
                Id = Guid.NewGuid().ToString("N"), CreatedAt = now, ParentVersionId = original.Id, Edit = edit,
                Sections = original.Sections.Select(section => section.Id == sectionId ? section with
                {
                    Title = request.Title.Trim(), Markdown = request.Content, Format = "mdx",
                    Provenance = section.Provenance is null ? null : section.Provenance with { Status = "stale" }
                } : section).ToArray()
            };
            await store.WriteVersion(courseId, next, ct);
            state.Versions.Add(new(next.Id, now, next.SnapshotId, next.Title, next.Partial, next.Sections.Length, next.Exercises.Length));
            state.Edits = state.Edits.Append(edit).ToArray();
            await store.Save(state, ct);
            return next;
        }, ct);
    }
    private static ApiFailure Conflict() => new("learning_edit_conflict", "Die aktive Lernversion hat sich geändert. Lade den aktuellen Stand vor dem Speichern.", 409);
    private static ApiFailure Missing() => new("learning_content_missing", "Dieser Abschnitt ist nicht verfügbar.", 404);
}
