using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Pipeline;

namespace StudySpace.Api.Content;

public sealed class ContentService(ContentStore content, LearningStore learning, IMaterialCatalog materials, TimeProvider clock)
{
    private sealed record Candidate(PipelineSource Source, ContentPlacement[] Placements);

    public Task<ContentWorkspace> Get(long courseId, CancellationToken ct = default) =>
        content.WithCourse(courseId, state => Task.FromResult(Workspace(state)), ct);

    public async Task<ContentBlockView> Block(long courseId, string blockId, CancellationToken ct = default)
    {
        return await content.WithCourse(courseId, async state =>
        {
            var block = state.Blocks.SingleOrDefault(block => block.Id == blockId) ?? throw Missing();
            var revision = block.CurrentRevisionId is null ? null : await content.Revision(courseId, block.Id, block.CurrentRevisionId, ct);
            return new ContentBlockView(Summary(block), revision);
        }, ct);
    }

    public async Task<ContentRevision> Revision(long courseId, string blockId, string revisionId, CancellationToken ct = default)
    {
        return await content.WithCourse(courseId, async state =>
        {
            if (!state.Blocks.Any(block => block.Id == blockId)) throw Missing();
            return await content.Revision(courseId, blockId, revisionId, ct) ?? throw Missing();
        }, ct);
    }

    public async Task<ContentWorkspace> Materialize(long courseId, ContentMaterializeRequest request, CancellationToken ct = default)
    {
        ValidateReason(request.Reason, request.Actor);
        var snapshot = await Candidates(courseId, request.ExpectedPipelineRevision, ct);
        return await content.WithCourse(courseId, async state =>
        {
            state.PipelineRevision = snapshot.Revision;
            var included = snapshot.Candidates.Select(candidate => candidate.Source.Id).ToHashSet(StringComparer.Ordinal);
            foreach (var existing in state.Blocks) existing.Included = included.Contains(existing.SourceId);

            foreach (var candidate in snapshot.Candidates)
            {
                var source = candidate.Source;
                var block = state.Blocks.SingleOrDefault(value => value.SourceId == source.Id);
                if (block is null)
                {
                    block = new ContentBlockState { Id = source.Id, SourceId = source.Id };
                    state.Blocks.Add(block);
                }
                block.Name = source.Name;
                block.MimeType = source.MimeType;
                block.ObservedSourceVersion = source.SourceVersion;
                block.ObservedMaterialRevision = source.MaterialRevision;
                block.Included = true;
                block.Placements = candidate.Placements;

                if (block.CurrentRevisionId is not null || source.MaterialRevision is null) continue;
                var document = await materials.GetDocument(source.Id, source.MaterialRevision, ct);
                var draft = ContentMaterializer.Materialize(document);
                var now = clock.GetUtcNow();
                var revision = new ContentRevision(Guid.NewGuid().ToString("N"), null, now, request.Actor.Trim(), request.Reason.Trim(),
                    "materialized", source.SourceVersion, source.MaterialRevision, draft.Content, draft.Provenance);
                await content.WriteRevision(courseId, block.Id, revision, ct);
                block.CurrentRevisionId = revision.Id;
                block.BaselineSourceVersion = source.SourceVersion;
                block.BaselineMaterialRevision = source.MaterialRevision;
            }
            await content.Save(state, ct);
            return Workspace(state);
        }, ct);
    }

    public async Task<ContentBlockView> Edit(long courseId, string blockId, ContentEditRequest request, CancellationToken ct = default)
    {
        ValidateEdit(request);
        LearningMdx.Parse(request.Content);
        return await content.WithCourse(courseId, async state =>
        {
            var block = state.Blocks.SingleOrDefault(value => value.Id == blockId) ?? throw Missing();
            if (block.CurrentRevisionId is null) throw new ApiFailure("content_not_materialized", "Materialize this source before editing it.", 409);
            if (block.CurrentRevisionId != request.ExpectedRevisionId) throw Conflict();
            var previous = await content.Revision(courseId, block.Id, block.CurrentRevisionId, ct) ?? throw Missing();
            var next = previous with
            {
                Id = Guid.NewGuid().ToString("N"), ParentRevisionId = previous.Id, CreatedAt = clock.GetUtcNow(),
                Actor = request.Actor.Trim(), Reason = request.Reason.Trim(), Kind = "edit", Content = request.Content,
                ProvenanceStatus = "stale"
            };
            await content.WriteRevision(courseId, block.Id, next, ct);
            block.CurrentRevisionId = next.Id;
            await content.Save(state, ct);
            return new ContentBlockView(Summary(block), next);
        }, ct);
    }

