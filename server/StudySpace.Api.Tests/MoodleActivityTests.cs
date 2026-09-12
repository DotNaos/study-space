using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class MoodleActivityTests : IDisposable
{
    private const string Site = "https://moodle.example.test";
    private readonly string root = Path.Combine(Path.GetTempPath(), "study-activity-" + Guid.NewGuid());
    private readonly Fixture upstream = new();
    private readonly CredentialStore credentials;
    private readonly MoodleService service;
    public MoodleActivityTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string,string?> { ["STUDY_PRIVATE_DIR"] = root }).Build();
        credentials = new(DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(root, "keys"))), config);
        service = new(upstream, credentials, TimeProvider.System);
    }
    private Task Connect() => credentials.Write(new(Site, "Test", 5, "Learner", "synthetic-credential", DateTimeOffset.UtcNow));
    [Fact] public async Task DetailUsesExactModuleAndOnlyQueriesThatAssignmentsOwnStatus()
    {
        await Connect();
        var result = await service.Activity(7,99,default);
        Assert.Equal("assign", result.Type);
        Assert.Equal("First paragraph\n\nSecond paragraph", result.Description);
        Assert.Equal("Use the attached PDF", result.Instructions);
        Assert.Equal(10, result.SectionId);
        Assert.Equal(701, result.Assignment!.AssignmentId);
        Assert.Equal("new", result.Assignment.SubmissionStatus);
        Assert.False(result.Assignment.CanSubmit);
        Assert.Equal(5, result.SubmissionRequirements!.MaximumFiles);
        Assert.Equal(1048576, result.SubmissionRequirements.MaximumFileBytes);
        Assert.True(result.SubmissionRequirements.FilesEnabled);
        Assert.False(result.Partial);
        Assert.Equal(["701"], upstream.StatusRequests);
        Assert.DoesNotContain("synthetic-private", JsonSerializer.Serialize(result));
    }
    [Fact] public async Task AssignmentAttachmentCanBeViewedWithoutLeakingMoodleUrlsOrTokens()
    {
        await Connect();
        var activity = await service.Activity(7,99,default);
        var resource = Assert.Single(activity.Resources);
        Assert.Equal("Guide.pdf", resource.Name);
        Assert.Equal("pdf",resource.PreviewKind);
        Assert.Matches("^[a-f0-9]{64}$", resource.Id!);
        Assert.StartsWith("/api/providers/moodle/courses/7/modules/99/resources/", resource.PreviewUrl);
        var downloads = new Downloads();
        using var files = new MoodleFileService(service,credentials,downloads);
        var file = await files.Get(7,99,resource.Id!,true,default);
        Assert.Equal("Guide.pdf", file.Name);
        Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal("https://moodle.example.test/webservice/pluginfile.php/42/mod_assign/introattachment/0/Guide.pdf", downloads.Source);
        Assert.Equal("synthetic-credential", downloads.Token);
        await Assert.ThrowsAsync<ApiFailure>(() => files.Get(7,98,resource.Id!,true,default));
    }
    [Fact] public async Task PermissionFailureForStatusDoesNotLoseDescriptionOrAttachments()
    {
        await Connect(); upstream.DenyStatus = true;
        var activity = await service.Activity(7,99,default);
        Assert.True(activity.Partial);
        Assert.NotEmpty(activity.Description);
        Assert.Single(activity.Resources);
        Assert.Null(activity.Assignment!.SubmissionStatus);
        Assert.NotEmpty(activity.Warnings);
    }
    [Fact] public async Task AssignmentDetailsDeniedAreExplicitlyPartialAndDoNotInventStatus()
    {
        await Connect(); upstream.DenyAssignments = true;
        var activity = await service.Activity(7,99,default);
        Assert.True(activity.Partial);
        Assert.Null(activity.Assignment);
        Assert.NotEmpty(activity.Warnings);
    }
    [Fact] public async Task EnrollmentAndModuleAreCheckedBeforeReadingAssignmentMetadata()
    {
        await Connect();
        Assert.Equal("course_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => service.Activity(8,99,default))).Code);
        Assert.Equal("activity_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => service.Activity(7,404,default))).Code);
        Assert.DoesNotContain("mod_assign_get_assignments", upstream.Calls);
    }
    [Fact] public async Task DisconnectNeverContactsMoodle()
    {
        Assert.Equal("moodle_disconnected", (await Assert.ThrowsAsync<ApiFailure>(() => service.Activity(7,99,default))).Code);
        Assert.Empty(upstream.Calls);
    }
    [Fact] public async Task ReadOnlyPageContentIsRenderedWithoutRawHtmlOrCredentialAttributes()
    {
        await Connect(); upstream.ModuleType = "page";
        var activity = await service.Activity(7,99,default);
        Assert.Equal("Line one\n\nLine two", activity.Content);
        Assert.DoesNotContain("synthetic-private", JsonSerializer.Serialize(activity));
        Assert.Null(activity.Assignment);
        Assert.DoesNotContain("mod_assign_get_submission_status", upstream.Calls);
    }
    [Fact] public async Task UnsupportedActivitiesStayInAppWithAnExplicitWarning()
    {
        await Connect(); upstream.ModuleType = "quiz";
        var activity = await service.Activity(7,99,default);
        Assert.True(activity.Partial);
        Assert.NotEmpty(activity.Warnings);
        Assert.DoesNotContain("mod_assign_get_assignments", upstream.Calls);
    }
    [Theory]
    [InlineData("<script>synthetic-private</script><p>Hello</p>","Hello")]
    [InlineData("<p><a href='https://example.test?token=synthetic-private'>Hello</a></p>","Hello")]
    [InlineData("<p>One<br>Two</p>","One\nTwo")]
    [InlineData("<img src='https://example.test?token=synthetic-private' alt='Diagram'>","[Bild: Diagram]")]
    public void ContentNeverExecutesHtmlOrLeaksAttributes(string html,string expected) => Assert.Equal(expected,MoodleActivityContent.Text(html));
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root,true); }
    private sealed class Fixture : IMoodleTransport
    {
        public List<string> Calls { get; } = [];
        public List<string> StatusRequests { get; } = [];
        public bool DenyStatus { get; set; }
        public bool DenyAssignments { get; set; }
        public string ModuleType { get; set; } = "assign";
        public Task<JsonElement> Public(Uri site,string method,object args,CancellationToken ct) => throw new NotSupportedException();
        public Task<JsonElement> Authenticated(Uri site,string token,string method,Dictionary<string,string>? args,CancellationToken ct)
        {
            Calls.Add(method);
            if(method=="mod_assign_get_submission_status") {
                StatusRequests.Add(args!["assignid"]);
                if(DenyStatus) throw new ApiFailure("moodle_rejected","Access denied",502);
            }
            if(method=="mod_assign_get_assignments" && DenyAssignments) throw new ApiFailure("moodle_rejected","Access denied",502);
            object result = method switch {
                "core_webservice_get_site_info" => new { userid=5, siteurl=Site, fullname="Learner", sitename="Test" },
                "core_enrol_get_users_courses" => new[] {new { id=7, fullname="Course", shortname="Course" }},
                "core_course_get_contents" => new[] {new {id=10,name="Section",modules=new[]{new {id=99,name="Assignment",modname=ModuleType,description="Visible description",contents=Array.Empty<object>()}}}},
                "mod_assign_get_assignments" => new { courses=new[] {new {id=7,assignments=new[]{new { id=701,cmid=99,course=7,name="Assignment",intro="<p>First paragraph</p><p>Second paragraph</p><script>synthetic-private</script>",activity="Use the attached PDF",duedate=1800000000,allowsubmissionsfromdate=1700000000,nosubmissions=0,introattachments=new[]{new {filename="Guide.pdf",mimetype="application/pdf",filesize=20,timemodified=1,fileurl=Site+"/webservice/pluginfile.php/42/mod_assign/introattachment/0/Guide.pdf?token=synthetic-private"}},configs=new[]{new {plugin="file",subtype="assignsubmission",name="enabled",value="1"},new {plugin="file",subtype="assignsubmission",name="maxfilesubmissions",value="5"},new {plugin="file",subtype="assignsubmission",name="maxsubmissionsizebytes",value="1048576"}}}}}},warnings=Array.Empty<object>() },
                "mod_assign_get_submission_status" => new {lastattempt=new{submission=new{status="new"},gradingstatus="notgraded",cansubmit=false,locked=false,graded=false}},
                "mod_page_get_pages_by_courses" => new {pages=new[]{new{id=100,coursemodule=99,course=7,intro="",content="<p>Line one</p><p>Line two</p><script>synthetic-private</script>"}}},
                _ => throw new NotSupportedException(method)
            };
            return Task.FromResult(JsonSerializer.SerializeToElement(result));
        }
    }
    private sealed class Downloads : IMoodleFileTransport
    {
        public string? Source { get; private set; }
        public string? Token { get; private set; }
        public Task<MoodleFile> Fetch(Uri site,Uri url,string token,string? previewKind,CancellationToken ct,string? expectedMimeType = null)
        { Source=url.AbsoluteUri;Token=token;return Task.FromResult(new MoodleFile("%PDF-synthetic"u8.ToArray(),"application/pdf","Guide.pdf")); }
    }
}
