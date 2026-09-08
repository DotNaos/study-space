using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

internal sealed class MaterialPdfExtractor(MaterialToolRunner tools)
{
    public async Task<MaterialExtraction> Extract(byte[] bytes, string directory, CancellationToken ct)
    {
        var input = Path.Combine(directory, "input.pdf"); await File.WriteAllBytesAsync(input, bytes, ct);
        var info = await tools.Run("pdfinfo", [input], directory, TimeSpan.FromSeconds(20), ct);
        var count = Regex.Match(info.Output, @"(?m)^Pages:\s+(\d+)\s*$");
        if (!count.Success || !int.TryParse(count.Groups[1].Value, out var pages) || pages is < 1 or > 200)
            throw new ApiFailure("material_page_limit", "This PDF has an unsupported page count; the current limit is 200 pages.", 415);
        var text = await tools.Run("pdftotext", ["-bbox-layout", "-enc", "UTF-8", input, "-"], directory, TimeSpan.FromSeconds(40), ct);
        var pageElements = SafeXml(text.Output).Descendants().Where(element => element.Name.LocalName == "page").ToArray();
        if (pageElements.Length != pages) throw new ApiFailure("material_page_count", "The extracted PDF pages did not match the source page count.", 422);
        var blocks = new List<MaterialBlock>(); var assets = new List<MaterialExtractedAsset>();
        var provenance = new List<MaterialProvenance> { info.Provenance, text.Provenance }; var warnings = new List<string>();
        for (var index = 0; index < pages; index++)
        {
            ct.ThrowIfCancellationRequested(); var page = pageElements[index]; var number = index + 1;
            var width = Number(page, "width"); var height = Number(page, "height");
            if (width <= 0 || height <= 0 || width * height > 16_000_000) throw new ApiFailure("material_page_size", "A PDF page exceeds the supported rendering dimensions.", 413);
            var prefix = Path.Combine(directory, "page-" + number);
            var render = await tools.Run("pdftoppm", ["-f", number.ToString(), "-l", number.ToString(), "-singlefile", "-png", "-scale-to", "1800", input, prefix], directory, TimeSpan.FromSeconds(30), ct);
            var imageBytes = await ReadImage(prefix + ".png", ct);
            provenance.Add(render.Provenance with { ResultHash = MaterialStore.Hash(imageBytes) });
            var assetId = $"page-{number:0000}";
            assets.Add(new(assetId, "page-image", "image/png", $"Page {number}.png", imageBytes, number));
            var native = page.Descendants().Where(element => element.Name.LocalName == "block").Select(element =>
            {
                var lines = element.Descendants().Where(child => child.Name.LocalName == "line").Select(line =>
                    string.Join(" ", line.Descendants().Where(word => word.Name.LocalName == "word").Select(word => word.Value)));
                return (Text: string.Join("\n", lines).Trim(), Bounds: Bounds(element, width, height));
            }).Where(block => block.Text.Length > 0).ToArray();
            var nativeText = string.Join("\n", native.Select(block => block.Text));
            if (nativeText.Count(char.IsLetterOrDigit) < 35 || nativeText.Count(character => character == '\uFFFD') > 2)
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
            else foreach (var block in native)
                blocks.Add(new($"b-{blocks.Count + 1:00000}", "paragraph", block.Text, blocks.Count, number, null, assetId, block.Bounds));
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
    private static XDocument SafeXml(string text)
    {
        // Poppler emits an XHTML doctype. Ignore it; never resolve a DTD or external resource.
        using var reader = XmlReader.Create(new StringReader(text), new XmlReaderSettings { DtdProcessing = DtdProcessing.Ignore, XmlResolver = null, MaxCharactersInDocument = 16 * 1024 * 1024 });
        return XDocument.Load(reader);
    }
    private static double Number(XElement element, string name) => double.TryParse((string?)element.Attribute(name), CultureInfo.InvariantCulture, out var number) ? number : 0;
    private static MaterialBounds Bounds(XElement element, double width, double height) => new(
        Number(element, "xMin") / width, Number(element, "yMin") / height,
        (Number(element, "xMax") - Number(element, "xMin")) / width, (Number(element, "yMax") - Number(element, "yMin")) / height);
    private static async Task<byte[]> ReadImage(string path, CancellationToken ct)
    {
        if (!File.Exists(path) || new FileInfo(path).Length > MaterialFormat.MaximumBytes)
            throw new ApiFailure("material_render_failed", "A source page image could not be rendered within the size limit.", 422);
        return await File.ReadAllBytesAsync(path, ct);
    }
}
