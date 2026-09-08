using System.IO.Compression;
using System.Text;
namespace StudySpace.Api.Tests;

internal static class MaterialFixtures
{
    public static byte[] Pdf(string line = "Cell membrane controls transport and protects every living cell")
    {
        var content = "BT /F1 22 Tf 50 760 Td (" + line + ") Tj 0 -35 Td (Energy = mass x speed^2) Tj 0 -35 Td (Cell type       Size) Tj 0 -30 Td (Animal          20) Tj 0 -30 Td (Plant           40) Tj ET\n50 400 100 80 re S\n50 400 m 150 480 l S\n";
        return BuildPdf([
            "<< /Type /Catalog /Pages 2 0 R >>"u8.ToArray(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"u8.ToArray(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 850 850] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"u8.ToArray(),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"u8.ToArray(),
            Stream(Encoding.ASCII.GetBytes(content), "")]);
    }
    public static byte[] ScanPdf(byte[] ppm)
    {
        var position = 0;
        string Token()
        {
            while (char.IsWhiteSpace((char)ppm[position])) position++;
            var start = position; while (!char.IsWhiteSpace((char)ppm[position])) position++;
            return Encoding.ASCII.GetString(ppm, start, position - start);
        }
        if (Token() != "P6") throw new InvalidOperationException();
        var width = int.Parse(Token()); var height = int.Parse(Token()); if (Token() != "255") throw new InvalidOperationException(); position++;
        using var compressed = new MemoryStream();
        using (var deflate = new ZLibStream(compressed, CompressionLevel.Fastest, true)) deflate.Write(ppm.AsSpan(position));
        var draw = "q 850 0 0 850 0 0 cm /Im0 Do Q"u8.ToArray();
        return BuildPdf([
            "<< /Type /Catalog /Pages 2 0 R >>"u8.ToArray(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"u8.ToArray(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 850 850] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"u8.ToArray(),
            Stream(compressed.ToArray(), $"/Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode"),
            Stream(draw, "")]);
    }
    public static byte[] Presentation(bool external = false)
    {
        const string a = "http://schemas.openxmlformats.org/drawingml/2006/main";
        const string p = "http://schemas.openxmlformats.org/presentationml/2006/main";
        const string r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
        return Zip(new()
        {
            ["ppt/presentation.xml"] = $"<p:presentation xmlns:p='{p}' xmlns:r='{r}'><p:sldIdLst><p:sldId id='256' r:id='slide'/></p:sldIdLst></p:presentation>",
            ["ppt/_rels/presentation.xml.rels"] = Relationships("<Relationship Id='slide' Target='slides/slide1.xml' Type='" + r + "/slide'/>") ,
            ["ppt/slides/slide1.xml"] = $"<p:sld xmlns:p='{p}' xmlns:a='{a}' xmlns:r='{r}'><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Photosynthesis converts light into chemical energy</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Plant</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Chloroplast</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame><p:pic><p:blipFill><a:blip r:embed='picture'/></p:blipFill></p:pic></p:spTree></p:cSld></p:sld>",
            ["ppt/slides/_rels/slide1.xml.rels"] = Relationships("<Relationship Id='picture' Target='../media/image1.png' Type='" + r + "/image'/>" +
                (external ? "<Relationship Id='external' Target='https://external.example.test/private' TargetMode='External' Type='" + r + "/hyperlink'/>" : ""))
        }, new() { ["ppt/media/image1.png"] = CourseImageTransportTests.Png });
    }
    public static byte[] Document() => Zip(new()
    {
        ["word/document.xml"] = "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:t>Cells contain genetic information.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>DNA</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Nucleus</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"
    });
    public static byte[] Zip(Dictionary<string, string> text, Dictionary<string, byte[]>? binary = null)
    {
        using var result = new MemoryStream();
        using (var archive = new ZipArchive(result, ZipArchiveMode.Create, true))
        {
            foreach (var (path, content) in text) { using var stream = archive.CreateEntry(path).Open(); stream.Write(Encoding.UTF8.GetBytes(content)); }
            foreach (var (path, content) in binary ?? []) { using var stream = archive.CreateEntry(path).Open(); stream.Write(content); }
        }
        return result.ToArray();
    }
    private static string Relationships(string content) => "<Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'>" + content + "</Relationships>";
    private static byte[] Stream(byte[] bytes, string dictionary)
    {
        using var output = new MemoryStream(); output.Write(Encoding.ASCII.GetBytes($"<< {dictionary} /Length {bytes.Length} >>\nstream\n"));
        output.Write(bytes); output.Write("\nendstream"u8); return output.ToArray();
    }
    private static byte[] BuildPdf(byte[][] objects)
    {
        using var output = new MemoryStream(); void Write(string value) => output.Write(Encoding.ASCII.GetBytes(value));
        Write("%PDF-1.4\n"); var offsets = new List<long>();
        for (var index = 0; index < objects.Length; index++) { offsets.Add(output.Position); Write($"{index + 1} 0 obj\n"); output.Write(objects[index]); Write("\nendobj\n"); }
        var xref = output.Position; Write($"xref\n0 {objects.Length + 1}\n0000000000 65535 f \n");
        foreach (var offset in offsets) Write($"{offset:0000000000} 00000 n \n");
        Write($"trailer\n<< /Size {objects.Length + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"); return output.ToArray();
    }
}
