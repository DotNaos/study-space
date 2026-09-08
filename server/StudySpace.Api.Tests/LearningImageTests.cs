using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Tests;

public sealed class LearningImageTests
{
    private static readonly LearningInput Input = new(new('a', 64), new('b', 64), "Source", "Chapter");
    private static readonly byte[] Png = CourseImageTransportTests.Png;
    private static MaterialAsset Asset(int page, long? length = null) => new($"page-{page:0000}", "page-image", "image/png", "Page.png", "/unused",
        MaterialStore.Hash(Png), length ?? Png.Length, page);
    private static MaterialBlock Block(int page, string text = "Source text") => new($"b-{page:00000}", "paragraph", text, page, page, null, $"page-{page:0000}");
    private static MaterialDocument Document(MaterialBlock[] blocks, MaterialAsset[] assets) => new(Input.MaterialId, Input.Revision, Input.Name, "application/pdf", blocks, assets, [], [], true);
    private static LearningChunk[] Build(MaterialDocument document) => LearningChunks.Build([(Input, document)]);

    [Fact] public void PageBudgetPreservesAllTextImagesAndExactSourceReferences()
    {
        var document = Document(Enumerable.Range(1, 10).Select(page => Block(page)).ToArray(), Enumerable.Range(1, 10).Select(page => Asset(page)).ToArray());
        var chunks = Build(document);
        Assert.Equal(2, chunks.Length); Assert.Equal(8, chunks[0].Images.Length); Assert.Equal(2, chunks[1].Images.Length);
        Assert.Equal(document.Blocks.Select(block => block.Id), chunks.SelectMany(chunk => chunk.Blocks).Select(block => block.Source.BlockId));
        Assert.Equal(document.Assets.Select(asset => asset.Id), chunks.SelectMany(chunk => chunk.Images).Select(image => image.AssetId));
        Assert.Contains("sequence logos", LearningChunks.Prompt(chunks[0]));
        Assert.Contains("\"image\":1", LearningChunks.Prompt(chunks[0]));
    }
    [Fact] public void ByteBudgetSplitsBeforeAnyImageIsOmitted()
    {
        var document = Document([Block(1), Block(2), Block(3)], [Asset(1, 3 * 1024 * 1024), Asset(2, 3 * 1024 * 1024), Asset(3, 3 * 1024 * 1024)]);
        var chunks = Build(document);
        Assert.Equal(2, chunks.Length); Assert.Equal(2, chunks[0].Images.Length); Assert.Single(chunks[1].Images);
        Assert.All(chunks, chunk => Assert.True(chunk.Images.Sum(image => image.ByteLength) <= LearningImages.MaximumBytes));
        Assert.Equal("learning_images_large", Assert.Throws<ApiFailure>(() => Build(Document([Block(1)], [Asset(1, LearningImages.MaximumBytes + 1)]))).Code);
    }
    [Fact] public void ImageOnlyPagesSurviveAndLongPagesRepeatTheirImageWithoutBreakingUnicode()
    {
        var text = string.Concat(Enumerable.Repeat("Biology 🧬 ", 2400));
        var chunks = Build(Document([Block(1, ""), Block(2, text)], [Asset(1), Asset(2)]));
        Assert.Equal("b-00001", chunks[0].Blocks[0].Source.BlockId); Assert.Equal("", chunks[0].Blocks[0].Text);
        Assert.Equal(text, string.Concat(chunks.SelectMany(chunk => chunk.Blocks).Where(block => block.Source.Page == 2).Select(block => block.Text)));
        Assert.All(chunks.Where(chunk => chunk.Blocks.Any(block => block.Source.Page == 2)), chunk =>
            Assert.Contains(chunk.Images, image => image.Page == 2));
        var exact = Build(Document([Block(1, new string('x', LearningChunks.ChunkCharacters)), Block(2)], [Asset(1), Asset(2)]));
        Assert.Single(exact[1].Images); Assert.Equal(2, exact[1].Images[0].Page);
    }
    [Fact] public void PageImagesAreMappedEvenWhenTextBlocksLackAssetIdsAndCacheIdentityIncludesImageHash()
    {
        var document = Document([Block(1) with { AssetId = null }], [Asset(1)]);
        var chunk = Assert.Single(Build(document)); Assert.Single(chunk.Images);
        var changed = Assert.Single(Build(document with { Assets = [Asset(1) with { Sha256 = new('f', 64) }] }));
        Assert.NotEqual(chunk.Id, changed.Id);
        Assert.NotEqual(Assert.Single(Build(document with { Assets = [] })).Id, chunk.Id);
        Assert.Equal("learning_image_missing", Assert.Throws<ApiFailure>(() => Build(Document([Block(1)], []))).Code);
    }
    [Fact] public async Task LoadingChecksOwnershipHashLengthMimeAndTotalBeforeModelInput()
    {
        var chunk = Assert.Single(Build(Document([Block(1)], [Asset(1)]))); var catalog = new Catalog();
        var image = Assert.Single(await LearningImages.Load(chunk, catalog, default));
        Assert.Equal(Png, Convert.FromBase64String(image.Base64)); Assert.Equal("image/png", image.MimeType);
        Assert.Equal((Input.MaterialId, Input.Revision, "page-0001"), catalog.Request);
        catalog.Content = new(Png, "application/octet-stream", "Page.png");
        Assert.Equal("learning_image_unsupported", (await Assert.ThrowsAsync<ApiFailure>(() => LearningImages.Load(chunk, catalog, default))).Code);
        catalog.Content = new([137, 80, 78, 71], "image/png", "Page.png");
        Assert.Equal("learning_image_damaged", (await Assert.ThrowsAsync<ApiFailure>(() => LearningImages.Load(chunk, catalog, default))).Code);
        var missing = new Catalog { Missing = true };
        Assert.Equal("material_not_found", (await Assert.ThrowsAsync<ApiFailure>(() => LearningImages.Load(chunk, missing, default))).Code);
        using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => LearningImages.Load(chunk, new Catalog(), cancelled.Token));
    }
    private sealed class Catalog : IMaterialCatalog
    {
        public MaterialAssetContent Content { get; set; } = new(Png, "image/png", "Page.png");
        public bool Missing { get; set; }
        public (string, string, string) Request { get; private set; }
        public Task<MaterialAssetContent> GetAsset(string materialId, string revision, string assetId, CancellationToken ct = default)
        { ct.ThrowIfCancellationRequested(); Request = (materialId, revision, assetId); return Missing ? throw MaterialStore.Missing() : Task.FromResult(Content); }
        public Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialDocument> GetDocument(string materialId, string revision, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
