using System.Diagnostics;
using System.IO.Compression;
using System.Xml;
using System.Xml.Linq;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

internal static class MaterialOfficeExtractor
{
    private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static readonly XNamespace P = "http://schemas.openxmlformats.org/presentationml/2006/main";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    public static MaterialExtraction Presentation(byte[] bytes)
    {
        var started = Stopwatch.GetTimestamp(); using var package = new SafePackage(bytes);
        var presentation = package.Xml("ppt/presentation.xml"); var relationships = package.Relationships("ppt/presentation.xml");
        var blocks = new List<MaterialBlock>(); var assets = new List<MaterialExtractedAsset>(); var warnings = new List<string>();
        var slide = 0;
        foreach (var id in presentation.Descendants(P + "sldId"))
        {
            slide++;
            if (slide > 200) throw TooLarge();
            var relationId = (string?)id.Attribute(R + "id");
            if (relationId is null || !relationships.TryGetValue(relationId, out var relation) || relation.External) throw Invalid();
            var path = package.Resolve("ppt/presentation.xml", relation.Target);
            var document = package.Xml(path); var rels = package.Relationships(path);
            foreach (var shape in document.Descendants(P + "spTree").Elements())
            {
                if (shape.Name == P + "sp")
                {
                    foreach (var paragraph in shape.Descendants(A + "p"))
                        Add(blocks, "paragraph", string.Concat(paragraph.Descendants(A + "t").Select(text => text.Value)), slide: slide);
                }
                else if (shape.Name == P + "graphicFrame")
                {
                    foreach (var table in shape.Descendants(A + "tbl"))
                    {
                        var cells = table.Elements(A + "tr").Select(row => row.Elements(A + "tc").Select(cell =>
                            string.Join(" ", cell.Descendants(A + "t").Select(text => text.Value))).ToArray()).ToArray();
                        Add(blocks, "table", string.Join("\n", cells.Select(row => string.Join("\t", row))), slide: slide, cells: cells);
                    }
                    if (shape.Descendants(A + "graphicData").Any(data => !data.Descendants(A + "tbl").Any()))
                        warnings.Add($"Slide {slide} contains a chart, diagram or object whose full visual structure remains in the original presentation.");
                }
                else if (shape.Name == P + "grpSp")
                {
                    var text = string.Join("\n", shape.Descendants(A + "p").Select(paragraph => string.Concat(paragraph.Descendants(A + "t").Select(item => item.Value))));
                    Add(blocks, "paragraph", text, slide: slide);
                    warnings.Add($"Slide {slide} contains grouped shapes; their exact layout remains in the original presentation.");
                }
                foreach (var image in shape.Descendants(A + "blip"))
                    AddImage(package, path, rels, (string?)image.Attribute(R + "embed"), assets, blocks, slide, warnings);
            }
            foreach (var notes in rels.Values.Where(relation => relation.Type.EndsWith("/notesSlide", StringComparison.Ordinal) && !relation.External))
            {
                var notesDocument = package.Xml(package.Resolve(path, notes.Target));
                foreach (var shape in notesDocument.Descendants(P + "sp").Where(shape => !shape.Descendants(P + "ph").Any(ph => (string?)ph.Attribute("type") is "sldNum" or "sldImg")))
                    Add(blocks, "notes", string.Join("\n", shape.Descendants(A + "p").Select(paragraph => string.Concat(paragraph.Descendants(A + "t").Select(text => text.Value)))), slide: slide);
            }
            if (rels.Values.Any(relation => relation.External)) warnings.Add($"Slide {slide} references external content that was not fetched.");
        }
        if (slide == 0) throw Invalid();
        return Result(blocks, assets, warnings, "openxml-presentation", bytes, started);
    }

