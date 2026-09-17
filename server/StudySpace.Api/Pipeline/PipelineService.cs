using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Pipeline;

public sealed class PipelineService(LearningStore store, IPipelineInventory inventory, IMaterialCatalog materials, TimeProvider clock)
{
    public async Task<PipelineView> Get(long courseId, CancellationToken ct = default)
    {
        var observation = await Observe(courseId, ct);
        return await store.WithCourse(courseId, async state => Project(courseId, state.Pipeline, observation,
            state.ActiveVersionId is null ? null : await store.Version(courseId, state.ActiveVersionId, ct)), ct);
    }

    private async Task<PipelineObservation> Observe(long courseId, CancellationToken ct)
    {
        try { return await inventory.Read(courseId, ct); }
        catch (Exception error) when (error is ApiFailure or HttpRequestException || error is OperationCanceledException && !ct.IsCancellationRequested)
        {
            return await store.WithCourse(courseId, state => Task.FromResult(new PipelineObservation(state.Pipeline.Groups,
                state.Pipeline.Sources, "", "Moodle konnte nicht vollständig gelesen werden. Gespeicherte Quellen bleiben sichtbar; keine Löschung oder neue Freigabe wird daraus abgeleitet.")), ct);
        }
    }

    public async Task<PipelineView> Sync(long courseId, PlanSyncRequest request, CancellationToken ct)
    {
        var observed = await Observe(courseId, ct);
        if (observed.Problem is not null) throw new ApiFailure("pipeline_upstream", observed.Problem, 502);
        await store.WithCourse(courseId, async state =>
        {
            CheckRevision(state.Pipeline, request.ExpectedRevision);
            if (state.Pipeline.ObservedHash == observed.Hash && state.Pipeline.SyncedAt is not null) return true;
            Capture(state.Pipeline, observed);
            AddEvent(state.Pipeline, "sync", "user", "Quellenbestand aktualisiert.");
            await store.Save(state, ct); return true;
        }, ct);
        return await SavedView(courseId, observed, ct);
    }

    public async Task<PipelineView> Structure(long courseId, PlanStructureRequest request, CancellationToken ct)
    {
        if (request.Units is null || request.Units.Length > 250 || request.Units.Any(unit => unit is null || string.IsNullOrWhiteSpace(unit.Id) || string.IsNullOrWhiteSpace(unit.Title)) ||
            request.Units.Select(unit => unit.Id).Distinct().Count() != request.Units.Length) throw Invalid("Ungültige Lerneinheiten.");
        ValidateReason(request.Reason, request.Actor);
        var observed = await Observe(courseId, ct);
        await store.WithCourse(courseId, async state =>
        {
            var plan = state.Pipeline;
            CheckRevision(plan, request.ExpectedRevision);
            var groups = observed.Groups.Concat(plan.Groups.Where(old => !observed.Groups.Any(group => group.Id == old.Id))).ToArray();
            var deleted = (request.DeletedUnitIds ?? []).ToHashSet(StringComparer.Ordinal);
            var previousUnits = LearningStructure.Normalize(courseId, plan.Units, groups);
            if (deleted.Any(id => !Regex.IsMatch(id, "^[a-f0-9]{32}$")) || deleted.Count != (request.DeletedUnitIds ?? []).Length ||
                deleted.Any(id => previousUnits.FirstOrDefault(unit => unit.Id == id) is not { SourceGroupId: null }))
                throw Invalid("Nur selbst erstellte Struktureinträge können gelöscht werden.");
            if (plan.Decisions.Any(decision => decision.Uses.Any(use => deleted.Contains(use.UnitId))))
                throw Invalid("Verschiebe oder blende zugeordnete Quellen aus, bevor du den Struktureintrag löschst.");
            var next = LearningStructure.Apply(courseId, plan.Units, request.Units, groups, deleted);
            ValidateUnits(next);
            var previous = JsonSerializer.Serialize(plan.Units, LearningStore.Json);
            plan.Units = next;
            if (observed.Problem is null) Capture(plan, observed);
            AddEvent(plan, "structure", request.Actor, request.Reason + "\nVorherige Struktur: " + previous);
            await store.Save(state, ct); return true;
        }, ct);
        return await Get(courseId, ct);
    }