    public async Task<ContentBlockView> Reset(long courseId, string blockId, ContentResetRequest request, CancellationToken ct = default)
    {
        ValidateReason(request.Reason, request.Actor);
        return await content.WithCourse(courseId, async state =>
        {
            var block = state.Blocks.SingleOrDefault(value => value.Id == blockId) ?? throw Missing();
            if (block.CurrentRevisionId is null || block.CurrentRevisionId != request.ExpectedRevisionId) throw Conflict();
            if (block.ObservedMaterialRevision is null) throw new ApiFailure("content_source_unavailable", "This source has no prepared material revision to restore.", 409);
            var document = await materials.GetDocument(block.SourceId, block.ObservedMaterialRevision, ct);
            var draft = ContentMaterializer.Materialize(document);
            var next = new ContentRevision(Guid.NewGuid().ToString("N"), block.CurrentRevisionId, clock.GetUtcNow(), request.Actor.Trim(), request.Reason.Trim(),
                "reset", block.ObservedSourceVersion, block.ObservedMaterialRevision, draft.Content, draft.Provenance);
            await content.WriteRevision(courseId, block.Id, next, ct);
            block.CurrentRevisionId = next.Id;
            block.BaselineSourceVersion = block.ObservedSourceVersion;
            block.BaselineMaterialRevision = block.ObservedMaterialRevision;
            await content.Save(state, ct);
            return new ContentBlockView(Summary(block), next);
        }, ct);
    }

    private async Task<(long Revision, Candidate[] Candidates)> Candidates(long courseId, long expectedRevision, CancellationToken ct)
    {
        return await learning.WithCourse(courseId, state =>
        {
            var plan = state.Pipeline;
            if (plan.Revision != expectedRevision)
                throw new ApiFailure("content_pipeline_conflict", "The reviewed structure changed. Reload it before materializing content.", 409);
            var ordered = PipelineService.OrderedUnits(plan.Units);
            var unitOrder = ordered.Select((unit, index) => (unit.Id, index)).ToDictionary(value => value.Id, value => value.index);
            var units = plan.Units.ToDictionary(unit => unit.Id);
            var sources = plan.Sources.ToDictionary(source => source.Id);
            var candidates = new List<Candidate>();
            foreach (var decision in plan.Decisions.Where(decision => decision.Disposition == "use"))
            {
                if (!sources.TryGetValue(decision.SourceId, out var source) || !source.Present) continue;
                var placements = decision.Uses
                    .Where(use => units.TryGetValue(use.UnitId, out var unit) && !LearningStructure.IsHidden(unit, plan.Units))
                    .OrderBy(use => unitOrder.GetValueOrDefault(use.UnitId, int.MaxValue))
                    .ThenBy(use => use.Order ?? int.MaxValue)
                    .Select(use => new ContentPlacement(use.UnitId, use.Role, unitOrder.GetValueOrDefault(use.UnitId, int.MaxValue), use.Order ?? int.MaxValue, use.FirstPage, use.LastPage, use.RelatedSourceId))
                    .ToArray();
                if (placements.Length > 0) candidates.Add(new(source, placements));
            }
            return Task.FromResult((plan.Revision, candidates.OrderBy(candidate => unitOrder.GetValueOrDefault(candidate.Placements[0].UnitId, int.MaxValue))
                .ThenBy(candidate => candidate.Placements[0].Order).ThenBy(candidate => candidate.Source.Name, StringComparer.OrdinalIgnoreCase).ToArray()));
        }, ct);
    }

    private static ContentWorkspace Workspace(ContentCourseState state) => new(state.CourseId, state.PipelineRevision,
        state.Blocks.OrderBy(block => block.Placements.FirstOrDefault()?.UnitOrder ?? int.MaxValue).ThenBy(block => block.Placements.FirstOrDefault()?.Order ?? int.MaxValue).ThenBy(block => block.Name, StringComparer.OrdinalIgnoreCase).Select(Summary).ToArray());

    private static ContentBlockSummary Summary(ContentBlockState block)
    {
        var stale = block.CurrentRevisionId is not null && (block.BaselineSourceVersion != block.ObservedSourceVersion || block.BaselineMaterialRevision != block.ObservedMaterialRevision);
        var status = block.CurrentRevisionId is null ? block.ObservedMaterialRevision is null ? "not-ready" : "unmaterialized" : stale ? "stale" : "ready";
        return new(block.Id, block.SourceId, block.Name, block.MimeType, block.ObservedSourceVersion, block.ObservedMaterialRevision,
            block.BaselineSourceVersion, block.BaselineMaterialRevision, block.CurrentRevisionId, block.Included, stale, status, block.Placements);
    }

    private static void ValidateEdit(ContentEditRequest request)
    {
        if (request.Content is null || request.Content.Length > 100_000) throw new ApiFailure("content_edit_invalid", "The edited content is too large.", 400);
        ValidateReason(request.Reason, request.Actor);
        if (request.ExpectedRevisionId is null || request.ExpectedRevisionId.Length != 32) throw new ApiFailure("content_edit_invalid", "Choose the current content revision before editing.", 400);
    }

    private static void ValidateReason(string reason, string actor)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 2000 || string.IsNullOrWhiteSpace(actor) || actor.Length > 100)
            throw new ApiFailure("content_edit_invalid", "A short reason and actor are required.", 400);
    }

    private static ApiFailure Conflict() => new("content_edit_conflict", "This source block changed. Reload the current revision before editing it.", 409);
    private static ApiFailure Missing() => new("content_block_missing", "This authored source block is not available.", 404);
}
