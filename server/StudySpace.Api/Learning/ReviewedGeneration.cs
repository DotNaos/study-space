using System.Text;
using System.Text.Json;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Learning;

public static class ReviewedGeneration
{
    public static (LearningSection[] Sections, LearningExercise[] Exercises) Assemble(
        LearningChunk[] chunks, IReadOnlyList<ChunkResult> results, PipelineUnit[]? units = null)
    {
        var items = chunks.Select((chunk, index) => (Chunk: chunk, Result: results[index])).ToArray();
        var tasks = new List<LearningExercise>();
        foreach (var item in items)
            if (!item.Chunk.Roles.Contains("solution"))
                foreach (var task in item.Result.Exercises)
                {
                    // The same immutable source task used by two units is one occurrence,
                    // but text similarity across DIFFERENT sources never silently merges tasks.
                    var identity = JsonSerializer.Serialize(new { task.Prompt, Sources = task.Sources.OrderBy(s => s.MaterialId).ThenBy(s => s.BlockId) });
                    var taskId = LearningChunks.Hash("reviewed-task:" + identity);
                    tasks.Add(task with { Id = taskId, SolutionOrigin = "agent", UnitIds = [item.Chunk.UnitId!] });
                }

        var sections = units is { Length: > 0 }
            ? AssembleStructure(items, units, tasks)
            : AssembleFlat(items, tasks);
        return (sections, tasks.GroupBy(task => task.Id).Select(group => group.First() with
        {
            UnitIds = group.SelectMany(task => task.UnitIds ?? []).Distinct().ToArray()
        }).ToArray());
    }

    private static LearningSection[] AssembleStructure(
        (LearningChunk Chunk, ChunkResult Result)[] items, PipelineUnit[] units, IReadOnlyList<LearningExercise> tasks)
    {
        var visible = PipelineService.OrderedUnits(units)
            .Where(unit => LearningStructure.Kind(unit) == "script" && !LearningStructure.IsHidden(unit, units)).ToArray();
        var visibleIds = visible.Select(unit => unit.Id).ToHashSet();
        var knownIds = units.Select(unit => unit.Id).ToHashSet();
        var roots = visible.Where(unit => unit.ParentId is null || !visibleIds.Contains(unit.ParentId)).ToArray();
        var output = new List<LearningSection>();

        foreach (var root in roots)
        {
            var descendants = visible.Where(unit => Root(unit, units)?.Id == root.Id).ToArray();
            var section = AssembleRoot(root, descendants, items, tasks);
            if (section is not null) output.Add(section);
        }

        // Frozen reviewed inputs should always point at a frozen structure unit. Preserve content rather than
        // silently dropping it if an older or partially migrated version violates that invariant.
        var unmatched = items.Where(item => item.Chunk.UnitId is null || !knownIds.Contains(item.Chunk.UnitId))
            .GroupBy(item => item.Chunk.UnitId);
        output.AddRange(AssembleFlatGroups(unmatched, tasks));
        return output.ToArray();
    }

    private static PipelineUnit? Root(PipelineUnit unit, PipelineUnit[] units)
    {
        var current = unit;
        var visited = new HashSet<string>();
        while (current.ParentId is { } parentId && visited.Add(current.Id))
        {
            var parent = units.FirstOrDefault(candidate => candidate.Id == parentId);
            if (parent is null || LearningStructure.Kind(parent) != "script" || LearningStructure.IsHidden(parent, units)) break;
            current = parent;
        }
        return current;
    }