    public async Task<PipelineView> Decide(long courseId, PlanDecisionRequest request, CancellationToken ct)
    {
        ValidateReason(request.Reason, request.Actor);
        var observed = await Observe(courseId, ct);
        if (observed.Problem is not null) throw new ApiFailure("pipeline_upstream", observed.Problem, 502);
        await store.WithCourse(courseId, async state =>
        {
            var plan = state.Pipeline;
            CheckRevision(plan, request.ExpectedRevision);
            var item = new PlanMappingItem(request.SourceId, request.SourceVersion, request.Disposition, request.Uses);
            var decision = await BuildDecision(plan, observed, item, request.Reason, request.Actor, ct);
            Capture(plan, observed);
            var previous = plan.Decisions.SingleOrDefault(value => value.SourceId == decision.SourceId);
            plan.Decisions = plan.Decisions.Where(value => value.SourceId != decision.SourceId).Append(decision).ToArray();
            AddEvent(plan, "decision", request.Actor, request.Reason, decision.SourceId, previous);
            await store.Save(state, ct); return true;
        }, ct);
        return await SavedView(courseId, observed, ct);
    }

    public async Task<PipelineView> Map(long courseId, PlanMappingRequest request, CancellationToken ct)
    {
        ValidateReason(request.Reason, request.Actor);
        if (request.Items is null || request.Items.Length is < 1 or > 250 ||
            request.Items.Any(item => item is null) || request.Items.Select(item => item.SourceId).Distinct().Count() != request.Items.Length)
            throw Invalid("Die Zuordnungen sind ungültig.");
        var observed = await Observe(courseId, ct);
        if (observed.Problem is not null) throw new ApiFailure("pipeline_upstream", observed.Problem, 502);
        await store.WithCourse(courseId, async state =>
        {
            var plan = state.Pipeline;
            CheckRevision(plan, request.ExpectedRevision);
            var previous = request.Items.ToDictionary(item => item.SourceId, item => plan.Decisions.SingleOrDefault(value => value.SourceId == item.SourceId));
            var next = new Dictionary<string, SourceDecision?>();
            foreach (var item in request.Items)
            {
                if (item.Disposition == "clear")
                {
                    var source = observed.Sources.SingleOrDefault(source => source.Id == item.SourceId && source.Present)
                        ?? throw Invalid("Diese Quelle ist im aktuellen Bestand nicht verfügbar.");
                    if (source.SourceVersion != item.SourceVersion)
                        throw new ApiFailure("pipeline_source_changed", "Die Quelle hat sich geändert. Prüfe die aktuelle Fassung erneut.", 409);
                    if (item.Uses is null || item.Uses.Length != 0) throw Invalid("Zurücksetzen enthält keine Verwendung.");
                    next[item.SourceId] = null;
                }
                else next[item.SourceId] = await BuildDecision(plan, observed, item, request.Reason, request.Actor, ct);
            }
            Capture(plan, observed);
            var changed = request.Items.Select(item => item.SourceId).Where(id =>
                next[id] is null ? previous[id] is not null : !EquivalentMapping(previous[id], next[id]!)).ToArray();
            if (changed.Length == 0) return true;
            var ids = request.Items.Select(item => item.SourceId).ToHashSet();
            plan.Decisions = plan.Decisions.Where(decision => !ids.Contains(decision.SourceId)).Concat(next.Values.OfType<SourceDecision>()).ToArray();
            plan.Revision++;
            var at = clock.GetUtcNow();
            foreach (var id in changed)
                plan.History = plan.History.Append(new(plan.Revision, "mapping", request.Actor.Trim(), request.Reason.Trim(), at, id, previous[id])).ToArray();
            await store.Save(state, ct); return true;
        }, ct);
        return await SavedView(courseId, observed, ct);
    }

    private static bool EquivalentMapping(SourceDecision? left, SourceDecision right)
    {
        if (left is null || left.SourceVersion != right.SourceVersion || left.Disposition != right.Disposition || !left.Uses.SequenceEqual(right.Uses)) return false;
        var a = left.DependencyVersions ?? []; var b = right.DependencyVersions ?? [];
        return a.Count == b.Count && a.All(item => b.TryGetValue(item.Key, out var value) && value == item.Value);
    }

