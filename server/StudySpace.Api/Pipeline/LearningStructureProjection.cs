using System.Text.RegularExpressions;
using StudySpace.Api.Materials;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Pipeline;

public static partial class LearningStructure
{
    private static string GroupKey(long courseId, long groupId) => MaterialStore.Hash($"unit:{courseId}:{groupId}")[..32];

    public static PipelineUnit[] Normalize(long courseId, PipelineUnit[] units, PipelineGroup[] groups) => units.Select(unit =>
    {
        var group = groups.FirstOrDefault(group => unit.SourceGroupId is { } sourceId
            ? group.Id == sourceId : GroupKey(courseId, group.Id) == unit.Id);
        var custom = unit.CustomTitle;
        if (group is not null && unit.SourceGroupId is null && unit.Title != group.Title && custom is null) custom = unit.Title;
        return unit with { Title = group?.Title ?? unit.Title, SourceGroupId = group?.Id ?? unit.SourceGroupId,
            CustomTitle = string.IsNullOrWhiteSpace(custom) ? null : custom.Trim(), Kind = Kind(unit), Hidden = unit.Hidden ?? false,
            ScriptUnitIds = unit.ScriptUnitIds ?? [] };
    }).ToArray();

    public static PipelineUnit[] Suggestions(long courseId, PipelineGroup[] groups)
    {
        string GroupKind(PipelineGroup group) => Regex.IsMatch(group.Title, @"^\s*(Aufgabe[n]?\s*\d|Übungsblatt|Aufgabenblatt|Assignment\s*\d)", RegexOptions.IgnoreCase) ? "tasks" : "script";
        return groups.Select(group =>
        {
            var parent = groups.FirstOrDefault(item => item.Id == group.ParentId);
            var kind = GroupKind(group);
            return new PipelineUnit(GroupKey(courseId, group.Id), group.Title,
                parent is not null && GroupKind(parent) == kind ? GroupKey(courseId, parent.Id) : null,
                group.Order, kind, false, null, group.Id,
                kind == "tasks" && parent is not null && GroupKind(parent) == "script" ? [GroupKey(courseId, parent.Id)] : []);
        }).ToArray();
    }

    public static PipelineUnit[] Apply(long courseId, PipelineUnit[] previous, PipelineUnit[] requested, PipelineGroup[] groups, IReadOnlySet<string>? deletedUnitIds = null)
    {
        var old = Normalize(courseId, previous, groups).ToDictionary(unit => unit.Id);
        var next = requested.Select(unit =>
        {
            old.TryGetValue(unit.Id, out var prior);
            var sourceId = prior?.SourceGroupId ?? unit.SourceGroupId;
            var group = groups.FirstOrDefault(group => group.Id == sourceId);
            if (sourceId is not null && group is null && prior is null)
                throw new ApiFailure("pipeline_invalid", "Die Quellengruppe ist nicht bekannt.", 400);
            return unit with { Title = group?.Title ?? prior?.Title ?? unit.Title.Trim(), SourceGroupId = sourceId,
                Kind = unit.Kind ?? prior?.Kind ?? "script", Hidden = unit.Hidden ?? prior?.Hidden ?? false,
                CustomTitle = string.IsNullOrWhiteSpace(unit.CustomTitle) ? null : unit.CustomTitle.Trim(),
                ScriptUnitIds = unit.ScriptUnitIds ?? prior?.ScriptUnitIds ?? [] };
        }).ToList();
        // Omission remains backwards-compatible hiding. Only an explicit delete removes a
        // user-created entry; provider-backed entries always remain recoverable.
        foreach (var missing in old.Values.Where(unit => requested.All(item => item.Id != unit.Id)))
            if (missing.SourceGroupId is not null || deletedUnitIds is null || !deletedUnitIds.Contains(missing.Id))
                next.Add(missing with { Hidden = true });
        foreach (var siblings in next.GroupBy(unit => (Kind(unit), unit.ParentId)))
        {
            var ordered = siblings.OrderBy(unit => unit.Order).ThenBy(unit => unit.Hidden == true).ToArray();
            for (var index = 0; index < ordered.Length; index++) next[next.FindIndex(unit => unit.Id == ordered[index].Id)] = ordered[index] with { Order = index };
        }
        return next.ToArray();
    }
}