    private static LearningSection? AssembleRoot(
        PipelineUnit root, PipelineUnit[] orderedUnits, (LearningChunk Chunk, ChunkResult Result)[] items,
        IReadOnlyList<LearningExercise> tasks)
    {
        var text = new StringBuilder();
        var spans = new List<ScriptSpan>();
        var refs = new List<SourceRef>();
        var depths = orderedUnits.ToDictionary(unit => unit.Id, unit => Depth(unit, root.Id, orderedUnits));
        var contentUnits = items.Where(HasTeachingContent).Select(item => item.Chunk.UnitId).OfType<string>().ToHashSet();

        foreach (var unit in orderedUnits)
        {
            var unitItems = items.Where(item => item.Chunk.UnitId == unit.Id).ToArray();
            var depth = depths[unit.Id];
            var subtreeHasContent = orderedUnits.Any(candidate => contentUnits.Contains(candidate.Id) && IsWithin(candidate, unit.Id, orderedUnits));
            if (depth > 0 && subtreeHasContent)
                AppendHeading(text, Math.Min(6, depth + 1), LearningStructure.DisplayTitle(unit));
            AppendUnit(text, spans, refs, unitItems, tasks, Math.Min(6, depth + 2));
        }

        if (text.Length == 0) return null;
        var markdown = text.ToString().Trim();
        LearningMdx.Parse(markdown);
        return new(LearningChunks.Hash("learning-unit:" + root.Id), LearningStructure.DisplayTitle(root), markdown,
            refs.Distinct().ToArray(), new(LearningChunks.Hash(markdown), spans.ToArray()), "mdx", root.Id);
    }

    private static int Depth(PipelineUnit unit, string rootId, PipelineUnit[] units)
    {
        var depth = 0;
        var current = unit;
        var visited = new HashSet<string>();
        while (current.Id != rootId && current.ParentId is { } parentId && visited.Add(current.Id))
        {
            var parent = units.FirstOrDefault(candidate => candidate.Id == parentId);
            if (parent is null) break;
            depth++;
            current = parent;
        }
        return depth;
    }

    private static bool IsWithin(PipelineUnit unit, string ancestorId, PipelineUnit[] units)
    {
        var current = unit;
        var visited = new HashSet<string>();
        while (visited.Add(current.Id))
        {
            if (current.Id == ancestorId) return true;
            if (current.ParentId is not { } parentId) return false;
            var parent = units.FirstOrDefault(candidate => candidate.Id == parentId);
            if (parent is null) return false;
            current = parent;
        }
        return false;
    }

    private static bool HasTeachingContent((LearningChunk Chunk, ChunkResult Result) item) =>
        item.Chunk.Roles.Contains("teaching") && (item.Result.Sections.Length > 0 || item.Result.Exercises.Length > 0);

    private static void AppendHeading(StringBuilder text, int level, string title)
    {
        if (text.Length > 0) text.Append("\n\n");
        text.Append(new string('#', level)).Append(' ').Append(title).Append("\n\n");
    }

    private static void AppendUnit(StringBuilder text, List<ScriptSpan> spans, List<SourceRef> refs,
        IEnumerable<(LearningChunk Chunk, ChunkResult Result)> items, IReadOnlyList<LearningExercise> tasks, int headingLevel)
    {
        foreach (var item in items)
        {
            if (!item.Chunk.Roles.Contains("teaching")) continue;
            foreach (var section in item.Result.Sections)
            {
                AppendHeading(text, headingLevel, section.Title);
                var start = text.Length;
                text.Append(section.Markdown);
                refs.AddRange(section.Sources);
                if (section.Provenance is { } provenance && provenance.MarkdownHash == LearningChunks.Hash(section.Markdown))
                    spans.AddRange(provenance.Spans.Select(span => span with { Start = span.Start + start, End = span.End + start }));
            }
            foreach (var task in item.Result.Exercises)
            {
                var identity = JsonSerializer.Serialize(new { task.Prompt, Sources = task.Sources.OrderBy(s => s.MaterialId).ThenBy(s => s.BlockId) });
                var taskId = LearningChunks.Hash("reviewed-task:" + identity);
                if (!tasks.Any(candidate => candidate.Id == taskId)) continue;
                if (text.Length > 0) text.Append("\n\n");
                var offset = text.Length;
                var reference = "<TaskRef id=\"" + taskId + "\" />";
                text.Append(reference).Append("\n\n");
                refs.AddRange(task.Sources);
                spans.Add(new(offset, offset + reference.Length, reference, task.Sources, "source"));
            }
        }
    }