    private async Task<SourceDecision> BuildDecision(PipelinePlan plan, PipelineObservation observed, PlanMappingItem request,
        string reason, string actor, CancellationToken ct)
    {
        var source = observed.Sources.SingleOrDefault(source => source.Id == request.SourceId && source.Present)
            ?? throw Invalid("Diese Quelle ist im aktuellen Bestand nicht verfügbar.");
        if (source.SourceVersion != request.SourceVersion)
            throw new ApiFailure("pipeline_source_changed", "Die Quelle hat sich geändert. Prüfe die aktuelle Fassung erneut.", 409);
        if (request.Disposition is not ("use" or "exclude") || request.Uses is null || request.Uses.Length > 64 ||
            request.Disposition == "use" && request.Uses.Length == 0 || request.Disposition == "exclude" && request.Uses.Length != 0 || request.Uses.Any(use => use is null))
            throw Invalid("Wähle eine Verwendung oder einen begründeten Ausschluss.");
        foreach (var use in request.Uses)
        {
            if (use.Role is not ("teaching" or "task" or "solution" or "support" or "reference") || use.UnitId is null || use.Order is < 0 or > 1000000)
                throw Invalid("Unbekannte Verwendung.");
            if ((use.FirstPage is null) != (use.LastPage is null) || use.FirstPage <= 0 || use.LastPage < use.FirstPage)
                throw Invalid("Der Seitenbereich ist ungültig.");
            if (use.FirstPage is not null)
            {
                if (source.MaterialRevision is null || source.Acquisition != "ready") throw Invalid("Bereite die aktuelle Quelle vor, bevor du einen Seitenbereich bestätigst.");
                var document = await materials.GetDocument(source.Id, source.MaterialRevision, ct);
                var pages = document.Blocks.Select(block => block.Page ?? block.Slide).Concat(document.Assets.Select(asset => asset.Page ?? asset.Slide)).ToHashSet();
                if (!pages.Contains(use.FirstPage) || !pages.Contains(use.LastPage)) throw Invalid("Der Bereich fehlt in dieser Quellenfassung.");
            }
            if (use.Role == "solution" && (string.IsNullOrWhiteSpace(use.RelatedSourceId) || use.RelatedSourceId == source.Id ||
                !observed.Sources.Any(item => item.Id == use.RelatedSourceId && item.Present)))
                throw Invalid("Ordne die Lösung ausdrücklich ihrer Aufgabenquelle zu.");
            if (use.UnitId.Length > 0)
            {
                var unit = plan.Units.SingleOrDefault(unit => unit.Id == use.UnitId) ?? throw Invalid("Wähle eine bestätigte Lerneinheit.");
                if (LearningStructure.IsHidden(unit, plan.Units)) throw Invalid("Ausgeblendete Lerneinheiten können keine neue Quellenzuordnung erhalten.");
                if (use.Role == "teaching" && LearningStructure.Kind(unit) == "tasks")
                    throw Invalid("Skriptinhalte gehören in eine Skript-Lerneinheit, nicht in eine Aufgabengruppe.");
            }
            else if (use.Role is "teaching" or "task" or "solution") throw Invalid("Wähle eine bestätigte Lerneinheit.");
        }
        if (request.Uses.GroupBy(use => new { use.UnitId, use.Role, use.FirstPage, use.LastPage, use.RelatedSourceId }).Any(group => group.Count() > 1))
            throw Invalid("Die Verwendung wurde doppelt angegeben.");
        var dependencies = request.Uses.Where(use => use.Role == "solution").Select(use => use.RelatedSourceId!).Distinct()
            .ToDictionary(id => id, id => observed.Sources.Single(item => item.Id == id).SourceVersion);
        return new(source.Id, source.SourceVersion, request.Disposition, request.Uses, reason.Trim(), actor.Trim(), clock.GetUtcNow(), dependencies);
    }

