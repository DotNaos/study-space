using System.Text;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Tests;

public sealed class MaterialExtractionTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-material-extraction-" + Guid.NewGuid());
    private readonly MaterialStore store;
    private readonly MaterialToolRunner tools = new();
    private MaterialExtractor Extractor => new(store, tools);
    public MaterialExtractionTests() => store = new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = directory }).Build());

    [Fact] public async Task HtmlKeepsHeadingsTablesSubscriptsAndExplicitUnfetchedContentWarnings()
    {
        const string html = "<html><body><script>secret()</script><h1>Cell biology</h1><p>H<sub>2</sub>O and x<sup>2</sup></p><table><tr><th>Cell</th><th>Size</th></tr><tr><td>Plant</td><td>40</td></tr></table><a href='https://external.example.test/?token=secret'>Reading</a><img src='relative.png' alt='Membrane diagram'></body></html>";
        var result = await Extractor.Extract(new(Encoding.UTF8.GetBytes(html), "text/html", "index.html"), default);
        Assert.Contains(result.Blocks, block => block.Kind == "heading" && block.Text == "Cell biology");
        Assert.Contains(result.Blocks, block => block.Text.Contains("H_{2}O") && block.Text.Contains("x^{2}"));
        Assert.Equal("40", Assert.Single(result.Blocks, block => block.Kind == "table").Cells![1][1]);
        Assert.DoesNotContain("secret", string.Join(" ", result.Blocks.Select(block => block.Text)));
        Assert.NotEmpty(result.Warnings); Assert.False(result.Complete); Assert.Equal("anglesharp-html", Assert.Single(result.Provenance).Engine);
    }
    [Fact] public async Task OfficeAdaptersExtractActualParagraphsTablesSlidesAndImageBytes()
    {
        var slides = await Extractor.Extract(new(MaterialFixtures.Presentation(), "application/octet-stream", "biology.pptx"), default);
        Assert.Contains(slides.Blocks, block => block.Text.Contains("Photosynthesis") && block.Slide == 1);
        Assert.Equal("Chloroplast", Assert.Single(slides.Blocks, block => block.Kind == "table").Cells![0][1]);
        Assert.Equal(CourseImageTransportTests.Png, Assert.Single(slides.Assets).Bytes); Assert.True(slides.Complete);
        var doc = await Extractor.Extract(new(MaterialFixtures.Document(), "application/octet-stream", "biology.docx"), default);
        Assert.Contains(doc.Blocks, block => block.Text.Contains("genetic information"));
        Assert.Equal("Nucleus", Assert.Single(doc.Blocks, block => block.Kind == "table").Cells![0][1]);
        Assert.All(doc.Blocks, block => Assert.Null(block.Page)); // No fabricated pagination from Word paragraphs.
        var linked = await Extractor.Extract(new(MaterialFixtures.Presentation(external: true), "application/octet-stream", "biology.pptx"), default);
        Assert.False(linked.Complete); Assert.Contains(linked.Warnings, warning => warning.Contains("external"));
    }
    [Theory][InlineData("../outside.xml")][InlineData("/absolute.xml")][InlineData("folder\\escape.xml")]
    public async Task OfficeArchiveTraversalAndExternalEntitiesNeverEscapeTheAdapter(string entry)
    {
        var invalid = MaterialFixtures.Zip(new() { [entry] = "private" });
        await Assert.ThrowsAsync<ApiFailure>(() => Extractor.Extract(new(invalid, "application/octet-stream", "unsafe.docx"), default));
        var dtd = MaterialFixtures.Zip(new() { ["word/document.xml"] = "<!DOCTYPE doc [<!ENTITY secret SYSTEM 'file:///etc/passwd'>]><doc>&secret;</doc>" });
        await Assert.ThrowsAsync<ApiFailure>(() => Extractor.Extract(new(dtd, "application/octet-stream", "unsafe.docx"), default));
        Assert.False(File.Exists(Path.Combine(directory, "outside.xml")));
    }
    [Fact] public async Task OversizeArchiveAndUnknownBinaryNeverBecomeSuccessfulText()
    {
        var bomb = MaterialFixtures.Zip([], new() { ["word/document.xml"] = new byte[MaterialFormat.MaximumBytes + 1] });
        await Assert.ThrowsAsync<ApiFailure>(() => Extractor.Extract(new(bomb, "application/octet-stream", "huge.docx"), default));
        Assert.Equal(415, (await Assert.ThrowsAsync<ApiFailure>(() => Extractor.Extract(new([1, 2, 0, 255], "application/octet-stream", "unknown.bin"), default))).Status);
    }
    [MaterialToolsFact] public async Task RealPopplerPreservesTextFormulaTableAndPageCoordinates()
    {
        var result = await Extractor.Extract(new(MaterialFixtures.Pdf(), "application/pdf", "biology.pdf"), default);
        Assert.Contains(result.Blocks, block => block.Text.Contains("Cell membrane") && block.Page == 1 && block.Bounds is not null);
        Assert.Contains(result.Blocks, block => block.Text.Contains("Energy = mass x speed^2"));
        Assert.Contains(result.Blocks, block => block.Text.Contains("Animal"));
        Assert.Contains(result.Blocks, block => block.Text.Contains("20"));
        Assert.Contains(result.Provenance, item => item.Engine == "pdftoppm" && item.ResultHash == MaterialStore.Hash(result.Assets[0].Bytes));
        Assert.Equal("page-image", Assert.Single(result.Assets).Kind);
        Assert.Equal(1, result.Assets[0].Page); Assert.Equal("image/png", MaterialFormat.Detect(result.Assets[0].Bytes, "page.png", null));
        Assert.Contains(result.Provenance, item => item.Engine == "pdftotext" && item.Version.Contains("24.02.0"));
        Assert.DoesNotContain(result.Provenance, item => item.Engine == "tesseract");
    }
    [MaterialToolsFact] public async Task RealOcrReadsImageAndScannedPdfWithRecordedEngine()
    {
        Directory.CreateDirectory(directory); var input = Path.Combine(directory, "scan-source.pdf");
        await File.WriteAllBytesAsync(input, MaterialFixtures.Pdf());
        var prefix = Path.Combine(directory, "scan");
        await tools.Run("pdftoppm", ["-singlefile", "-scale-to", "1800", input, prefix], directory, TimeSpan.FromSeconds(30), default);
        var scan = MaterialFixtures.ScanPdf(await File.ReadAllBytesAsync(prefix + ".ppm"));
        var result = await Extractor.Extract(new(scan, "application/pdf", "scanned.pdf"), default);
        Assert.Contains(result.Blocks, block => block.Text.Contains("Cell membrane", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Provenance, item => item.Engine == "tesseract" && item.Version.Contains("5.3.4") && item.Version.Contains("eng=") && item.Version.Contains("deu="));
        var image = await Extractor.Extract(new(result.Assets[0].Bytes, "image/png", "scan.png"), default);
        Assert.Contains(image.Blocks, block => block.Text.Contains("Cell membrane", StringComparison.OrdinalIgnoreCase));
        Assert.All(image.Blocks, block => Assert.Equal("original", block.AssetId));
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}

public sealed class MaterialToolsFactAttribute : FactAttribute
{
    public MaterialToolsFactAttribute() { if (Environment.GetEnvironmentVariable("STUDY_RUN_MATERIAL_TOOLS") != "1") Skip = "Run in the pinned material-tools container with STUDY_RUN_MATERIAL_TOOLS=1."; }
}
