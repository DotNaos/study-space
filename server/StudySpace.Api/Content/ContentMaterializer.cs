using System.Text;
using StudySpace.Api.Materials;

namespace StudySpace.Api.Content;

public static class ContentMaterializer
{
    public static (string Content, ContentProvenance[] Provenance) Materialize(MaterialDocument document)
    {
        var output = new StringBuilder();
        var provenance = new List<ContentProvenance>();
        foreach (var block in document.Blocks.OrderBy(block => block.Order))
        {
            if (string.IsNullOrWhiteSpace(block.Text)) continue;
            if (output.Length > 0) output.Append("\n\n");
            var start = output.Length;
            output.Append(Render(block));
            provenance.Add(new(block.Id, block.Page, block.Slide, block.Bounds, start, output.Length - start));
        }
        return (output.ToString().TrimEnd() + (output.Length > 0 ? "\n" : ""), provenance.ToArray());
    }

    private static string Render(MaterialBlock block)
    {
        var text = Safe(block.Text.Trim());
        return block.Kind switch
        {
            "heading" => "## " + SingleLine(text),
            "list" => string.Join("\n", text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Select(line => "- " + line)),
            "code" => "```text\n" + text + "\n```",
            _ => text
        };
    }

    private static string SingleLine(string value) => string.Join(" ", value.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
    private static string Safe(string value) => value.Replace("<", "&lt;", StringComparison.Ordinal)
        .Replace("{", "&#123;", StringComparison.Ordinal).Replace("}", "&#125;", StringComparison.Ordinal);
}
