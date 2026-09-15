using StudySpace.Api.Learning;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

public sealed class ReviewedGenerationTests
{
    [Fact]
    public void NestedReviewedUnitsBecomeOneHighLevelChapterPerStructureRoot()
    {
        var rootA = new PipelineUnit("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Block A", null, 0, "script");
        var childA = new PipelineUnit("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "A.1 Grundlagen", rootA.Id, 0, "script");
        var leafA = new PipelineUnit("dddddddddddddddddddddddddddddddd", "A.1.1 Sequenzen", childA.Id, 0, "script");
        var rootB = new PipelineUnit("cccccccccccccccccccccccccccccccc", "Block B", null, 1, "script");
        var units = new[] { rootA, childA, leafA, rootB };
        var source = new SourceRef("material", "revision", "block", 1);

        // Deliberately put B before A and leave the intermediate A.1 unit without direct source content.
        // The saved learning structure, not source/chunk order or source granularity, owns the outline.
        LearningChunk[] chunks =
        [
            new("chunk-b", "Source B", "Block B", [new(source, "B")]) { UnitId = rootB.Id },
            new("chunk-a11", "Source A11", "A.1.1 Sequenzen", [new(source, "A11")]) { UnitId = leafA.Id },
            new("chunk-a", "Source A", "Block A", [new(source, "A")]) { UnitId = rootA.Id }
        ];
        ChunkResult[] results =
        [
            Result("Details B", "Inhalt B", source),
            Result("Details A.1.1", "Inhalt A.1.1", source),
            Result("Details A", "Inhalt A", source)
        ];

        var (sections, _) = ReviewedGeneration.Assemble(chunks, results, units);

        Assert.Equal([rootA.Id, rootB.Id], sections.Select(section => section.UnitId));
        Assert.Equal(["Block A", "Block B"], sections.Select(section => section.Title));
        Assert.Contains("## Details A", sections[0].Markdown);
        Assert.Contains("## A.1 Grundlagen", sections[0].Markdown);
        Assert.Contains("### A.1.1 Sequenzen", sections[0].Markdown);
        Assert.Contains("#### Details A.1.1", sections[0].Markdown);
        Assert.DoesNotContain("A.1 Grundlagen", sections[1].Markdown);
    }

    [Fact]
    public void HiddenAndTaskUnitsDoNotCreateScriptChapters()
    {
        var root = new PipelineUnit("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Skript", null, 0, "script");
        var hidden = new PipelineUnit("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "Versteckt", null, 1, "script", true);
        var tasks = new PipelineUnit("cccccccccccccccccccccccccccccccc", "Aufgaben", null, 0, "tasks", ScriptUnitIds: [root.Id]);
        var source = new SourceRef("material", "revision", "block", 1);
        LearningChunk[] chunks =
        [
            new("chunk-root", "Root", "Skript", [new(source, "Root")]) { UnitId = root.Id },
            new("chunk-task", "Tasks", "Aufgaben", [new(source, "Task")]) { UnitId = tasks.Id, Roles = ["task"] }
        ];
        ChunkResult[] results =
        [
            Result("Thema", "Inhalt", source),
            new("Aufgaben", [], [new LearningExercise("task", "Aufgabe", "Prompt", "", "", "source", [source])])
        ];

        var (sections, exercises) = ReviewedGeneration.Assemble(chunks, results, [root, hidden, tasks]);

        Assert.Single(sections);
        Assert.Equal(root.Id, sections[0].UnitId);
        Assert.Single(exercises);
        Assert.Equal([tasks.Id], exercises[0].UnitIds);
    }

    private static ChunkResult Result(string title, string markdown, SourceRef source) =>
        new(title, [new LearningSection(title, title, markdown, [source])], []);
}