    // Called before a job is queued. Freeze exact reviewed inputs; never approve by model confidence.
    public async Task<PipelineRunSelection> SelectRun(long courseId, long? expectedRevision, MaterialSnapshot snapshot, bool allowPartial, CancellationToken ct)
    {
        var observed = await Observe(courseId, ct);
        if (observed.Problem is not null) throw new ApiFailure("pipeline_upstream", observed.Problem, 502);
        return await store.WithCourse(courseId, state =>
        {
            var plan = state.Pipeline;
            if (expectedRevision is null || plan.Revision == 0 || plan.Units.Length == 0)
                throw new ApiFailure("pipeline_review_required", "Prüfe zuerst Struktur und Quellenzuordnung im Bearbeiten-Modus.", 409);
            CheckRevision(plan, expectedRevision.Value);
            var view = Project(courseId, plan, observed, null);
            var visibleUnits = view.Units.Where(unit => !LearningStructure.IsHidden(unit, view.Units)).ToDictionary(unit => unit.Id);
            var inputs = new List<(LearningInput Input, int? UseOrder, int SourceIndex)>(); var warnings = new List<string>();
            var sourceIndexes = view.Sources.Select((item, index) => (item.Source.Id, index)).ToDictionary(item => item.Id, item => item.index);
            foreach (var item in view.Sources)
            {
                if (item.Status is "stale" or "not-returned" || item.Status == "pending" && item.CurrentPlacementId is null) { warnings.Add(item.Source.Name + ": Zuordnung offen oder erneut zu prüfen."); continue; }
                if (item.Status is "excluded" or "structure-hidden") continue;
                if (item.Status == "partial") warnings.Add(item.Source.Name + ": Nur ausgewählte Seiten zugeordnet; der übrige Quelleninhalt bleibt ungeklärt.");
                var effectiveUses = item.Decision?.Disposition == "use" ? item.Decision.Uses :
                    item.CurrentPlacementId is { } defaultUnitId && visibleUnits.TryGetValue(defaultUnitId, out var defaultUnit)
                        ? [new SourceUse(defaultUnitId, LearningStructure.Kind(defaultUnit) == "tasks" ? "task" : "teaching", Order: 0)]
                        : [];
                var uses = effectiveUses.Where(use => visibleUnits.ContainsKey(use.UnitId) && use.Role is "teaching" or "task" or "solution");
                var material = snapshot.Materials.SingleOrDefault(source => source.Id == item.Source.Id && source.Status == "ready" && source.Revision is not null);
                if (uses.Any() && (item.Source.Acquisition != "ready" || material is null || material.Revision != item.Source.MaterialRevision))
                { warnings.Add(item.Source.Name + ": Bestätigt, aber noch nicht in dieser Fassung aufbereitet."); continue; }
                uses = uses.Where(use => {
                    if (use.Role != "solution") return true;
                    var taskSource = view.Sources.SingleOrDefault(other => other.Source.Id == use.RelatedSourceId);
                    if (taskSource is not null && taskSource.Status is "reviewed" or "partial" &&
                        taskSource.Source.Acquisition == "ready" && taskSource.Decision!.Uses.Any(other => other.UnitId == use.UnitId && other.Role is "task" or "teaching")) return true;
                    warnings.Add(item.Source.Name + ": Die zugehörige Aufgabenquelle muss für diese Lerneinheit bestätigt und aufbereitet werden.");
                    return false;
                }).ToArray();
                foreach (var group in uses.GroupBy(use => new { use.UnitId, use.FirstPage, use.LastPage, use.RelatedSourceId }))
                {
                    var unit = visibleUnits[group.Key.UnitId];
                    var input = new LearningInput(material!.Id, material.Revision!, material.Name, LearningStructure.DisplayTitle(unit), unit.Id,
                        group.Select(use => use.Role).Distinct().Order().ToArray(), group.Key.FirstPage, group.Key.LastPage, group.Key.RelatedSourceId);
                    var useOrder = group.Where(use => use.Order is not null).Select(use => use.Order).DefaultIfEmpty().Min();
                    inputs.Add((input, useOrder, sourceIndexes[item.Source.Id]));
                }
                if (uses.Any()) warnings.AddRange(item.Source.Warnings.Select(warning => item.Source.Name + ": " + warning));
            }
            if (warnings.Count > 0 && !allowPartial)
                throw new ApiFailure("pipeline_incomplete", "Es gibt offene Zuordnungen oder nicht aufbereitete Quellen. Prüfe sie oder wähle ausdrücklich eine Teilfassung.", 409);
            if (inputs.Count == 0) throw new ApiFailure("pipeline_no_inputs", "Keine bestätigten, lesbaren Lernquellen vorhanden.", 409);
            var order = OrderedUnits(plan.Units).Select((unit, index) => (unit.Id, index)).ToDictionary(item => item.Id, item => item.index);
            var ordered = inputs.OrderBy(item => order[item.Input.UnitId!])
                .ThenBy(item => item.UseOrder is null ? 1 : 0).ThenBy(item => item.UseOrder ?? int.MaxValue).ThenBy(item => item.SourceIndex)
                .Select(item => item.Input).ToArray();
            return Task.FromResult(new PipelineRunSelection(plan.Revision, ordered, warnings.Distinct().ToArray(), warnings.Count > 0));
        }, ct);
    }

