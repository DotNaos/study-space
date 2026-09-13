using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Learning;

public sealed record LearningComponent(string Name, Dictionary<string, string> Attributes);

// A deliberately small, inert MDX profile. No JavaScript compiler or evaluator is used.
// Components are self-closing, literal-attribute, top-level lines; code/math stay ordinary Markdown.
public static partial class LearningMdx
{
    public static LearningComponent[] Parse(string text)
    {
        if (text.Length > 100000 || LearningPresentation.HasInvalidControls(text)) throw Invalid("Der Abschnitt ist zu groß oder enthält ungültige Zeichen.");
        var components = new List<LearningComponent>();
        string? fence = null; string? math = null;
        var lines = text.Replace("\r\n", "\n").Split('\n');
        for (var lineIndex = 0; lineIndex < lines.Length; lineIndex++)
        {
            var raw = lines[lineIndex]; var line = raw.Trim();
            var code = Fence().Match(line);
            if (fence is not null)
            { if (code.Success && code.Groups[1].Value[0] == fence[0] && code.Groups[1].Length >= fence.Length && line.Trim(fence[0]).Length == 0) fence = null; continue; }
            if (code.Success) { fence = code.Groups[1].Value; continue; }
            if (math is not null) { if (line.EndsWith(math, StringComparison.Ordinal)) math = null; continue; }
            if (line == "$$" || line == "\\[") { math = line == "$$" ? "$$" : "\\]"; continue; }
            var match = Component().Match(line);
            if (match.Success)
            {
                if (raw != line || lineIndex > 0 && !string.IsNullOrWhiteSpace(lines[lineIndex - 1]) || lineIndex + 1 < lines.Length && !string.IsNullOrWhiteSpace(lines[lineIndex + 1]))
                    throw Invalid("Komponenten müssen auf einer eigenen, durch Leerzeilen getrennten Zeile stehen.");
                var name = match.Groups[1].Value; var rest = match.Groups[2].Value;
                var attributes = new Dictionary<string, string>(StringComparer.Ordinal);
                var cursor = 0;
                foreach (Match attribute in Attribute().Matches(rest))
                {
                    if (!string.IsNullOrWhiteSpace(rest[cursor..attribute.Index]) || !attributes.TryAdd(attribute.Groups[1].Value, attribute.Groups[2].Value))
                        throw Invalid("Komponenten erlauben nur eindeutige, wörtliche Attribute in doppelten Anführungszeichen.");
                    cursor = attribute.Index + attribute.Length;
                }
                if (!string.IsNullOrWhiteSpace(rest[cursor..])) throw Invalid("Ungültige Komponentenattribute.");
                var allowed = name == "Figure" ? new[] { "materialId", "revision", "assetId", "alt" } : new[] { "id" };
                if (attributes.Keys.Except(allowed).Any() || allowed.Any(key => !attributes.ContainsKey(key))) throw Invalid("Unbekannte oder fehlende Komponentenattribute.");
                if (name == "Figure" && (!Hex64().IsMatch(attributes["materialId"]) || !Hex64().IsMatch(attributes["revision"]) || !AssetId().IsMatch(attributes["assetId"]) || string.IsNullOrWhiteSpace(attributes["alt"])))
                    throw Invalid("Die Abbildung benötigt eine gültige gespeicherte Quelle und einen Alternativtext.");
                if (name == "TaskRef" && !LogicalId().IsMatch(attributes["id"])) throw Invalid("Ungültige Aufgabenreferenz.");
                components.Add(new(name, attributes)); continue;
            }
            // A brace in prose can be escaped; braces inside code and math are not MDX expressions.
            var prose = InlineCode().Replace(line, "");
            prose = InlineMath().Replace(prose, "");
            if (UnsafeSyntax().IsMatch(prose)) throw Invalid("Dieses Lern-MDX erlaubt Markdown, Formeln sowie Figure und TaskRef als eigene Zeilen. JavaScript, Imports und HTML sind nicht erlaubt.");
        }
        if (fence is not null || math is not null) throw Invalid("Schließe den Code- oder Formelblock vor dem Speichern.");
        return components.ToArray();
    }

    public static async Task Validate(string text, LearningVersion version, IMaterialCatalog materials, CancellationToken ct)
    {
        foreach (var component in Parse(text))
        {
            var attributes = component.Attributes;
            if (component.Name == "TaskRef")
            {
                if (!version.Exercises.Any(task => task.Id == LearningTaskReview.Resolve(version, attributes["id"]))) throw Invalid("Diese Aufgabe gehört nicht zur gewählten Lernversion.");
                continue;
            }
            if (!version.Sources.Any(source => source.MaterialId == attributes["materialId"] && source.Revision == attributes["revision"]))
                throw Invalid("Diese Abbildung gehört nicht zu den Quellen dieser Lernversion.");
            var document = await materials.GetDocument(attributes["materialId"], attributes["revision"], ct);
            var asset = document.Assets.SingleOrDefault(asset => asset.Id == attributes["assetId"]);
            if (asset is null || asset.MimeType is not ("image/png" or "image/jpeg" or "image/gif" or "image/webp"))
                throw Invalid("Die Abbildung ist in der gespeicherten Quelle nicht vorhanden oder kein unterstütztes Bild.");
        }
    }
    private static ApiFailure Invalid(string reason) => new("learning_mdx_invalid", reason, 400);
    [GeneratedRegex("^(`{3,}|~{3,})")] private static partial Regex Fence();
    [GeneratedRegex("^<(Figure|TaskRef)\\s+([^<>]*)/\\s*>$")] private static partial Regex Component();
    [GeneratedRegex("([A-Za-z][A-Za-z0-9]*)\\s*=\\s*\"([^\"<>\\r\\n{}&]*)\"")] private static partial Regex Attribute();
    [GeneratedRegex("^[a-f0-9]{64}$")] private static partial Regex Hex64();
    [GeneratedRegex("^[a-z0-9-]{1,80}$")] private static partial Regex AssetId();
    [GeneratedRegex("^[a-f0-9]{32,64}$")] private static partial Regex LogicalId();
    [GeneratedRegex("`+[^`]*`+")] private static partial Regex InlineCode();
    [GeneratedRegex(@"\$\$.*?\$\$|\$[^$]*\$|\\\(.*?\\\)|\\\[.*?\\\]")] private static partial Regex InlineMath();
    [GeneratedRegex(@"(^|\s)(import|export)\s|</?[A-Za-z!]|(?<!\\)[{}]")] private static partial Regex UnsafeSyntax();
}
