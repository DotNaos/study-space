using System.Text;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Learning;

// A read projection: source documents, saved versions, exercise IDs and user drafts stay immutable.
public static partial class LearningPresentation
{
    public static string RepairDirections(string text) => DirectionGlyph().Replace(text, match =>
        match.Groups["before"].Value.TrimStart()[0] == match.Groups["after"].Value.TrimStart()[0] ? match.Value :
            match.Groups["before"].Value + "→" + match.Groups["after"].Value);

    public static bool HasInvalidControls(string text) => text.Any(character => character < ' ' && character is not ('\t' or '\r' or '\n'));

    public static LearningExercise Exercise(LearningExercise exercise, IReadOnlyList<ChunkBlock> sourceBlocks) => exercise with
    {
        Title = RepairDirections(exercise.Title), Prompt = RepairDirections(exercise.Prompt),
        Hint = RepairDirections(exercise.Hint), Solution = RepairDirections(exercise.Solution),
        Origin = IsSource(exercise.Prompt, exercise.Sources, sourceBlocks) ? "source" : "generated"
    };

    public static async Task<LearningVersion> Version(LearningVersion version, IMaterialCatalog materials, CancellationToken ct)
    {
        var sourceBlocks = new List<ChunkBlock>();
        var needed = version.Exercises.SelectMany(exercise => exercise.Sources).Select(source => (source.MaterialId, source.Revision)).ToHashSet();
        foreach (var source in version.Sources.DistinctBy(source => (source.MaterialId, source.Revision)).Where(source => needed.Contains((source.MaterialId, source.Revision))))
        {
            try
            {
                var document = await materials.GetDocument(source.MaterialId, source.Revision, ct);
                sourceBlocks.AddRange(document.Blocks.OrderBy(block => block.Order).Select(block => new ChunkBlock(
                    new(source.MaterialId, source.Revision, block.Id, block.Page ?? block.Slide), block.Text)));
            }
            catch (ApiFailure error) when (error.Status is 404 or 409)
            { /* Keep the saved learning text readable, but do not assert unverified source provenance. */ }
        }
        return version with
        {
            Title = RepairDirections(version.Title),
            Sections = version.Sections.Select(section => section with { Title = RepairDirections(section.Title), Markdown = RepairDirections(section.Markdown) }).ToArray(),
            Exercises = version.Exercises.Select(exercise => Exercise(exercise, sourceBlocks)).ToArray()
        };
    }

    private static bool IsSource(string prompt, SourceRef[] citations, IReadOnlyList<ChunkBlock> blocks)
    {
        var expected = Comparable(prompt);
        if (expected.Length == 0) return false;
        foreach (var document in blocks.GroupBy(block => (block.Source.MaterialId, block.Source.Revision)))
        {
            if (!citations.Any(source => (source.MaterialId, source.Revision) == document.Key)) continue;
            var joined = new StringBuilder(); var ranges = new List<(SourceRef Source, int Start, int End)>();
            foreach (var block in document)
            {
                var text = Comparable(block.Text);
                if (text.Length == 0) continue;
                if (joined.Length > 0) joined.Append(' ');
                var start = joined.Length; joined.Append(text); ranges.Add((block.Source, start, joined.Length));
            }
            var content = joined.ToString(); var offset = 0;
            while ((offset = content.IndexOf(expected, offset, StringComparison.Ordinal)) >= 0)
            {
                if (ranges.Any(range => range.Start < offset + expected.Length && range.End > offset && citations.Contains(range.Source))) return true;
                offset++;
            }
        }
        return false;
    }
    private static string Comparable(string text) => Whitespace().Replace(RepairDirections(text), " ").Trim();
    [GeneratedRegex("(?<before>[53]['\\u2018\\u2019\\u2032]\\s*)[\\uF0E0\\u001F](?<after>\\s*[53]['\\u2018\\u2019\\u2032])", RegexOptions.CultureInvariant)]
    private static partial Regex DirectionGlyph();
    [GeneratedRegex("\\s+", RegexOptions.CultureInvariant)] private static partial Regex Whitespace();
}
