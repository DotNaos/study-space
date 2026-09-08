using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Tests;

public sealed class LearningPresentationTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-presentation-" + Guid.NewGuid());
    private static readonly string MaterialId = new('a', 64), Revision = new('b', 64), VersionId = new('c', 32);
    private static readonly ChunkBlock[] Blocks =
    [
        new(new(MaterialId, Revision, "b-1", 1), "1) Read the strand in 5’ \uF0E0 3’ direction."),
        new(new(MaterialId, Revision, "b-2", 1), "5’ ACT 3’"),
        new(new(MaterialId, Revision, "b-3", 1), "2) Identify the base."),
        new(new(MaterialId, Revision, "b-4", 1), "A"),
        new(new(MaterialId, Revision, "b-5", 2), "Unrelated source paragraph.")
    ];
    private static readonly string Prompt = string.Join("\n\n", Blocks.Take(4).Select(block => block.Text)).Replace('\uF0E0', '\u001F');
    private static LearningExercise Original => new("exercise-original", "Source question", Prompt, "Hint", "Unchanged scientific answer", "generated", Blocks.Take(4).Select(block => block.Source).ToArray());
    private static LearningVersion Saved => new(VersionId, DateTimeOffset.UnixEpoch, new('d', 64), "Learning", false, [],
        [new("section", "Directions", "Read 5’ \u001F 3’.", [Blocks[0].Source])],
        [Original, Original with { Id = "extra", Prompt = "Explain a new example.", Origin = "source" }], [new(MaterialId, Revision, "Source")]);

    [Theory]
    [InlineData("5’ \u001F 3’", "5’ → 3’")]
    [InlineData("3′\uF0E05′", "3′→5′")]
    [InlineData("5' \uF0E0 3'", "5' → 3'")]
    [InlineData("A\u001FB", "A\u001FB")]
    [InlineData("5’\u001F5’", "5’\u001F5’")]
    [InlineData("5’←3’", "5’←3’")]
    public void OnlyKnownStrandDirectionGlyphsAreRepaired(string before, string after) => Assert.Equal(after, LearningPresentation.RepairDirections(before));

    [Fact] public void ContiguousMultiBlockSourceTextRequiresAnOverlappingCitationAndPreservesIds()
    {
        var original = LearningPresentation.Exercise(Original, Blocks);
        Assert.Equal("source", original.Origin); Assert.Equal(Original.Id, original.Id); Assert.Equal(Original.Solution, original.Solution);
        Assert.DoesNotContain('\u001F', original.Prompt); Assert.Contains("5’ → 3’", original.Prompt);
        Assert.Equal("generated", LearningPresentation.Exercise(Original with { Sources = [Blocks[4].Source] }, Blocks).Origin);
        Assert.Equal("generated", LearningPresentation.Exercise(Original with { Prompt = Blocks[0].Text + " " + Blocks[2].Text }, Blocks).Origin);
        Assert.Equal("generated", LearningPresentation.Exercise(Original with { Prompt = Blocks[2].Text + " " + Blocks[0].Text }, Blocks).Origin);
        Assert.Equal("generated", LearningPresentation.Exercise(Original with { Prompt = "Invented question", Origin = "source" }, Blocks).Origin);
        var foreign = Blocks.Select(block => block with { Source = block.Source with { Revision = new('f', 64) } }).ToArray();
        Assert.Equal("generated", LearningPresentation.Exercise(Original, foreign).Origin);
    }

    [Fact] public void FutureValidationRepairsKnownArrowsAndRejectsOtherControls()
    {
        var chunk = new LearningChunk("chunk", "Source", "Section", Blocks);
        string Result(string prompt) => JsonSerializer.Serialize(new { title = "Learning", sections = new[] { new { title = "Section", markdown = "Text", sources = new[] { 1 } } },
            exercises = new[] { new { title = "Question", prompt, hint = "Hint", solution = "Answer", origin = "generated", sources = new[] { 1, 2, 3, 4 } } } });
        var result = LearningChunks.Validate(Result(Prompt), chunk);
        Assert.Equal("source", result.Exercises[0].Origin); Assert.False(LearningPresentation.HasInvalidControls(result.Exercises[0].Prompt));
        Assert.Equal("learning_result_invalid", Assert.Throws<ApiFailure>(() => LearningChunks.Validate(Result("Unknown \u001f symbol"), chunk)).Code);
        Assert.Equal("learning_result_invalid", Assert.Throws<ApiFailure>(() => LearningChunks.Validate(Result("Unknown \u0007 symbol"), chunk)).Code);
        Assert.False(LearningPresentation.HasInvalidControls("normal\ttext\r\n"));
    }

    [Fact] public async Task ReadProjectionAndChatUsePinnedSourcesWithoutChangingSavedVersionsOrUserDrafts()
    {
        var store = new LearningStore(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = directory }).Build());
        var catalog = new Catalog(); var service = new LearningService(store, catalog);
        await store.WriteVersion(7, Saved, default);
        await store.WithCourse(7, async state =>
        {
            state.ActiveVersionId = VersionId;
            state.Versions.Add(new(VersionId, Saved.CreatedAt, Saved.SnapshotId, Saved.Title, false, 1, 2));
            state.Drafts[Original.Id] = "My literal 5’ \u001F 3’ answer";
            await store.Save(state); return true;
        });
        var path = Path.Combine(directory, "learning", "7", "versions", VersionId + ".json"); var before = await File.ReadAllBytesAsync(path);
        var view = await service.Get(7);
        Assert.Equal("source", view.ActiveVersion!.Exercises[0].Origin); Assert.Equal("generated", view.ActiveVersion.Exercises[1].Origin);
        Assert.Equal(Original.Id, view.ActiveVersion.Exercises[0].Id); Assert.Contains('\u001F', view.Drafts[Original.Id]);
        Assert.Equal(JsonSerializer.Serialize(view.ActiveVersion.Exercises[0]), JsonSerializer.Serialize((await service.Version(7, VersionId, default)).Exercises[0]));
        var model = new Model(); var chat = new LearningChat(store, model, catalog); var context = new DefaultHttpContext(); context.Response.Body = new MemoryStream();
        await chat.Stream(7, new(VersionId, "Explain the source question.", true), context);
        Assert.DoesNotContain('\\' + "u001F", model.Prompt); Assert.DoesNotContain('\u001F', model.Prompt); Assert.Contains("\\u2192", model.Prompt);
        Assert.Equal(before, await File.ReadAllBytesAsync(path)); Assert.Equal(Prompt, (await store.Version(7, VersionId)).Exercises[0].Prompt);
        catalog.Missing = true;
        var offline = await service.Get(7); Assert.Equal("generated", offline.ActiveVersion!.Exercises[0].Origin); Assert.Equal(Original.Id, offline.ActiveVersion.Exercises[0].Id);
    }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class Catalog : IMaterialCatalog
    {
        public bool Missing { get; set; }
        public Task<MaterialDocument> GetDocument(string id, string revision, CancellationToken ct = default)
        {
            Assert.Equal(MaterialId, id); Assert.Equal(Revision, revision); ct.ThrowIfCancellationRequested();
            if (Missing) throw MaterialStore.Missing();
            return Task.FromResult(new MaterialDocument(id, revision, "Source", "application/pdf", Blocks.Select((block, index) =>
                new MaterialBlock(block.Source.BlockId, "paragraph", block.Text, index, block.Source.Page, null, null)).ToArray(), [], [], [], true));
        }
        public Task<MaterialAssetContent> GetAsset(string id, string revision, string asset, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> GetSnapshot(long id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> StartImport(long id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<MaterialSnapshot> Cancel(long id, string job, CancellationToken ct = default) => throw new NotSupportedException();
    }
    private sealed class Model : ILearningModel
    {
        public string Prompt { get; private set; } = "";
        public Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct, IReadOnlyList<LearningImage>? images = null) => throw new NotSupportedException();
        public async IAsyncEnumerable<LearningModelDelta> Chat(string prompt, [EnumeratorCancellation] CancellationToken ct)
        { Prompt = prompt; await Task.Yield(); yield return new("Answer", true); }
    }
}