    private Task<PipelineView> SavedView(long courseId, PipelineObservation observed, CancellationToken ct) => store.WithCourse(courseId, async state =>
        Project(courseId, state.Pipeline, observed, state.ActiveVersionId is null ? null : await store.Version(courseId, state.ActiveVersionId, ct)), ct);

    public static PipelineView Project(long courseId, PipelinePlan plan, PipelineObservation observed, LearningVersion? version)
    {
        var sources = MergeSources(plan.Sources, observed.Sources, observed.Problem is null);
        var groups = observed.Groups.Concat(plan.Groups.Where(old => !observed.Groups.Any(group => group.Id == old.Id))).ToArray();
        var units = LearningStructure.Normalize(courseId, plan.Units, groups);
        var views = sources.Select(source =>
        {
            var decision = plan.Decisions.SingleOrDefault(item => item.SourceId == source.Id);
            var sourceUnit = units.FirstOrDefault(unit => unit.SourceGroupId == source.SectionId);
            var inheritedHidden = decision is null && sourceUnit is not null && LearningStructure.IsHidden(sourceUnit, units);
            var status = inheritedHidden ? "structure-hidden" : !source.Present ? "not-returned" : decision is null ? "pending" :
                decision.SourceVersion != source.SourceVersion || decision.Uses.Any(use => use.Role == "solution" && (decision.DependencyVersions?.GetValueOrDefault(use.RelatedSourceId!) is not { } pinned || !sources.Any(other => other.Id == use.RelatedSourceId && other.Present && other.SourceVersion == pinned))) ? "stale" : decision.Disposition == "exclude" ? "excluded" : decision.Uses.All(use => use.FirstPage is not null) ? "partial" : "reviewed";
            if (status is "reviewed" or "partial" && decision!.Uses.Any(use => use.UnitId.Length > 0 &&
                (!units.Any(unit => unit.Id == use.UnitId) || units.Any(unit => unit.Id == use.UnitId && LearningStructure.IsHidden(unit, units)) ||
                 use.Role == "teaching" && units.Any(unit => unit.Id == use.UnitId && LearningStructure.Kind(unit) == "tasks")))) status = "stale";
            var sections = version?.Sections.Where(section => section.Sources.Any(reference => reference.MaterialId == source.Id)).Select(section => section.Id).ToArray() ?? [];
            var exercises = version?.Exercises.Where(exercise => exercise.Sources.Any(reference => reference.MaterialId == source.Id)).Select(exercise => exercise.Id).ToArray() ?? [];
            var defaultPlacementId = sourceUnit?.Id;
            var hidden = decision?.Disposition == "exclude";
            var currentPlacementId = hidden ? null : decision?.Disposition == "use"
                ? decision.Uses.OrderBy(use => use.Order ?? int.MaxValue).Select(use => use.UnitId).FirstOrDefault(id => !string.IsNullOrWhiteSpace(id)) ?? defaultPlacementId
                : defaultPlacementId;
            return new PipelineSourceView(source, status, decision, sections, exercises, version?.UnmappedSourceRefs?.Count(reference => reference.MaterialId == source.Id) ?? 0,
                defaultPlacementId, currentPlacementId, hidden);
        }).ToArray();
        var suggestions = LearningStructure.Suggestions(courseId, groups);
        return new(courseId, plan.Revision, observed.Hash, plan.SyncedAt is not null, observed.Problem, groups, views,
            units, suggestions, plan.History, views.Count(item => item.Status is "stale" or "partial" or "not-returned" || item.Status == "pending" && item.CurrentPlacementId is null),
            views.Count(item => item.Source.Acquisition != "ready" && item.Status is not ("excluded" or "structure-hidden")),
            version?.Sections.Where(section => section.Sources.Length == 0).Select(section => section.Id).ToArray() ?? []);
    }

