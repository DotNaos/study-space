using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

internal sealed class MaterialPdfExtractor(MaterialToolRunner tools)
{
    private sealed record PdfPage(double Width, double Height);
    private sealed record PdfItem(string Text, int Page, double X, double Y, double Width, double Height, string Type);
    private sealed record ParsedBlock(string Kind, string Text, string[][]? Cells = null);

    public async Task<MaterialExtraction> Extract(byte[] bytes, string directory, CancellationToken ct)
    {
        var input = Path.Combine(directory, "input.pdf"); await File.WriteAllBytesAsync(input, bytes, ct);
        var info = await tools.Run("pdfinfo", ["-box", input], directory, TimeSpan.FromSeconds(20), ct);
        var count = Regex.Match(info.Output, @"(?m)^Pages:\s+(\d+)\s*$");
        if (!count.Success || !int.TryParse(count.Groups[1].Value, out var pages) || pages is < 1 or > 200)
            throw new ApiFailure("material_page_limit", "This PDF has an unsupported page count; the current limit is 200 pages.", 415);
        var pageSizes = PageSizes(info.Output, pages);

        var native = await tools.Run("pdf2md", [input, "--json", "--pages"], directory, TimeSpan.FromSeconds(60), ct);
        var nativeResult = InspectorDocument(native.Output, pages);
        var positioned = await tools.Run("pdf2md", [input, "--items-json"], directory, TimeSpan.FromSeconds(60), ct);
        var items = InspectorItems(positioned.Output, pages);
        var structured = MarkdownPages(nativeResult.Markdown, pages);

        var blocks = new List<MaterialBlock>(); var assets = new List<MaterialExtractedAsset>();
        var provenance = new List<MaterialProvenance> { info.Provenance, native.Provenance, positioned.Provenance }; var warnings = new List<string>();
        for (var index = 0; index < pages; index++)
        {
            ct.ThrowIfCancellationRequested(); var number = index + 1; var pageSize = pageSizes[number];
            var prefix = Path.Combine(directory, "page-" + number);
            var render = await tools.Run("pdftoppm", ["-f", number.ToString(CultureInfo.InvariantCulture), "-l", number.ToString(CultureInfo.InvariantCulture), "-singlefile", "-png", "-scale-to", "1800", input, prefix], directory, TimeSpan.FromSeconds(30), ct);
            var imageBytes = await ReadImage(prefix + ".png", ct);
            provenance.Add(render.Provenance with { ResultHash = MaterialStore.Hash(imageBytes) });
            var assetId = $"page-{number:0000}";
            assets.Add(new(assetId, "page-image", "image/png", $"Page {number}.png", imageBytes, number));

            var pageItems = items.Where(item => item.Page == number).ToArray();
            var pageBlocks = structured[number];
            var nativeText = string.Join("\n", pageBlocks.Select(block => block.Text));
            if (nativeResult.PagesNeedingOcr.Contains(number) || nativeText.Count(char.IsLetterOrDigit) < 35 || nativeText.Count(character => character == '\uFFFD') > 2)
            {
                var ocr = await tools.Run("tesseract", [prefix + ".png", "stdout", "-l", "eng+deu", "--psm", "3", "tsv"], directory, TimeSpan.FromSeconds(45), ct);
                provenance.Add(ocr.Provenance);
                var parsed = OcrBlocks(ocr.Output, number, assetId, blocks.Count);
                if (parsed.Count > 0) blocks.AddRange(parsed);
                else
                {
                    blocks.Add(new($"b-{blocks.Count + 1:00000}", "image", "", blocks.Count, number, null, assetId));
                    warnings.Add($"Page {number} is preserved as a source image but has no reliable extracted text.");
                }
            }
            else
            {
                var cursor = 0;
                if (pageBlocks.Count == 0)
                {
                    foreach (var item in pageItems.Where(item => item.Type != "image" && !string.IsNullOrWhiteSpace(item.Text)))
                        blocks.Add(new($"b-{blocks.Count + 1:00000}", "paragraph", item.Text.Trim(), blocks.Count, number, null, assetId, Bounds(item, pageSize)));
                }
                else
                {
                    foreach (var block in pageBlocks)
                    {
                        var bounds = MatchBounds(block, pageItems, pageSize, ref cursor);
                        blocks.Add(new($"b-{blocks.Count + 1:00000}", block.Kind, block.Text, blocks.Count, number, null, assetId, bounds, block.Cells));
                    }
                }
                foreach (var item in pageItems.Where(item => item.Type == "image"))
                    blocks.Add(new($"b-{blocks.Count + 1:00000}", "image", "", blocks.Count, number, null, assetId, Bounds(item, pageSize)));
            }
            File.Delete(prefix + ".png");
        }
        return new(blocks.ToArray(), assets.ToArray(), provenance.ToArray(), warnings.ToArray(), warnings.Count == 0);
    }

