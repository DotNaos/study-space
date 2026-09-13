using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Pipeline;

public sealed class PipelineInventory(IMaterialSourceProvider provider, IMaterialCatalog catalog) : IPipelineInventory
{
    public async Task<PipelineObservation> Read(long courseId, CancellationToken ct)
    {
        var inventory = await provider.Inventory(courseId, ct);
        var prepared = await catalog.GetSnapshot(courseId, ct);
        var entries = prepared.Materials.ToDictionary(item => item.Id);
        var sections = inventory.Sections ?? [];
        var parents = sections.SelectMany(section => section.Modules.Where(module => module.SubsectionId is not null)
            .Select(module => (Child: module.SubsectionId!.Value, Parent: section.Id)))
            .GroupBy(item => item.Child).Where(group => group.Select(item => item.Parent).Distinct().Count() == 1)
            .ToDictionary(group => group.Key, group => group.First().Parent);
        // Incomplete or cyclic provider nesting never makes a section unreachable.
        long? Parent(long id)
        {
            if (!parents.TryGetValue(id, out var parent) || !sections.Any(s => s.Id == parent)) return null;
            var seen = new HashSet<long> { id }; var cursor = parent;
            while (seen.Add(cursor)) { if (!parents.TryGetValue(cursor, out var next)) return parent; cursor = next; }
            return null;
        }
        var groups = sections.Select((section, index) => new PipelineGroup(section.Id, section.Name, index, Parent(section.Id))).ToList();
        foreach (var source in inventory.Sources)
            if (!groups.Any(group => group.Id == source.SectionId))
                groups.Add(new(source.SectionId, source.SectionName, groups.Count));
        var sources = inventory.Sources.Select(source =>
        {
            entries.TryGetValue(source.Id, out var stored);
            var module = sections.SelectMany(s => s.Modules).FirstOrDefault(m => m.Id == source.ModuleId);
            var title = source.ActivityName ?? module?.Name;
            var name = source.Name == "index.html" && !string.IsNullOrWhiteSpace(title) ? title : source.Name;
            var text = source.InlineText is null ? "" : MoodleText.Plain(source.InlineText);
            var warnings = (stored?.Warnings ?? []).ToList();
            var needsImport = stored?.Status == "ready" && stored.CapturedSourceHash != source.AcquisitionHash();
            if (needsImport) warnings.Add("Die gespeicherte Fassung ist nicht gegen die aktuellen Moodle-Metadaten bestätigt. Quelle erneut aufbereiten; die alte Fassung bleibt lesbar.");
            if (text.Length > 64000) warnings.Add("Vorschautext gekürzt; die vollständige Quelle muss vor der Verarbeitung erfasst werden.");
            var fingerprint = MaterialStore.Hash(JsonSerializer.Serialize(new
            {
                source.Id, source.SectionId, source.SectionName, source.ModuleId, source.Name,
                title, activityType = source.ActivityType ?? module?.Type, source.Kind, source.MimeType,
                source.ModifiedAt, source.Size, text, revision = stored?.Revision
            }));
            var path = source.ModuleId is { } moduleId ? $"/courses/{courseId}/activities/{moduleId}" : $"/courses/{courseId}";
            return new PipelineSource(source.Id, source.SectionId, source.ModuleId, name, source.Kind, source.MimeType,
                fingerprint, stored?.Revision, needsImport ? "needs-reimport" : stored?.Status ?? (source.UnavailableReason is null ? "not-imported" : "unsupported"),
                stored?.Reason ?? source.UnavailableReason, warnings.ToArray(), text[..Math.Min(text.Length, 64000)], path, true,
                ProposeRole(name, source.ActivityType ?? module?.Type, source.Kind));
        }).ToArray();
        var hash = MaterialStore.Hash(JsonSerializer.Serialize(new { groups, sources = sources.Select(source => new { source.Id, source.SourceVersion }) }));
        return new(groups.ToArray(), sources, hash, null);
    }

    public static string ProposeRole(string name, string? activityType, string kind)
    {
        // Display suggestions only. No regular expression can approve semantic use.
        var value = name.ToLowerInvariant();
        if (Regex.IsMatch(value, "lösung|loesung|solution|verbesserung")) return "solution";
        if (Regex.IsMatch(value, "aufgab|übung|uebung|exercise|worksheet|hackathon")) return "task";
        if (Regex.IsMatch(value, "\\.(csv|json|ttl|zip|py|ipynb)$")) return "support";
        if (Regex.IsMatch(value, "syllabus|modulbeschreib|semester|vorlage|template") || activityType is "forum" or "lti") return "reference";
        if (kind is "reference" or "activity") return "unresolved";
        return "teaching";
    }
}
