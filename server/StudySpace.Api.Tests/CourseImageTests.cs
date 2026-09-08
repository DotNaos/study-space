using System.Net;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class CourseImageTests : IDisposable
{
    private const string Site = "https://moodle.example.test/learning";
    private const string Token = "syntheticImageAccountToken1234567";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-images-" + Guid.NewGuid());
    private readonly CourseTransport metadata = new();
    private readonly ImageTransport downloads = new();
    private readonly TestClock clock = new();
    private readonly CredentialStore credentials;
    private readonly MoodleService moodle;
    private readonly MoodleImageService images;

    public CourseImageTests()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_PRIVATE_DIR"] = directory }).Build();
        credentials = new(DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(directory, "keys"))), configuration);
        moodle = new(metadata, credentials, clock);
        images = new(moodle, credentials, downloads);
    }

    [Fact] public async Task OnlyGenuineImageMetadataBecomesAnApplicationUrlAndDatesRemainUpstreamValues()
    {
        await Connect();
        var courses = await moodle.Courses(default);
        Assert.Equal("/api/providers/moodle/courses/7/image", courses[0].ImageUrl);
        Assert.Equal(1780000000, courses[0].StartDate);
        Assert.Null(courses[0].EndDate);
        Assert.Null(courses[1].ImageUrl);
        Assert.Null(courses[2].ImageUrl);
        var json = JsonSerializer.Serialize(courses);
        Assert.DoesNotContain(Token, json);
        Assert.DoesNotContain("upstreamSecret", json);
        Assert.DoesNotContain("overviewfiles", json);
        Assert.Equal(CourseImageTransportTests.Png, (await images.Get(7, default)).Bytes);
        Assert.Equal("https://moodle.example.test/learning/webservice/pluginfile.php/91/course/overviewfiles/cover.png", downloads.LastSource);
        Assert.Equal(1, metadata.CourseReads);
    }

    [Fact] public async Task ConcurrentThumbnailsShareOneMetadataReadAndHaveBoundedDownloads()
    {
        await Connect();
        await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => images.Get(7, default)));
        Assert.Equal(1, metadata.AccountReads);
        Assert.Equal(1, metadata.CourseReads);
        Assert.Equal(20, downloads.Requests);
        Assert.InRange(downloads.MaximumActive, 1, 4);
    }

    [Fact] public async Task MissingImageAndNonMemberNeverStartAFileDownload()
    {
        Assert.Equal("moodle_disconnected", (await Assert.ThrowsAsync<ApiFailure>(() => images.Get(7, default))).Code);
        await Connect();
        Assert.Equal("course_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => images.Get(99, default))).Code);
        Assert.Equal("course_image_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => images.Get(8, default))).Code);
        Assert.Equal(0, downloads.Requests);
    }

    [Fact] public async Task ExpiredSnapshotDoesNotRetainRemovedEnrollmentOrHideUpstreamErrors()
    {
        await Connect();
        await moodle.Courses(default);
        metadata.HasCourse = false;
        clock.Advance(TimeSpan.FromSeconds(31));
        Assert.Equal("course_unavailable", (await Assert.ThrowsAsync<ApiFailure>(() => images.Get(7, default))).Code);
        Assert.Equal(2, metadata.CourseReads);
        metadata.Failure = new ApiFailure("moodle_unreachable", "Unavailable.", 502);
        clock.Advance(TimeSpan.FromSeconds(31));
        Assert.Equal("moodle_unreachable", (await Assert.ThrowsAsync<ApiFailure>(() => images.Get(7, default))).Code);
        Assert.Equal(0, downloads.Requests);
    }

    [Fact] public async Task DisconnectAndAccountReplacementInvalidateTheMetadataSnapshot()
    {
        await Connect();
        await moodle.Courses(default);
        await moodle.Disconnect(default);
        Assert.Equal("moodle_disconnected", (await Assert.ThrowsAsync<ApiFailure>(() => images.Get(7, default))).Code);
        await Connect(); // Even the same credential must refresh after an explicit disconnect.
        await moodle.Courses(default);
        Assert.Equal(2, metadata.CourseReads);
        metadata.UserId = 43;
        await Connect(43);
        await images.Get(7, default);
        Assert.Equal(3, metadata.CourseReads);
    }

    [Fact] public async Task DisconnectDuringDownloadDiscardsTheOldAccountImage()
    {
        await Connect();
        downloads.Pause = true;
        var pending = images.Get(7, default);
        await downloads.Started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await moodle.Disconnect(default);
        downloads.Resume.TrySetResult();
        Assert.Equal("moodle_connection_changed", (await Assert.ThrowsAsync<ApiFailure>(() => pending)).Code);
    }

    [Fact] public async Task ImageEndpointReturnsOnlyRasterBytesWithNoStoreAndNoSniffHeaders()
    {
        await using var app = Factory();
        using var client = app.CreateClient();
        await app.Services.GetRequiredService<CredentialStore>().Write(Credential());
        var response = await client.GetAsync("/api/providers/moodle/courses/7/image");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal("nosniff", Assert.Single(response.Headers.GetValues("X-Content-Type-Options")));
        Assert.Equal(CourseImageTransportTests.Png, await response.Content.ReadAsByteArrayAsync());
        Assert.Null(response.Headers.Location);
    }

    [Fact] public async Task ImageLimitIsBoundedWithoutSpendingCourseOrLoginRequestBudget()
    {
        await using var app = Factory(); using var client = app.CreateClient();
        await app.Services.GetRequiredService<CredentialStore>().Write(Credential());
        for (var request = 0; request < 120; request++)
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/providers/moodle/courses/7/image")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/providers/moodle/courses/7/image")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/providers/moodle/courses")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/providers/moodle/login/unknown")).StatusCode);
        Assert.Equal(1, metadata.CourseReads);
    }

    [Fact] public void BrowserCourseImageFallbackAcceptsOnlyRealOverviewFiles()
    {
        var real = JsonSerializer.SerializeToElement(new { courseimage = Site + "/pluginfile.php/91/course/overviewfiles/cover.jpg?token=upstreamSecret" });
        Assert.Equal(Site + "/webservice/pluginfile.php/91/course/overviewfiles/cover.jpg", MoodleCourseImages.Select(real, new(Site))!.AbsoluteUri);
        var generated = JsonSerializer.SerializeToElement(new { courseimage = Site + "/theme/image.php/generated.svg" });
        Assert.Null(MoodleCourseImages.Select(generated, new(Site)));
    }

    [Theory][InlineData("image/svg+xml", 200)][InlineData("image/png", MoodleCourseImages.MaximumBytes + 1)]
    public void UnsupportedOverviewMetadataCannotBeBypassedByCourseImageFallback(string mime, int size)
    {
        var url = Site + "/pluginfile.php/91/course/overviewfiles/cover.png";
        var course = JsonSerializer.SerializeToElement(new { courseimage = url, overviewfiles = new[] { new { mimetype = mime, filesize = size, fileurl = url } } });
        Assert.Null(MoodleCourseImages.Select(course, new(Site)));
    }

    private MoodleCredential Credential(long userId = 42) => new(Site, "Fixture", userId, "Fixture", Token, clock.GetUtcNow());
    private Task Connect(long userId = 42) => credentials.Write(Credential(userId));
    private WebApplicationFactory<Program> Factory() => new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
    {
        builder.UseEnvironment("Testing");
        builder.ConfigureAppConfiguration((_, config) => config.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["STUDY_PRIVATE_DIR"] = Path.Combine(directory, "api-private"), ["STUDY_SKIP_MIGRATIONS"] = "true",
            ["STUDY_PUBLIC_URL"] = "https://study.example.test",
            ["ConnectionStrings:Database"] = "Host=127.0.0.1;Port=1;Database=unused;Username=fixture;Password=fixture;Timeout=1"
        }));
        builder.ConfigureServices(services => { services.AddSingleton<IMoodleTransport>(metadata); services.AddSingleton<IMoodleImageTransport>(downloads); });
    });
    public void Dispose() { images.Dispose(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset now = new(2026, 9, 9, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan by) => now += by;
    }
    private sealed class CourseTransport : IMoodleTransport
    {
        public int CourseReads { get; private set; }
        public int AccountReads { get; private set; }
        public long UserId { get; set; } = 42;
        public bool HasCourse { get; set; } = true;
        public ApiFailure? Failure { get; set; }
        public Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct) => throw new InvalidOperationException();
        public async Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct)
        {
            Assert.Equal(Site, site.AbsoluteUri.TrimEnd('/')); Assert.Equal(Token, token);
            if (Failure is not null) throw Failure;
            if (method == "core_webservice_get_site_info") { AccountReads++; return JsonSerializer.SerializeToElement(new { siteurl = Site, userid = UserId }); }
            Assert.Equal("core_enrol_get_users_courses", method); Assert.Equal(UserId.ToString(), args!["userid"]);
            CourseReads++; await Task.Delay(10, ct);
            if (!HasCourse) return JsonSerializer.SerializeToElement(Array.Empty<object>());
            return JsonSerializer.SerializeToElement(new object[]
            {
                new { id = 7, fullname = "Fixture course", startdate = 1780000000, enddate = 0,
                    overviewfiles = new[] { new { mimetype = "image/png", filesize = 200, fileurl = Site + "/webservice/pluginfile.php/91/course/overviewfiles/cover.png?token=upstreamSecret" } } },
                new { id = 8, fullname = "No uploaded image", courseimage = "data:image/svg+xml,synthetic" },
                new { id = 9, fullname = "External image", overviewfiles = new[] { new { mimetype = "image/png", filesize = 200, fileurl = "https://other.example.test/image.png" } } }
            });
        }
    }
    private sealed class ImageTransport : IMoodleImageTransport
    {
        private int active;
        private int maximum;
        private int requests;
        public int MaximumActive => maximum;
        public int Requests => requests;
        public string? LastSource { get; private set; }
        public bool Pause { get; set; }
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public async Task<MoodleImage> Fetch(Uri site, Uri source, string token, CancellationToken ct)
        {
            Assert.Equal(Site, site.AbsoluteUri.TrimEnd('/')); Assert.Equal(Token, token);
            LastSource = source.AbsoluteUri; Interlocked.Increment(ref requests);
            var count = Interlocked.Increment(ref active);
            int previous;
            do { previous = maximum; if (count <= previous) break; } while (Interlocked.CompareExchange(ref maximum, count, previous) != previous);
            Started.TrySetResult();
            try { if (Pause) await Resume.Task.WaitAsync(ct); else await Task.Delay(10, ct); return new(CourseImageTransportTests.Png, "image/png"); }
            finally { Interlocked.Decrement(ref active); }
        }
    }
}