    public async Task<MaterialExtraction> Image(MaterialInput input, string directory, CancellationToken ct)
    {
        var path = Path.Combine(directory, "image" + Path.GetExtension(input.Name));
        await File.WriteAllBytesAsync(path, input.Bytes, ct);
        var result = await tools.Run("tesseract", [path, "stdout", "-l", "eng+deu", "--psm", "3", "tsv"], directory, TimeSpan.FromSeconds(60), ct);
        var blocks = OcrBlocks(result.Output, 1, "original", 0);
        var warnings = blocks.Count == 0 ? new[] { "This image is preserved as a source but OCR could not recover reliable text." } : [];
        if (blocks.Count == 0) blocks.Add(new("b-00001", "image", "", 0, 1, null, "original"));
        return new(blocks.ToArray(), [], [result.Provenance], warnings, warnings.Length == 0);
    }

    private static (string Markdown, HashSet<int> PagesNeedingOcr) InspectorDocument(string json, int expectedPages)
    {
        try
        {
            using var document = JsonDocument.Parse(json); var root = document.RootElement;
            if (root.GetProperty("page_count").GetInt32() != expectedPages)
                throw new ApiFailure("material_page_count", "The extracted PDF pages did not match the source page count.", 422);
            var markdown = root.TryGetProperty("markdown", out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
            var ocr = root.TryGetProperty("pages_needing_ocr", out var pages) && pages.ValueKind == JsonValueKind.Array
                ? pages.EnumerateArray().Select(page => page.GetInt32()).Where(page => page is >= 1 && page <= expectedPages).ToHashSet()
                : [];
            return (markdown, ocr);
        }
        catch (JsonException)
        {
            throw new ApiFailure("material_engine_failed", "The PDF extraction engine returned an invalid result. Its original source copy is preserved.", 422);
        }
    }

    private static PdfItem[] InspectorItems(string json, int pages)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.GetProperty("items").EnumerateArray().Select(item => new PdfItem(
                item.GetProperty("text").GetString() ?? "",
                item.GetProperty("page").GetInt32(),
                item.GetProperty("x").GetDouble(), item.GetProperty("y").GetDouble(),
                item.GetProperty("width").GetDouble(), item.GetProperty("height").GetDouble(),
                item.GetProperty("item_type").GetString() ?? "text"))
                .Where(item => item.Page is >= 1 && item.Page <= pages).ToArray();
        }
        catch (JsonException)
        {
            throw new ApiFailure("material_engine_failed", "The PDF extraction engine returned invalid positioned text. Its original source copy is preserved.", 422);
        }
    }

    private static Dictionary<int, PdfPage> PageSizes(string info, int pages)
    {
        var result = new Dictionary<int, PdfPage>();
        foreach (Match match in Regex.Matches(info, @"(?m)^Page\s+(\d+)\s+size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts"))
            if (int.TryParse(match.Groups[1].Value, out var page) &&
                double.TryParse(match.Groups[2].Value, CultureInfo.InvariantCulture, out var width) &&
                double.TryParse(match.Groups[3].Value, CultureInfo.InvariantCulture, out var height) && width > 0 && height > 0)
                result[page] = new(width, height);
        if (result.Count != pages)
        {
            var fallback = Regex.Match(info, @"(?m)^Page size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts");
            if (fallback.Success && double.TryParse(fallback.Groups[1].Value, CultureInfo.InvariantCulture, out var width) &&
                double.TryParse(fallback.Groups[2].Value, CultureInfo.InvariantCulture, out var height) && width > 0 && height > 0)
                for (var page = 1; page <= pages; page++) result.TryAdd(page, new(width, height));
        }
        if (result.Count != pages || result.Values.Any(page => page.Width * page.Height > 16_000_000))
            throw new ApiFailure("material_page_size", "A PDF page has unsupported rendering dimensions.", 413);
        return result;
    }

    private static Dictionary<int, List<ParsedBlock>> MarkdownPages(string markdown, int pages)
    {
        var result = Enumerable.Range(1, pages).ToDictionary(page => page, _ => new List<ParsedBlock>());
        var matches = Regex.Matches(markdown, @"(?m)^<!-- Page (\d+) -->\s*$");
        if (matches.Count == 0)
        {
            result[1].AddRange(ParseMarkdown(markdown));
            return result;
        }
        for (var index = 0; index < matches.Count; index++)
        {
            if (!int.TryParse(matches[index].Groups[1].Value, out var page) || page is < 1 || page > pages) continue;
            var start = matches[index].Index + matches[index].Length;
            var end = index + 1 < matches.Count ? matches[index + 1].Index : markdown.Length;
            result[page].AddRange(ParseMarkdown(markdown[start..end]));
        }
        return result;
    }

    private static List<ParsedBlock> ParseMarkdown(string markdown)
    {
        var lines = markdown.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n').Split('\n');
        var result = new List<ParsedBlock>(); var index = 0;
        while (index < lines.Length)
        {
            if (string.IsNullOrWhiteSpace(lines[index])) { index++; continue; }
            var heading = Regex.Match(lines[index], @"^\s*#{1,6}\s+(.+?)\s*$");
            if (heading.Success) { result.Add(new("heading", NormalizeInline(heading.Groups[1].Value))); index++; continue; }
            if (lines[index].TrimStart().StartsWith("```", StringComparison.Ordinal))
            {
                index++; var code = new List<string>();
                while (index < lines.Length && !lines[index].TrimStart().StartsWith("```", StringComparison.Ordinal)) code.Add(lines[index++]);
                if (index < lines.Length) index++;
                if (code.Count > 0) result.Add(new("code", string.Join("\n", code).Trim()));
                continue;
            }
            if (IsTableStart(lines, index))
            {
                var table = new List<string>();
                while (index < lines.Length && lines[index].TrimStart().StartsWith('|')) table.Add(lines[index++].Trim());
                var cells = table.Where(line => !IsTableSeparator(line)).Select(TableCells).ToArray();
                result.Add(new("table", string.Join("\n", table.Select(NormalizeInline)), cells));
                continue;
            }
            if (ListText(lines[index]) is not null)
            {
                var items = new List<string>();
                while (index < lines.Length && ListText(lines[index]) is { } item) { items.Add(NormalizeInline(item)); index++; }
                result.Add(new("list", string.Join("\n", items)));
                continue;
            }
            var paragraph = new List<string>();
            while (index < lines.Length && !string.IsNullOrWhiteSpace(lines[index]) && !IsSpecial(lines, index)) paragraph.Add(lines[index++].Trim());
            if (paragraph.Count > 0) result.Add(new("paragraph", NormalizeInline(string.Join("\n", paragraph))));
            else index++;
        }
        return result.Where(block => !string.IsNullOrWhiteSpace(block.Text)).ToList();
    }

    private static bool IsSpecial(string[] lines, int index) =>
        Regex.IsMatch(lines[index], @"^\s*#{1,6}\s+") || lines[index].TrimStart().StartsWith("```", StringComparison.Ordinal) ||
        IsTableStart(lines, index) || ListText(lines[index]) is not null;
    private static bool IsTableStart(string[] lines, int index) => index + 1 < lines.Length && lines[index].TrimStart().StartsWith('|') && IsTableSeparator(lines[index + 1]);
    private static bool IsTableSeparator(string line)
    {
        if (!line.TrimStart().StartsWith('|')) return false;
        var cells = line.Trim().Trim('|').Split('|', StringSplitOptions.TrimEntries);
        return cells.Length > 0 && cells.All(cell => Regex.IsMatch(cell, @"^:?-{3,}:?$"));
    }
    private static string[] TableCells(string line) => line.Trim().Trim('|').Split('|').Select(cell => NormalizeInline(cell.Trim())).ToArray();
    private static string? ListText(string line)
    {
        var match = Regex.Match(line, @"^\s*(?:[-*+]|\d+[.)])\s+(.+?)\s*$");
        return match.Success ? match.Groups[1].Value : null;
    }
    private static string NormalizeInline(string value)
    {
        value = Regex.Replace(value, @"(?is)<sub>(.*?)</sub>", match => "_(" + match.Groups[1].Value + ")");
        value = Regex.Replace(value, @"(?is)<sup>(.*?)</sup>", match => "^(" + match.Groups[1].Value + ")");
        return System.Net.WebUtility.HtmlDecode(value).Trim();
    }

    private static MaterialBounds? MatchBounds(ParsedBlock block, IReadOnlyList<PdfItem> items, PdfPage page, ref int cursor)
    {
        var target = Tokens(block.Text); if (target.Length == 0) return null;
        var anchors = target.Where(token => token.Length > 1).Take(6).ToHashSet(StringComparer.Ordinal);
        if (anchors.Count == 0) anchors.UnionWith(target.Take(3));
        for (var start = cursor; start < items.Count; start++)
        {
            if (items[start].Type == "image") continue;
            var initial = Tokens(items[start].Text);
            if (!initial.Any(anchors.Contains)) continue;
            var selected = new List<PdfItem>(); var matched = 0; var targetIndex = 0; var last = -1;
            var limit = Math.Min(items.Count, start + Math.Max(16, target.Length * 4));
            for (var index = start; index < limit; index++)
            {
                if (items[index].Type == "image") continue;
                var itemMatched = false;
                foreach (var token in Tokens(items[index].Text))
                {
                    var found = FindNext(target, token, targetIndex, 12);
                    if (found < 0) continue;
                    targetIndex = found + 1; matched++; itemMatched = true;
                }
                if (itemMatched) { selected.Add(items[index]); last = index; }
                else if (last >= 0 && index - last > 4) break;
                if (matched >= Math.Ceiling(target.Length * 0.8)) break;
            }
            var required = target.Length <= 2 ? target.Length : Math.Max(2, (int)Math.Ceiling(target.Length * 0.45));
            if (matched < required || selected.Count == 0) continue;
            cursor = Math.Max(cursor, last + 1);
            return UnionBounds(selected, page);
        }
        return null;
    }

    private static int FindNext(string[] target, string token, int start, int lookAhead)
    {
        for (var index = start; index < Math.Min(target.Length, start + lookAhead); index++)
            if (target[index] == token) return index;
        return -1;
    }
    private static string[] Tokens(string text) => Regex.Matches(text.ToLowerInvariant(), @"[\p{L}\p{N}]+")
        .Select(match => match.Value).ToArray();
    private static MaterialBounds? UnionBounds(IEnumerable<PdfItem> items, PdfPage page)
    {
        var bounds = items.Select(item => Bounds(item, page)).Where(bound => bound is not null).Select(bound => bound!).ToArray();
        if (bounds.Length == 0) return null;
        var left = bounds.Min(bound => bound.X); var top = bounds.Min(bound => bound.Y);
        var right = bounds.Max(bound => bound.X + bound.Width); var bottom = bounds.Max(bound => bound.Y + bound.Height);
        return new(left, top, right - left, bottom - top);
    }
    private static MaterialBounds? Bounds(PdfItem item, PdfPage page)
    {
        if (item.Width <= 0 || item.Height <= 0 || !double.IsFinite(item.X) || !double.IsFinite(item.Y) || !double.IsFinite(item.Width) || !double.IsFinite(item.Height)) return null;
        var left = Math.Clamp(item.X / page.Width, 0, 1); var right = Math.Clamp((item.X + item.Width) / page.Width, 0, 1);
        var top = Math.Clamp((page.Height - item.Y - item.Height) / page.Height, 0, 1); var bottom = Math.Clamp((page.Height - item.Y) / page.Height, 0, 1);
        return right > left && bottom > top ? new(left, top, right - left, bottom - top) : null;
    }

    private static List<MaterialBlock> OcrBlocks(string tsv, int page, string assetId, int offset)
    {
        var rows = tsv.Split('\n').Skip(1).Select(line => line.Split('\t', 12)).Where(row => row.Length == 12 && row[0] == "5" && row[11].Trim().Length > 0).ToArray();
        var groups = rows.GroupBy(row => row[2] + ":" + row[3] + ":" + row[4]);
        var result = new List<MaterialBlock>();
        foreach (var group in groups)
        {
            var words = group.Where(row => double.TryParse(row[10], CultureInfo.InvariantCulture, out var confidence) && confidence >= 25).Select(row => row[11].Trim()).ToArray();
            if (words.Length > 0) result.Add(new($"b-{offset + result.Count + 1:00000}", "paragraph", string.Join(" ", words), offset + result.Count, page, null, assetId));
        }
        return result;
    }
    private static async Task<byte[]> ReadImage(string path, CancellationToken ct)
    {
        if (!File.Exists(path) || new FileInfo(path).Length > MaterialFormat.MaximumBytes)
            throw new ApiFailure("material_render_failed", "A source page image could not be rendered within the size limit.", 422);
        return await File.ReadAllBytesAsync(path, ct);
    }
}
