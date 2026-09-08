using System.Text.Json;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
namespace StudySpace.Api.Tests;

public sealed class LearningCitationTests
{
    private static readonly LearningChunk Chunk = new("chunk", "Source", "Chapter",
        Enumerable.Range(1, 73).Select(index => new ChunkBlock(
            new(new string('a', 64), new string('b', 64), $"block-{index}", index), $"Source text {index}.")).ToArray(),
        [new(new string('a', 64), new string('b', 64), "page-three", 3, new string('c', 64), 100)]);

    [Fact] public void CompactPromptPreservesEveryBlockAndMapsImagesWithoutRepeatingHashes()
    {
        var prompt = LearningChunks.Prompt(Chunk);
        Assert.DoesNotContain(Chunk.Blocks[0].Source.MaterialId, prompt);
        Assert.DoesNotContain(Chunk.Blocks[0].Source.Revision, prompt);
        using var payload = JsonDocument.Parse(prompt[prompt.IndexOf("{\"name\"", StringComparison.Ordinal)..]);
        var blocks = payload.RootElement.GetProperty("blocks").EnumerateArray().ToArray();
        Assert.Equal(Chunk.Blocks.Select(block => block.Text), blocks.Select(block => block.GetProperty("text").GetString()));
        Assert.Equal(Enumerable.Range(1, 73), blocks.Select(block => block.GetProperty("citation").GetInt32()));
        Assert.Equal(Enumerable.Range(1, 73), blocks.Select(block => block.GetProperty("page").GetInt32()));
        Assert.Equal(3, payload.RootElement.GetProperty("images")[0].GetProperty("citations")[0].GetInt32());
        var verbose = JsonSerializer.Serialize(Chunk.Blocks, LearningStore.Json);
        Assert.True(prompt.Length < verbose.Length / 2);
    }

    [Fact] public void ModelLabelsResolveToExactPinnedSourcePositionsAndDeduplicate()
    {
        var result = LearningChunks.Validate(Result("[3,1,3]"), Chunk);
        Assert.Equal(new[] { Chunk.Blocks[2].Source, Chunk.Blocks[0].Source }, result.Sections[0].Sources);
        Assert.Equal(Chunk.Blocks[2].Source, result.Exercises[0].Sources[0]);
        Assert.Equal("source", result.Exercises[0].Origin);
    }

    [Theory]
    [InlineData("[0]")]
    [InlineData("[-1]")]
    [InlineData("[74]")]
    [InlineData("[1.5]")]
    [InlineData("[2147483648]")]
    [InlineData("[\"1\"]")]
    [InlineData("[null]")]
    [InlineData("[{}]")]
    [InlineData("[]")]
    public void InvalidLabelsCannotBecomeSourceCitations(string labels)
    {
        Assert.Equal("learning_result_invalid", Assert.Throws<ApiFailure>(() => LearningChunks.Validate(Result(labels), Chunk)).Code);
    }

    private static string Result(string labels) => JsonSerializer.Serialize(new
    {
        title = "Chapter", sections = new[] { new { title = "Section", markdown = "Source text 3.", sources = JsonDocument.Parse(labels).RootElement } },
        exercises = new[] { new { title = "Question", prompt = "Source text 3.", hint = "", solution = "", origin = "source", sources = new[] { 3 } } }
    }, LearningStore.Json);
}