    private void Capture(PipelinePlan plan, PipelineObservation observed)
    {
        plan.Sources = MergeSources(plan.Sources, observed.Sources, true);
        plan.Groups = observed.Groups.Concat(plan.Groups.Where(old => !observed.Groups.Any(group => group.Id == old.Id))).ToArray();
        plan.SyncedAt = clock.GetUtcNow();
        plan.ObservedHash = observed.Hash;
    }
    private static PipelineSource[] MergeSources(PipelineSource[] saved, PipelineSource[] observed, bool successful) => successful
        ? observed.Concat(saved.Where(old => !observed.Any(source => source.Id == old.Id)).Select(old => old with { Present = false })).ToArray()
        : saved.Length > 0 ? saved : observed;
    private void AddEvent(PipelinePlan plan, string action, string actor, string reason, string? sourceId = null, SourceDecision? previous = null)
    {
        plan.Revision++;
        plan.History = plan.History.Append(new(plan.Revision, action, actor.Trim(), reason.Trim(), clock.GetUtcNow(), sourceId, previous)).ToArray();
    }
    public static void CheckRevision(PipelinePlan plan, long expected)
    { if (plan.Revision != expected) throw new ApiFailure("pipeline_conflict", "Ein anderer Bearbeiter hat die Struktur geändert. Lade den aktuellen Stand und prüfe deine Änderung erneut.", 409); }
    private static void ValidateReason(string reason, string actor)
    { if (string.IsNullOrWhiteSpace(reason) || reason.Length > 4000 || string.IsNullOrWhiteSpace(actor) || actor.Length > 100) throw Invalid("Begründung und Bearbeiter sind erforderlich."); }
    public static void ValidateUnits(PipelineUnit[] units)
    {
        if (units is null || units.Length > 250 || units.Any(unit => unit is null || !Regex.IsMatch(unit.Id ?? "", "^[a-f0-9]{32}$") ||
            string.IsNullOrWhiteSpace(unit.Title) || unit.Title.Length > 250 || unit.Title.Any(char.IsControl) || unit.Order < 0 ||
            unit.CustomTitle is { } label && (label.Length > 250 || string.IsNullOrWhiteSpace(label) || label.Any(char.IsControl)) ||
            LearningStructure.Kind(unit) is not ("script" or "tasks") || unit.SourceGroupId is <= 0) || units.Select(unit => unit.Id).Distinct().Count() != units.Length)
            throw Invalid("Die Lerneinheiten sind ungültig.");
        var byId = units.ToDictionary(unit => unit.Id);
        foreach (var unit in units)
        {
            var seen = new HashSet<string> { unit.Id }; var parent = unit.ParentId;
            while (parent is not null)
            {
                if (!seen.Add(parent) || !byId.TryGetValue(parent, out var ancestor) || LearningStructure.Kind(ancestor) != LearningStructure.Kind(unit)) throw Invalid("Ungültige oder zyklische Gliederung.");
                parent = ancestor.ParentId;
            }
            var links = unit.ScriptUnitIds ?? [];
            if (links.Length > 250 || links.Distinct().Count() != links.Length || links.Length > 0 && LearningStructure.Kind(unit) != "tasks" ||
                links.Any(id => id is null || !byId.TryGetValue(id, out var target) || LearningStructure.Kind(target) != "script"))
                throw Invalid("Aufgabengruppen können nur vorhandenen Skript-Lerneinheiten zugeordnet werden.");
        }
        if (units.GroupBy(unit => (LearningStructure.Kind(unit), unit.ParentId, unit.Order)).Any(group => group.Count() > 1)) throw Invalid("Die Reihenfolge ist nicht eindeutig.");
    }
    public static PipelineUnit[] OrderedUnits(PipelineUnit[] units)
    {
        var result = new List<PipelineUnit>();
        void Add(string? parent) { foreach (var unit in units.Where(unit => unit.ParentId == parent).OrderBy(unit => unit.Order)) { result.Add(unit); Add(unit.Id); } }
        Add(null); return result.ToArray();
    }
    private static ApiFailure Invalid(string message) => new("pipeline_invalid", message, 400);
}
