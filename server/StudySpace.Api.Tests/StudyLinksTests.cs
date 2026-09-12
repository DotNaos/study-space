using Microsoft.Extensions.Configuration;
using System.Text.Json;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;

namespace StudySpace.Api.Tests;

public sealed class StudyLinksTests
{
    private static IConfiguration Config(string url) => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_PUBLIC_URL"] = url }).Build();

    [Theory]
    [InlineData("https://study.example.test", "https://study.example.test")]
    [InlineData("https://study.example.test/", "https://study.example.test")]
    [InlineData("http://localhost:18155", "http://localhost:18155")]
    public void UsesConfiguredOriginAndCourseModuleIdentity(string configured, string origin)
    {
        var config = Config(configured);
        Assert.Equal($"{origin}/courses/23691", StudyLinks.CourseUrl(config, 23691));
        Assert.Equal($"{origin}/courses/23691/activities/1015573", StudyLinks.ActivityUrl(config, 23691, 1015573));
        var id = new string('a', 64);
        Assert.Equal($"{origin}/courses/23691/activities/1015583?resource={id}", StudyLinks.ActivityUrl(config, 23691, 1015583, id));
    }

    [Theory]
    [InlineData("https://user:secret@study.test")]
    [InlineData("https://study.test/?token=secret")]
    [InlineData("https://study.test/#secret")]
    [InlineData("https://study.test/subpath")]
    [InlineData("javascript:alert(1)")]
    [InlineData("not-a-url")]
    public void NeverLeaksInvalidPublicUrlOrCredentials(string configured) =>
        Assert.Null(StudyLinks.ActivityUrl(Config(configured), 7, 12));

    [Theory]
    [InlineData(0, 12)]
    [InlineData(7, -1)]
    [InlineData(9_007_199_254_740_992, 1)]
    [InlineData(1, 9_007_199_254_740_992)]
    public void RejectsInvalidOrUnsafeJavascriptIds(long courseId, long moduleId) =>
        Assert.Null(StudyLinks.ActivityUrl(Config("https://study.test"), courseId, moduleId));

    [Theory]
    [InlineData("")]
    [InlineData("../../file")]
    [InlineData("https://upstream.test/?token=secret")]
    public void RejectsInvalidResourceIds(string resourceId) =>
        Assert.Null(StudyLinks.ActivityUrl(Config("https://study.test"), 7, 12, resourceId));

    [Fact]
    public void EnrichesCourseAndResourceMetadataWithoutChangingUpstreamIdentity()
    {
        var config = Config("https://study.test");
        var id = new string('a', 64);
        CourseSection[] original = [new(11, "Block 1", "", [new(12, "Sheet", "resource", "https://provider.test/view.php?id=12", "", [new("file", "sheet.pdf", "application/pdf", 42, null, null, id)])])];
        var result = StudyLinks.Contents(config, 7, original);
        Assert.Null(original[0].Modules[0].StudyUrl);
        Assert.Equal(original[0].Modules[0].Url, result[0].Modules[0].Url);
        Assert.Equal("https://study.test/courses/7/activities/12", result[0].Modules[0].StudyUrl);
        Assert.Equal($"https://study.test/courses/7/activities/12?resource={id}", result[0].Modules[0].Resources[0].StudyUrl);
        var json = JsonSerializer.SerializeToElement(result, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(result[0].Modules[0].StudyUrl, json[0].GetProperty("modules")[0].GetProperty("study_url").GetString());
        Assert.Equal(result[0].Modules[0].Resources[0].StudyUrl, json[0].GetProperty("modules")[0].GetProperty("resources")[0].GetProperty("study_url").GetString());
    }
}
