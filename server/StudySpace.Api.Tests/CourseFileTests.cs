using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class CourseFileTests : IDisposable
{
    private const string Site = CourseFileTransportTests.Site;
    private const string Token = "syntheticSavedToken12345";
    private readonly string directory = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "study-space-files-" + Guid.NewGuid());
    private readonly Metadata metadata = new();
    private readonly Downloads downloads = new();
    private readonly CredentialStore credentials;
    private readonly MoodleService moodle;
    private readonly MoodleFileService files;
    public CourseFileTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_DATA_DIR"] = System.IO.Path.Combine(directory, "data"), ["STUDY_PRIVATE_DIR"] = directory }).Build();
        credentials = new(DataProtectionProvider.Create(new DirectoryInfo(System.IO.Path.Combine(directory, "keys"))), config);
        moodle = new(metadata, credentials, TimeProvider.System); files = new(moodle, credentials, downloads);
    }
    [Fact] public async Task ResourceContractContainsOnlyOpaqueApplicationLinksAndDownloadResolvesTheSameFile()
    {
        await Connect(); var resource = await Resource();
        Assert.Matches("^[a-f0-9]{64}$", resource.Id!); Assert.Equal("pdf", resource.PreviewKind);
        Assert.Equal($"/api/providers/moodle/courses/7/modules/99/resources/{resource.Id}/preview", resource.PreviewUrl);
        Assert.Equal($"/api/providers/moodle/courses/7/modules/99/resources/{resource.Id}/download", resource.DownloadUrl);
        Assert.Null(resource.Url);
        var json = JsonSerializer.Serialize(resource);
        Assert.DoesNotContain("synthetic", json); Assert.DoesNotContain("pluginfile", json);
        Assert.Equal(CourseFileTransportTests.Pdf, (await files.Get(7, 99, resource.Id!, true, default)).Bytes);
        Assert.Equal(Site + "/webservice/pluginfile.php" + CourseFileTransportTests.Path, downloads.LastSource);
    }
    [Fact] public async Task ForeignCourseModuleAndResourceCannotFetchAnyBytes()
    {
        await Connect(); var resource = await Resource();
        foreach (var (course, module, id) in new[] { (8L, 99L, resource.Id!), (7L, 98L, resource.Id!), (7L, 99L, new string('a', 64)), (7L, 99L, "https://evil.test/file.pdf") })
            await Assert.ThrowsAsync<ApiFailure>(() => files.Get(course, module, id, true, default));
        Assert.Equal(0, downloads.Requests);
        await moodle.Disconnect(default);
        Assert.Equal("moodle_disconnected", (await Assert.ThrowsAsync<ApiFailure>(() => files.Get(7, 99, resource.Id!, true, default))).Code);
    }
    [Fact] public async Task ReorderingAndTokenRotationKeepIdentityButFileRevisionChangesInvalidateOldLinks()
    {
        await Connect(); var original = await Resource();
        metadata.Reverse = true; metadata.PathKey = "differentSyntheticKey123456"; metadata.Query = "token=differentSecret";
        var reordered = await Resource(); Assert.Equal(original.Id, reordered.Id);
        await files.Get(7, 99, original.Id!, true, default);
        metadata.ModifiedAt++;
        Assert.NotEqual(original.Id, (await Resource()).Id);
        Assert.Equal("course_file_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => files.Get(7, 99, original.Id!, true, default))).Code);
        Assert.Equal(1, downloads.Requests);
    }
    [Fact] public async Task FreshMembershipRejectsRevokedCourseWithoutWaitingForCourseCacheExpiry()
    {
        await Connect(); var resource = await Resource(); metadata.Enrolled = false;
        Assert.Equal("course_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => files.Get(7, 99, resource.Id!, true, default))).Code);
        Assert.Equal(0, downloads.Requests);
    }
    [Fact] public async Task UnsupportedAndOversizeMetadataKeepDownloadOrMoodleFallbackWithoutFetching()
    {
        await Connect(); metadata.Mime = "text/html"; var html = await Resource();
        Assert.Null(html.PreviewKind); Assert.Null(html.PreviewUrl); Assert.NotNull(html.DownloadUrl);
        Assert.Equal("course_file_unsupported", (await Assert.ThrowsAsync<ApiFailure>(() => files.Get(7, 99, html.Id!, true, default))).Code);
        await files.Get(7, 99, html.Id!, false, default); Assert.Null(downloads.LastKind);
        metadata.Size = MoodleCourseFiles.MaximumBytes + 1;
        Assert.Equal("course_file_too_large", (await Assert.ThrowsAsync<ApiFailure>(() => files.Get(7, 99, html.Id!, false, default))).Code);
        Assert.Equal(1, downloads.Requests);
        metadata.UnsafeSource = true; var unsafeFile = await Resource();
        Assert.Null(unsafeFile.Id); Assert.Null(unsafeFile.DownloadUrl); Assert.Null(unsafeFile.PreviewUrl);
    }
    [Fact] public async Task ChangedConnectionDuringMetadataOrDownloadDiscardsTheOldAccountFile()
    {
        await Connect(); var resource = await Resource(); downloads.Pause = true;
        var pending = files.Get(7, 99, resource.Id!, true, default);
        await downloads.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await credentials.Write(new(Site, "Fixture", 43, "Other", Token, DateTimeOffset.UtcNow));
        downloads.Resume.TrySetResult();
        Assert.Equal("moodle_connection_changed", (await Assert.ThrowsAsync<ApiFailure>(() => pending)).Code);
        await Connect(); metadata.BeforeContents = () => moodle.Disconnect(default);
        Assert.Equal("moodle_connection_changed", (await Assert.ThrowsAsync<ApiFailure>(() => files.Get(7, 99, resource.Id!, true, default))).Code);
        Assert.Equal(1, downloads.Requests);
    }
    [Fact] public async Task TwoDownloadLimitAndCancellationReleaseTheSlots()
    {
        await Connect(); var resource = await Resource();
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => files.Get(7, 99, resource.Id!, true, default)));
        Assert.InRange(downloads.MaximumActive, 1, 2);
        downloads.Pause = true;
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => files.Get(7, 99, resource.Id!, true, cancellation.Token));
        downloads.Pause = false;
        await files.Get(7, 99, resource.Id!, true, default);
    }
    [Fact] public async Task PreviewHasSafeHeadersAndByteRangesAndDownloadHasSanitizedAttachmentName()
    {
        await using var app = Factory(); using var client = app.CreateClient();
        await app.Services.GetRequiredService<CredentialStore>().Write(Credential());
        var resource = MoodleCourseContents.Parse(metadata.Contents(), new(Site), 7)[0].Modules[0].Resources[0];
        var response = await client.GetAsync(resource.PreviewUrl);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode); Assert.Equal("application/pdf", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString()); Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        Assert.Contains("sandbox", Assert.Single(response.Headers.GetValues("Content-Security-Policy")));
        Assert.Null(response.Content.Headers.ContentDisposition); Assert.Null(response.Headers.Location);
        using var request = new HttpRequestMessage(HttpMethod.Get, resource.PreviewUrl) { Headers = { Range = new RangeHeaderValue(0, 7) } };
        var range = await client.SendAsync(request); Assert.Equal(HttpStatusCode.PartialContent, range.StatusCode);
        Assert.Equal("%PDF-1.7"u8.ToArray(), await range.Content.ReadAsByteArrayAsync());
        metadata.Name = "../unsafe\r\n\"name\\report.pdf";
        var download = await client.GetAsync(resource.DownloadUrl);
        Assert.Equal("application/octet-stream", download.Content.Headers.ContentType!.MediaType);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition!.DispositionType);
        Assert.DoesNotContain("\r", download.Content.Headers.ContentDisposition.ToString());
        Assert.DoesNotContain("../", download.Content.Headers.ContentDisposition.ToString());
        Assert.Equal("no-store", download.Headers.CacheControl!.ToString());
    }
    private async Task<CourseResource> Resource() => (await moodle.Contents(7, default)).SelectMany(section => section.Modules).Single(module => module.Id == 99)
        .Resources.Single(resource => resource.Name == metadata.Name);
    private static MoodleCredential Credential() => new(Site, "Fixture", 42, "Fixture", Token, DateTimeOffset.UtcNow);
    private Task Connect() => credentials.Write(Credential());
    private WebApplicationFactory<Program> Factory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseEnvironment("Testing"); builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        { ["STUDY_DATA_DIR"] = System.IO.Path.Combine(directory, "data"), ["STUDY_PRIVATE_DIR"] = System.IO.Path.Combine(directory, "api-private"), ["STUDY_SKIP_MIGRATIONS"] = "true", ["STUDY_PUBLIC_URL"] = "https://study.example.test",
            ["ConnectionStrings:Database"] = "Host=127.0.0.1;Port=1;Database=unused;Username=fixture;Password=fixture;Timeout=1" }));
        builder.ConfigureServices(services => { services.AddSingleton<IMoodleTransport>(metadata); services.AddSingleton<IMoodleFileTransport>(downloads); });
    });
    public void Dispose() { files.Dispose(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class Metadata : IMoodleTransport
    {
        public bool Enrolled { get; set; } = true;
        public bool Reverse { get; set; }
        public bool UnsafeSource { get; set; }
        public string PathKey { get; set; } = "syntheticPathKey12345";
        public string Query { get; set; } = "token=upstreamSecret";
        public string Mime { get; set; } = "application/pdf";
        public string Name { get; set; } = "Lecture.pdf";
        public long ModifiedAt { get; set; } = 1788888888;
        public long Size { get; set; } = 1000;
        public Func<Task>? BeforeContents { get; set; }
        public JsonElement Contents()
        {
            object[] resources = [new { type = "file", filename = Name, mimetype = Mime, filesize = Size, timemodified = ModifiedAt,
                fileurl = UnsafeSource ? "https://external.example.test/a.pdf" : Site + "/tokenpluginfile.php/" + PathKey + CourseFileTransportTests.Path + "?" + Query },
                new { type = "file", filename = "Other.pdf", mimetype = "application/pdf", filesize = 100, timemodified = 1,
                    fileurl = Site + "/webservice/pluginfile.php/91/mod_resource/content/1/other.pdf" }];
            if (Reverse) Array.Reverse(resources);
            return JsonSerializer.SerializeToElement(new[] { new { id = 11, name = "Week", modules = new[] { new { id = 99, name = "Lecture", modname = "resource", contents = resources } } } });
        }
        public Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct) => throw new InvalidOperationException();
        public async Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct)
        {
            Assert.Equal(Token, token);
            if (method == "core_webservice_get_site_info") return JsonSerializer.SerializeToElement(new { siteurl = Site, userid = 42 });
            if (method == "core_enrol_get_users_courses") return JsonSerializer.SerializeToElement(Enrolled ? new[] { new { id = 7, fullname = "Course" } } : []);
            Assert.Equal("core_course_get_contents", method); Assert.Equal("7", args!["courseid"]);
            if (BeforeContents is not null) await BeforeContents();
            return Contents();
        }
    }
    private sealed class Downloads : IMoodleFileTransport
    {
        private int active;
        public int MaximumActive { get; private set; }
        public int Requests { get; private set; }
        public string? LastSource { get; private set; }
        public string? LastKind { get; private set; }
        public bool Pause { get; set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<MoodleFile> Fetch(Uri site, Uri source, string token, string? previewKind, CancellationToken ct, string? expectedMime = null)
        {
            Assert.Equal(Token, token); Requests++; LastSource = source.AbsoluteUri; LastKind = previewKind;
            var count = Interlocked.Increment(ref active); MaximumActive = Math.Max(MaximumActive, count); Started.TrySetResult();
            try { if (Pause) await Resume.Task.WaitAsync(ct); else await Task.Delay(10, ct);
                return new(CourseFileTransportTests.Pdf, previewKind is null ? "application/octet-stream" : "application/pdf"); }
            finally { Interlocked.Decrement(ref active); }
        }
    }
}
