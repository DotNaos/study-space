using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class CourseContentsTests : IDisposable
{
    private const string Site = "https://moodle.example.test/learning";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-contents-" + Guid.NewGuid());
    private readonly FixtureTransport transport = new();
    private readonly CredentialStore credentials;
    private readonly MoodleService service;

    public CourseContentsTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_PRIVATE_DIR"] = directory }).Build();
        credentials = new(DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(directory, "keys"))), config);
        service = new(transport, credentials, TimeProvider.System);
    }

    [Fact] public async Task OwnedCourseReturnsSectionsResourcesAndSafeActivityLinks()
    {
        await Connect();
        var section = Assert.Single(await service.Contents(7, default));
        Assert.Equal("Week 1", section.Name);
        Assert.Equal("Introduction", section.Summary);
        var module = Assert.Single(section.Modules);
        Assert.Equal("resource", module.Type);
        Assert.Equal(Site + "/mod/resource/view.php?id=99", module.Url);
        var file = Assert.Single(module.Resources);
        Assert.Equal("Lecture.pdf", file.Name);
        Assert.Equal("application/pdf", file.MimeType);
        Assert.Equal(1234, file.Size);
        Assert.Equal(1788780000, file.ModifiedAt);
        Assert.Null(file.Url); // Mobile API files need a token; the browser opens their parent activity instead.
        Assert.DoesNotContain("secret", JsonSerializer.Serialize(section));
        Assert.Equal(["core_webservice_get_site_info", "core_enrol_get_users_courses", "core_course_get_contents"], transport.Calls);
    }

    [Fact] public async Task OtherCourseNeverRequestsContentsAndDisconnectedNeverContactsMoodle()
    {
        Assert.Equal("moodle_disconnected", (await Assert.ThrowsAsync<ApiFailure>(() => service.Contents(7, default))).Code);
        Assert.Empty(transport.Calls);
        await Connect();
        Assert.Equal("course_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => service.Contents(8, default))).Code);
        Assert.DoesNotContain("core_course_get_contents", transport.Calls);
    }

    [Fact] public async Task EmptyCourseIsSuccessButPermissionAndMalformedResponsesRemainFailures()
    {
        await Connect();
        transport.Content = JsonSerializer.SerializeToElement(Array.Empty<object>());
        Assert.Empty(await service.Contents(7, default));
        transport.Failure = new ApiFailure("moodle_rejected", "Access refused.", 502);
        Assert.Equal("moodle_rejected", (await Assert.ThrowsAsync<ApiFailure>(() => service.Contents(7, default))).Code);
        transport.Failure = null;
        foreach (var malformed in new[] { "{}", "[42]", "[{\"modules\":{}}]", "[{\"modules\":[null]}]", "[{\"modules\":[{\"contents\":[42]}]}]" })
        {
            transport.Content = JsonSerializer.Deserialize<JsonElement>(malformed);
            Assert.Equal("moodle_response", (await Assert.ThrowsAsync<ApiFailure>(() => service.Contents(7, default))).Code);
        }
        Assert.NotNull(await credentials.Read());
    }

    [Theory]
    [InlineData("https://external.example.test/file.pdf")]
    [InlineData("https://user:secret@moodle.example.test/learning/file.pdf")]
    [InlineData("http://moodle.example.test/learning/file.pdf")]
    [InlineData("https://moodle.example.test/other/file.pdf")]
    [InlineData("https://moodle.example.test/learning/../private/file.pdf")]
    [InlineData("javascript:alert(1)")]
    [InlineData(Site + "/webservice/pluginfile.php/99/Lecture.pdf?token=secret")]
    public void UnsafeResourceUrlsAreOmittedButEntriesRemainVisible(string url)
    {
        var result = MoodleCourseContents.Parse(Contents(url), new(Site));
        Assert.Null(Assert.Single(Assert.Single(Assert.Single(result).Modules).Resources).Url);
    }

    [Theory]
    [InlineData("/tokenpluginfile.php/syntheticPathAccessKey99/123/file.pdf")]
    [InlineData("/%74okenpluginfile.php/syntheticPathAccessKey99/123/file.pdf")]
    [InlineData("/tokenpluginfile.php%2fsyntheticPathAccessKey99/123/file.pdf")]
    [InlineData("/webservice%2fpluginfile.php/syntheticPathAccessKey99/123/file.pdf")]
    [InlineData("/pluginfile.php/%2e%2e%2ftokenpluginfile.php/syntheticPathAccessKey99/123/file.pdf")]
    [InlineData("/pluginfile.php/%252e%252e%252ftokenpluginfile.php/syntheticPathAccessKey99/123/file.pdf")]
    [InlineData("/pluginfile.php/%5c..%5ctokenpluginfile.php/syntheticPathAccessKey99/123/file.pdf")]
    public void PathCredentialsAndEncodedEndpointAliasesNeverReachBrowser(string path)
    {
        var result = MoodleCourseContents.Parse(Contents(Site + path), new(Site));
        var module = Assert.Single(Assert.Single(result).Modules);
        Assert.Null(Assert.Single(module.Resources).Url);
        Assert.Equal(Site + "/mod/resource/view.php?id=99", module.Url);
        Assert.DoesNotContain("syntheticPathAccessKey99", JsonSerializer.Serialize(result));
    }

    [Fact] public void EncodedFileNamesRemainUsableAndInlineActivitiesDoNotInventLinks()
    {
        var result = MoodleCourseContents.Parse(Contents(Site + "/pluginfile.php/99/Übung%201.pdf?token=secret#private"), new(Site));
        var url = Assert.Single(Assert.Single(Assert.Single(result).Modules).Resources).Url;
        Assert.Contains("%20", url);
        Assert.DoesNotContain("?", url);
        Assert.DoesNotContain("#", url);
        var label = JsonSerializer.SerializeToElement(new[] { new { id = 1, name = "Section", modules = new[] { new { id = 9, name = "Label", modname = "label" } } } });
        Assert.Null(Assert.Single(Assert.Single(MoodleCourseContents.Parse(label, new(Site))).Modules).Url);
    }

    [Theory]
    [InlineData("<p>Read <a href='https://moodle.example.test/?token=secret'>notes</a>.</p>", "Read notes .")]
    [InlineData("<a title='1 > 0' href='?token=secret'>Lecture &amp; exercises</a>", "Lecture & exercises")]
    [InlineData("<script>secret</script><style>.secret{}</style><!-- secret --><p>Visible</p>", "Visible")]
    public void TextRemovesEmbeddedCredentialsAndMarkup(string html, string expected)
    { Assert.Equal(expected, MoodleText.Plain(html)); }

    private Task Connect() => credentials.Write(new(Site, "Fixture", 42, "Fixture", "syntheticTestToken123456789012", DateTimeOffset.UtcNow));
    private static JsonElement Contents(string fileUrl) => JsonSerializer.SerializeToElement(new[]
    {
        new { id = 11, name = "Week 1", summary = "<p>Introduction</p>", modules = new[]
        {
            new { id = 99, name = "Lecture", modname = "resource", url = Site + "/mod/resource/view.php?id=99&token=secret#secret", description = "Lecture notes",
                contents = new[] { new { type = "file", filename = "Lecture.pdf", mimetype = "application/pdf", filesize = 1234, timemodified = 1788780000, fileurl = fileUrl } } }
        } }
    });
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    private sealed class FixtureTransport : IMoodleTransport
    {
        public List<string> Calls { get; } = [];
        public ApiFailure? Failure { get; set; }
        public JsonElement Content { get; set; } = Contents(Site + "/webservice/pluginfile.php/99/Lecture.pdf?token=secret&forcedownload=1#secret");
        public Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct) => throw new InvalidOperationException();
        public Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct)
        {
            Assert.Equal(Site, site.AbsoluteUri.TrimEnd('/'));
            Calls.Add(method);
            if (method == "core_webservice_get_site_info") return Json(new { siteurl = Site, userid = 42 });
            if (method == "core_enrol_get_users_courses") { Assert.Equal("42", args!["userid"]); return Json(new[] { new { id = 7, fullname = "Algebra" } }); }
            Assert.Equal("core_course_get_contents", method);
            Assert.Equal("7", args!["courseid"]);
            if (Failure is not null) throw Failure;
            return Task.FromResult(Content);
        }
        private static Task<JsonElement> Json(object value) => Task.FromResult(JsonSerializer.SerializeToElement(value));
    }
}
