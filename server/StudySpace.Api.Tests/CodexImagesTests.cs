using System.Text.Json;
using StudySpace.Api.Codex;

namespace StudySpace.Api.Tests;

public sealed class CodexImagesTests
{
    private static readonly byte[] PngHeader = [137, 80, 78, 71, 13, 10, 26, 10];
    public static readonly CodexImage Png = new("image/png", "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=");

    [Fact] public void InlineImagesPreserveOrderAndKeepEnvironmentAccessDisabled()
    {
        var images = CodexImages.Validate([Png, Png]);
        var turn = JsonSerializer.SerializeToElement(CodexPolicy.TurnStart("thread", "Read these two pages in order.", null, images));
        Assert.Empty(turn.GetProperty("environments").EnumerateArray());
        Assert.False(turn.GetProperty("sandboxPolicy").GetProperty("networkAccess").GetBoolean());
        Assert.Equal("never", turn.GetProperty("approvalPolicy").GetString());
        var input = turn.GetProperty("input");
        Assert.Equal(3, input.GetArrayLength());
        Assert.Equal("text", input[0].GetProperty("type").GetString());
        foreach (var image in input.EnumerateArray().Skip(1))
        {
            Assert.Equal("image", image.GetProperty("type").GetString());
            Assert.Equal("data:image/png;base64," + Png.Base64, image.GetProperty("url").GetString());
            Assert.Equal("original", image.GetProperty("detail").GetString());
            Assert.False(image.TryGetProperty("path", out _));
        }
    }

    [Theory]
    [InlineData("image/png", "https://example.test/private.png")]
    [InlineData("image/png", "/var/lib/private.png")]
    [InlineData("image/png", "data:image/png;base64,abcd")]
    [InlineData("image/png", "not base64")]
    [InlineData("image/svg+xml", "PHN2Zy8+")]
    [InlineData("image/png", "R0lGODlh")]
    [InlineData("image/jpeg", "iVBORw0KGgo=")]
    public void RemoteLocationsUnsupportedFormatsAndMismatchedBytesAreRejected(string mime, string base64)
        => Assert.Throws<ArgumentException>(() => CodexImages.Validate([new(mime, base64)]));

    [Fact] public void CountAndCombinedDecodedSizeAreBounded()
    {
        Assert.Throws<ArgumentException>(() => CodexImages.Validate(Enumerable.Repeat(Png, 9).ToArray()));
        var bytes = new byte[5 * 1024 * 1024];
        PngHeader.CopyTo(bytes, 0);
        var image = new CodexImage("image/png", Convert.ToBase64String(bytes));
        Assert.Single(CodexImages.Validate([image]));
        Assert.Throws<ArgumentException>(() => CodexImages.Validate([image, image]));
        Assert.Throws<ArgumentException>(() => CodexImages.Validate([new("image/png", new string('A', CodexImages.MaximumEncodedCharacters + 1))]));
    }

    [Fact] public void OnlySupportedImageSignaturesAreAccepted()
    {
        Assert.Single(CodexImages.Validate([new("image/jpeg", Convert.ToBase64String(new byte[] { 255, 216, 255, 224 }))]));
        Assert.Single(CodexImages.Validate([new("image/webp", Convert.ToBase64String("RIFF1234WEBP"u8.ToArray()))]));
        Assert.Throws<ArgumentException>(() => CodexImages.Validate([null!]));
        Assert.Throws<ArgumentException>(() => CodexImages.Validate([new("image/png", null!)]));
    }
}
