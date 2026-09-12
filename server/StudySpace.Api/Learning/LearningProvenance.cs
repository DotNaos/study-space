using System.Text.Json;
namespace StudySpace.Api.Learning;

public sealed record ScriptSpan(int Start, int End, string Quote, SourceRef[] Sources, string Origin);
public sealed record ScriptProvenance(string MarkdownHash, ScriptSpan[] Spans, string Status = "unreviewed");

public static class LearningProvenance
{
    public static ScriptProvenance? Read(JsonElement section, string markdown, LearningChunk chunk)
    {
        if (!section.TryGetProperty("mappings", out var value)) return null;
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 200) throw new JsonException();
        var spans = new List<ScriptSpan>();
        foreach (var mapping in value.EnumerateArray())
        {
            var quote = LearningPresentation.RepairDirections(mapping.GetProperty("quote").GetString() ?? throw new JsonException());
            var origin = mapping.GetProperty("origin").GetString();
            if (origin is not ("source" or "agent") || string.IsNullOrWhiteSpace(quote)) throw new JsonException();
            var start = markdown.IndexOf(quote, StringComparison.Ordinal);
            if (start < 0 || markdown.IndexOf(quote, start + 1, StringComparison.Ordinal) >= 0) throw new JsonException();
            var labels = mapping.GetProperty("sources").EnumerateArray().ToArray();
            if (labels.Length > 100 || (origin == "source") != (labels.Length > 0)) throw new JsonException();
            var refs = labels.Select(label =>
            {
                if (!label.TryGetInt32(out var index) || index < 1 || index > chunk.Blocks.Length) throw new JsonException();
                return chunk.Blocks[index - 1].Source;
            }).Distinct().ToArray();
            spans.Add(new(start, start + quote.Length, quote, refs, origin));
        }
        var sorted = spans.OrderBy(span => span.Start).ToArray();
        for (var i = 1; i < sorted.Length; i++)
            if (sorted[i].Start < sorted[i - 1].End) throw new JsonException();
        return new(LearningChunks.Hash(markdown), sorted);
    }

    public static LearningSection Project(LearningSection section)
    {
        var markdown = LearningPresentation.RepairDirections(section.Markdown);
        var provenance = section.Provenance;
        if (provenance is not null && provenance.MarkdownHash != LearningChunks.Hash(markdown))
            provenance = provenance with { Status = "stale" };
        return section with { Title = LearningPresentation.RepairDirections(section.Title), Markdown = markdown, Provenance = provenance };
    }
}