    public static MaterialExtraction Document(byte[] bytes)
    {
        var started = Stopwatch.GetTimestamp(); using var package = new SafePackage(bytes);
        var document = package.Xml("word/document.xml"); var rels = package.Relationships("word/document.xml");
        var blocks = new List<MaterialBlock>(); var assets = new List<MaterialExtractedAsset>(); var warnings = new List<string>();
        var body = document.Root?.Element(W + "body") ?? throw Invalid();
        foreach (var element in body.Elements())
        {
            if (element.Name == W + "p") Add(blocks, "paragraph", OfficeText(element));
            else if (element.Name == W + "tbl")
            {
                var cells = element.Elements(W + "tr").Select(row => row.Elements(W + "tc").Select(OfficeText).ToArray()).ToArray();
                Add(blocks, "table", string.Join("\n", cells.Select(row => string.Join("\t", row))), cells: cells);
            }
            foreach (var image in element.Descendants(A + "blip"))
                AddImage(package, "word/document.xml", rels, (string?)image.Attribute(R + "embed"), assets, blocks, null, warnings);
            if (element.Descendants().Any(child => child.Name.LocalName is "object" or "altChunk" or "chart"))
                warnings.Add("An embedded object remains available only in the original document.");
        }
        if (rels.Values.Any(relation => relation.External)) warnings.Add("External document references were inventoried but not fetched.");
        return Result(blocks, assets, warnings, "openxml-document", bytes, started);
    }
    private static string OfficeText(XElement element) => string.Join(" ", element.Descendants().Where(child => child.Name.LocalName == "t").Select(child => child.Value));
    private static void Add(List<MaterialBlock> blocks, string kind, string text, int? slide = null, string? assetId = null, string[][]? cells = null)
    {
        if (string.IsNullOrWhiteSpace(text) && assetId is null) return;
        blocks.Add(new($"b-{blocks.Count + 1:00000}", kind, text.Trim(), blocks.Count, null, slide, assetId, null, cells));
    }
    private static void AddImage(SafePackage package, string owner, Dictionary<string, Relationship> relationships, string? id,
        List<MaterialExtractedAsset> assets, List<MaterialBlock> blocks, int? slide, List<string> warnings)
    {
        if (id is null || !relationships.TryGetValue(id, out var relation) || relation.External)
        { warnings.Add("An external or unavailable image could not be extracted."); return; }
        var path = package.Resolve(owner, relation.Target); var bytes = package.Bytes(path);
        var mime = MaterialFormat.Detect(bytes, path, null);
        if (!mime.StartsWith("image/", StringComparison.Ordinal))
        { warnings.Add("A vector or unsupported image remains in the original Office file."); return; }
        var assetId = $"image-{assets.Count + 1:0000}";
        assets.Add(new(assetId, "image", mime, Path.GetFileName(path), bytes, Slide: slide));
        Add(blocks, "image", "", slide, assetId);
    }
    private static MaterialExtraction Result(List<MaterialBlock> blocks, List<MaterialExtractedAsset> assets, List<string> warnings, string engine, byte[] bytes, long started) =>
        new(blocks.ToArray(), assets.ToArray(), [new(engine, "1", (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds, MaterialStore.Hash(bytes))],
            warnings.Distinct().ToArray(), warnings.Count == 0);
    private static ApiFailure Invalid() => new("material_office_invalid", "This Office document has invalid or unsupported package structure.", 422);
    private static ApiFailure TooLarge() => new("material_office_large", "This Office document exceeds the supported entry, page or uncompressed size limits.", 413);

    private sealed record Relationship(string Target, string Type, bool External);
    private sealed class SafePackage : IDisposable
    {
        private readonly ZipArchive archive;
        private readonly Dictionary<string, ZipArchiveEntry> entries;
        public SafePackage(byte[] bytes)
        {
            try
            {
                archive = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
                if (archive.Entries.Count > 2000 || archive.Entries.Sum(entry => entry.Length) > 128 * 1024 * 1024) throw TooLarge();
                entries = new(StringComparer.Ordinal);
                foreach (var entry in archive.Entries)
                {
                    if (entry.FullName.EndsWith('/')) continue;
                    if (!SafePath(entry.FullName) || entry.Length > MaterialFormat.MaximumBytes || !entries.TryAdd(entry.FullName, entry)) throw Invalid();
                }
            }
            catch (InvalidDataException) { throw Invalid(); }
        }
        public byte[] Bytes(string path)
        {
            if (!entries.TryGetValue(path, out var entry)) throw Invalid();
            using var input = entry.Open(); using var output = new MemoryStream(); var buffer = new byte[81920]; int count;
            while ((count = input.Read(buffer)) > 0)
            { if (output.Length + count > MaterialFormat.MaximumBytes) throw TooLarge(); output.Write(buffer, 0, count); }
            return output.ToArray();
        }
        public XDocument Xml(string path)
        {
            using var input = new MemoryStream(Bytes(path));
            using var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 16 * 1024 * 1024 });
            try { return XDocument.Load(reader); } catch (XmlException) { throw Invalid(); }
        }
        public Dictionary<string, Relationship> Relationships(string owner)
        {
            var folder = Path.GetDirectoryName(owner)?.Replace('\\', '/') ?? "";
            var path = (folder.Length == 0 ? "" : folder + "/") + "_rels/" + Path.GetFileName(owner) + ".rels";
            if (!entries.ContainsKey(path)) return [];
            var result = new Dictionary<string, Relationship>(StringComparer.Ordinal);
            foreach (var relationship in Xml(path).Descendants().Where(element => element.Name.LocalName == "Relationship"))
            {
                var id = (string?)relationship.Attribute("Id"); var target = (string?)relationship.Attribute("Target"); var type = (string?)relationship.Attribute("Type");
                if (id is null || target is null || type is null || !result.TryAdd(id, new(target, type, (string?)relationship.Attribute("TargetMode") == "External"))) throw Invalid();
            }
            return result;
        }
        public string Resolve(string owner, string target)
        {
            if (target.Contains('\\') || target.Contains('%') || target.Contains(':') || target.StartsWith('/')) throw Invalid();
            var segments = (Path.GetDirectoryName(owner)?.Replace('\\', '/') ?? "").Split('/', StringSplitOptions.RemoveEmptyEntries).ToList();
            foreach (var segment in target.Split('/'))
            {
                if (segment == ".") continue;
                if (segment == "..") { if (segments.Count == 0) throw Invalid(); segments.RemoveAt(segments.Count - 1); }
                else segments.Add(segment);
            }
            var path = string.Join('/', segments);
            return SafePath(path) && entries.ContainsKey(path) ? path : throw Invalid();
        }
        private static bool SafePath(string path) => path.Length < 1024 && !path.StartsWith('/') && !path.Contains('\\') && !path.Contains(':') &&
            !path.Any(char.IsControl) && path.Split('/').All(segment => segment.Length > 0 && segment is not ("." or ".."));
        public void Dispose() => archive.Dispose();
    }
}
