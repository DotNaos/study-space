using System.Text.Json;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

public static class MaterialNotebookExtractor
{
    // Inspect cell data only; never execute kernels, code cells, outputs, or HTML.
    public static MaterialExtraction Extract(byte[] bytes)
    {
        using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 64 });
        if (!json.RootElement.TryGetProperty("cells", out var cells) || cells.ValueKind != JsonValueKind.Array)
            throw new ApiFailure("material_notebook_invalid", "Das Notebook enthält keine gültige Zellenstruktur.", 415);
        var blocks = new List<MaterialBlock>(); var warnings = new List<string>(); var index = 0;
        foreach (var cell in cells.EnumerateArray())
        {
            index++;
            var type = cell.TryGetProperty("cell_type", out var kind) ? kind.GetString() : null;
            if (!cell.TryGetProperty("source", out var value)) { warnings.Add($"Zelle {index}: Quellinhalt fehlt."); continue; }
            var text = value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : value.ValueKind == JsonValueKind.Array
                ? string.Concat(value.EnumerateArray().Select(part => part.GetString())) : throw new ApiFailure("material_notebook_invalid", "Notebook-Zellinhalt ist ungültig.", 415);
            // Keep original cell numbering (not a PDF page) and deterministic block ID.
            blocks.Add(new($"cell-{index:00000}", type == "code" ? "code" : "paragraph", text, index - 1, null, null, null));
            if (cell.TryGetProperty("outputs", out var outputs) && outputs.ValueKind == JsonValueKind.Array && outputs.GetArrayLength() > 0)
                warnings.Add($"Zelle {index}: gespeicherte Ausgaben bleiben im Original; sie wurden nicht als verifizierte Ergebnisse übernommen.");
            if (cell.TryGetProperty("attachments", out var attachments) && attachments.ValueKind == JsonValueKind.Object && attachments.EnumerateObject().Any())
                warnings.Add($"Zelle {index}: eingebettete Anhänge verbleiben im Original.");
        }
        return new(blocks.ToArray(), [], [new("notebook-cells", "1", 0, MaterialStore.Hash(bytes))], warnings.Distinct().ToArray(), warnings.Count == 0);
    }
}
