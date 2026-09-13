using System.Text;
using System.Text.Json;
namespace StudySpace.Api.Learning;

public static class ReviewedGeneration
{
    public static (LearningSection[] Sections, LearningExercise[] Exercises) Assemble(LearningChunk[] chunks, IReadOnlyList<ChunkResult> results)
    {
        var sections = new List<LearningSection>(); var tasks = new List<LearningExercise>();
        foreach (var unit in chunks.Select((chunk, index) => (Chunk: chunk, Result: results[index])).GroupBy(item => item.Chunk.UnitId))
        {
            var text = new StringBuilder(); var spans = new List<ScriptSpan>(); var refs = new List<SourceRef>();
            foreach (var item in unit)
            {
                if (item.Chunk.Roles.Contains("teaching"))
                    foreach (var section in item.Result.Sections)
                    {
                        if (text.Length > 0) text.Append("\n\n");
                        text.Append("## ").Append(section.Title).Append("\n\n");
                        var start = text.Length; text.Append(section.Markdown); refs.AddRange(section.Sources);
                        if (section.Provenance is { } provenance && provenance.MarkdownHash == LearningChunks.Hash(section.Markdown))
                            spans.AddRange(provenance.Spans.Select(span => span with { Start = span.Start + start, End = span.End + start }));
                    }
                if (!item.Chunk.Roles.Contains("solution"))
                    foreach (var task in item.Result.Exercises)
                    {
                        // The same immutable source task used by two units is one occurrence,
                        // but text similarity across DIFFERENT sources never silently merges tasks.
                        var identity = JsonSerializer.Serialize(new { task.Prompt, Sources = task.Sources.OrderBy(s => s.MaterialId).ThenBy(s => s.BlockId) });
                        var taskId = LearningChunks.Hash("reviewed-task:" + identity);
                        tasks.Add(task with { Id = taskId, SolutionOrigin = "agent", UnitIds = [item.Chunk.UnitId!] });
                        if (item.Chunk.Roles.Contains("teaching"))
                        {
                            text.Append("\n\n"); var offset = text.Length; var reference = "<TaskRef id=\"" + taskId + "\" />";
                            text.Append(reference).Append("\n\n"); refs.AddRange(task.Sources);
                            spans.Add(new(offset, offset + reference.Length, reference, task.Sources, "source"));
                        }
                    }
            }
            if (text.Length > 0)
            {
                var markdown = text.ToString();
                LearningMdx.Parse(markdown);
                sections.Add(new(LearningChunks.Hash("learning-unit:" + unit.Key), unit.First().Chunk.SectionName, markdown,
                    refs.Distinct().ToArray(), new(LearningChunks.Hash(markdown), spans.ToArray()), "mdx", unit.Key));
            }
        }
        return (sections.ToArray(), tasks.GroupBy(task => task.Id).Select(group => group.First() with { UnitIds = group.SelectMany(task => task.UnitIds ?? []).Distinct().ToArray() }).ToArray());
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