    private static LearningSection[] AssembleFlat(
        (LearningChunk Chunk, ChunkResult Result)[] items, IReadOnlyList<LearningExercise> tasks) =>
        AssembleFlatGroups(items.GroupBy(item => item.Chunk.UnitId), tasks).ToArray();

    private static IEnumerable<LearningSection> AssembleFlatGroups(
        IEnumerable<IGrouping<string?, (LearningChunk Chunk, ChunkResult Result)>> groups, IReadOnlyList<LearningExercise> tasks)
    {
        foreach (var unit in groups)
        {
            var text = new StringBuilder();
            var spans = new List<ScriptSpan>();
            var refs = new List<SourceRef>();
            AppendUnit(text, spans, refs, unit, tasks, 2);
            if (text.Length == 0) continue;
            var markdown = text.ToString().Trim();
            LearningMdx.Parse(markdown);
            yield return new(LearningChunks.Hash("learning-unit:" + unit.Key), unit.First().Chunk.SectionName, markdown,
                refs.Distinct().ToArray(), new(LearningChunks.Hash(markdown), spans.ToArray()), "mdx", unit.Key);
        }
    }

    public static LearningSolution[] Solutions(LearningChunk[] chunks, IReadOnlyList<ChunkResult> results) => chunks.SelectMany((chunk, index) =>
        !chunk.Roles.Contains("solution") || chunk.RelatedSourceId is null ? Array.Empty<LearningSolution>() : results[index].Sections.Select(section =>
            new LearningSolution(LearningChunks.Hash("solution:" + section.Id), chunk.Blocks[0].Source.MaterialId, chunk.RelatedSourceId,
                section.Title, section.Markdown, section.Sources))).DistinctBy(solution => solution.Id).ToArray();

    public static SourceRef[] Unmapped(LearningChunk[] chunks, IReadOnlyList<ChunkResult> results)
    {
        var mapped = results.SelectMany(result => result.Sections.SelectMany(section => section.Sources)
            .Concat(result.Exercises.SelectMany(exercise => exercise.Sources))).ToHashSet();
        return chunks.SelectMany(chunk => chunk.Blocks.Select(block => block.Source)).Distinct().Where(source => !mapped.Contains(source)).ToArray();
    }

    public static string[] Warnings(LearningChunk[] chunks, IReadOnlyList<ChunkResult> results)
    {
        var warnings = new List<string>();
        for (var i = 0; i < chunks.Length; i++)
        {
            if (chunks[i].Roles.Contains("solution"))
                warnings.Add(chunks[i].Name + ": Lösungsquelle bleibt erhalten; eine Zuordnung zu einzelnen Aufgaben muss geprüft werden. Keine neue Aufgabe daraus erzeugt.");
            else if (results[i].Sections.Length == 0 && results[i].Exercises.Length == 0)
                warnings.Add(chunks[i].Name + ": Kein Lerninhalt ausgegeben; Inhalt und Verwendung erneut prüfen.");
        }
        var duplicates = results.SelectMany(result => result.Exercises)
            .GroupBy(task => System.Text.RegularExpressions.Regex.Replace(task.Prompt, "\\s+", " ").Trim())
            .Where(group => group.Select(task => string.Join(",", task.Sources.Select(s => s.MaterialId).Distinct().Order())).Distinct().Count() > 1);
        foreach (var group in duplicates) warnings.Add(group.First().Title + ": Mögliche doppelte Aufgabe aus unterschiedlichen Quellen; nicht automatisch zusammengeführt.");
        foreach (var group in Unmapped(chunks, results).GroupBy(source => source.MaterialId))
        {
            var name = chunks.First(chunk => chunk.Blocks.Any(block => block.Source.MaterialId == group.Key)).Name;
            warnings.Add(name + $": {group.Count()} erfasste Quellstellen ohne Ergebnisverweis; Zuordnung ungeklärt, nicht automatisch als verloren bewertet.");
        }
        return warnings.Distinct().ToArray();
    }
}
