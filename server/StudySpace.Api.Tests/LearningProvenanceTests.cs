using System.Text.Json;
using StudySpace.Api.Learning;
namespace StudySpace.Api.Tests;

public sealed class LearningProvenanceTests
{
    private static readonly SourceRef Source = new(new string('a', 64), new string('b', 64), "block1", 3);
    private static readonly LearningChunk Chunk = new("chunk", "source.pdf", "Chapter", [new ChunkBlock(Source, "Source text")]);
    private static JsonElement Payload(string quote = "Source text", string origin = "source", int[]? sources = null) =>
        JsonSerializer.SerializeToElement(new { mappings = new[] { new { quote, origin, sources = sources ?? [1] } } });

    [Fact] public void LegacySectionKeepsCoarseReferences()
    {
        Assert.Null(LearningProvenance.Read(JsonSerializer.SerializeToElement(new { }), "Source text", Chunk));
        var legacy = new LearningSection("s", "title", "Source text", [Source]);
        Assert.Null(LearningProvenance.Project(legacy).Provenance);
    }
    [Fact] public void TextSpanRetainsPinnedReferencesAndUTF16Offsets()
    {
        var text = "🧬 Source text. An additional clause.";
        var map = LearningProvenance.Read(Payload(), text, Chunk)!;
        var span = Assert.Single(map.Spans);
        Assert.Equal(3, span.Start); Assert.Equal(14, span.End);
        Assert.Equal(Source, Assert.Single(span.Sources));
        Assert.Equal("unreviewed", map.Status);
        Assert.Equal(LearningChunks.Hash(text), map.MarkdownHash);
    }
    [Fact] public void InvalidOriginsReferencesAndQuotesAreRejected()
    {
        Assert.Throws<JsonException>(() => LearningProvenance.Read(Payload(origin: "user"), "Source text", Chunk));
        Assert.Throws<JsonException>(() => LearningProvenance.Read(Payload(sources: [2]), "Source text", Chunk));
        Assert.Throws<JsonException>(() => LearningProvenance.Read(Payload(sources: []), "Source text", Chunk));
        Assert.Throws<JsonException>(() => LearningProvenance.Read(Payload(), "Other text", Chunk));
        Assert.Throws<JsonException>(() => LearningProvenance.Read(Payload(), "Source text Source text", Chunk));
    }
    [Fact] public void AdditionsAndMapsSurviveSerializationAndEditsInvalidateTheMap()
    {
        var map = LearningProvenance.Read(Payload(origin: "agent", sources: []), "Source text", Chunk)!;
        Assert.Empty(map.Spans[0].Sources);
        var section = new LearningSection("s", "title", "Source text", [], map);
        var restored = JsonSerializer.Deserialize<LearningSection>(JsonSerializer.Serialize(section, LearningStore.Json), LearningStore.Json)!;
        Assert.Equal(map.MarkdownHash, restored.Provenance!.MarkdownHash);
        Assert.Equal("unreviewed", LearningProvenance.Project(restored).Provenance!.Status);
        Assert.Equal("stale", LearningProvenance.Project(restored with { Markdown = "Rewritten text" }).Provenance!.Status);
        Assert.Equal("unreviewed", section.Provenance!.Status);
    }
}
