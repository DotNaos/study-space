using System.Text.Json;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class CourseSubsectionTests
{
    private static CourseModule Parse(object? customdata, string type = "subsection")
    {
        var content = JsonSerializer.SerializeToElement(new[] {
            new { id = 1, name = "Block 1", modules = new[] {
                new { id = 9, name = "Aufgabe 1", modname = type, customdata }
            }}
        });
        return Assert.Single(Assert.Single(MoodleCourseContents.Parse(content, new("https://moodle.example.test"), 7)).Modules);
    }

    [Theory]
    [InlineData("{\"sectionid\":276020}")]
    [InlineData("{\"sectionid\":\"276020\"}")]
    public void PreservesExplicitDelegatedSectionIdWithoutInventingActivityUrl(string data)
    {
        var module = Parse(data);
        Assert.Equal(276020, module.SubsectionId);
        Assert.Null(module.Url);
        Assert.Empty(module.Resources);
    }

    [Fact] public void AcceptsObjectAndNeverExposesOtherCustomData()
    {
        var module = Parse(new { sectionid = 276020, token = "synthetic-secret", unrelated = "private" });
        Assert.Equal(276020, module.SubsectionId);
        var json = JsonSerializer.Serialize(module);
        Assert.DoesNotContain("synthetic-secret", json);
        Assert.DoesNotContain("unrelated", json);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("malformed")]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("{\"sectionid\":0}")]
    [InlineData("{\"sectionid\":-1}")]
    [InlineData("{\"sectionid\":1.5}")]
    [InlineData("{\"sectionid\":\"other-course\"}")]
    [InlineData("{\"sectionid\":999999999999999999999999}")]
    [InlineData("{\"sectionid\":true}")]
    public void InvalidOptionalMetadataDoesNotBreakCourse(string? data)
    {
        Assert.Null(Parse(data).SubsectionId);
    }

    [Fact] public void OnlySubsectionModulesExposeDelegatedIds()
    {
        Assert.Null(Parse("{\"sectionid\":276020}", "resource").SubsectionId);
        Assert.Null(Parse("{\"sectionid\":276020}", "label").SubsectionId);
        Assert.Null(Parse(new { otherid = 276020 }).SubsectionId);
        Assert.Null(Parse(new string('x', 4097)).SubsectionId);
    }
}
