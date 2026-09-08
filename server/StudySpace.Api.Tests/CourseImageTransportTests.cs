using System.Net;
using System.Net.Http.Headers;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class CourseImageTransportTests
{
    private static readonly Uri Site = new("https://moodle.example.test/learning");
    private static readonly Uri Source = new(Site + "/pluginfile.php/91/course/overviewfiles/cover.png?token=upstreamSecret#private");
    internal static readonly byte[] Png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=");

    [Fact] public async Task AuthenticatedImageUsesBoundedRasterResponseAndBodyTokenOnCanonicalSitePath()
    {
        var handler = new ImageHandler(() => Response(Png));
        var result = await new MoodleImageTransport(new Factory(handler)).Fetch(Site, Source, "syntheticOwnToken123", default);
        Assert.Equal(Png, result.Bytes);
        Assert.Equal("image/png", result.ContentType);
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal("https://moodle.example.test/learning/webservice/pluginfile.php/91/course/overviewfiles/cover.png", handler.Url);
        Assert.DoesNotContain("Secret", handler.Url);
        Assert.Equal("token=syntheticOwnToken123", handler.Body);
    }

    [Theory]
    [InlineData("https://other.example.test/pluginfile.php/91/course/overviewfiles/cover.png")]
    [InlineData("https://user:secret@moodle.example.test/learning/pluginfile.php/91/course/overviewfiles/cover.png")]
    [InlineData("http://moodle.example.test/learning/pluginfile.php/91/course/overviewfiles/cover.png")]
    [InlineData("https://moodle.example.test/pluginfile.php/91/course/overviewfiles/cover.png")]
    [InlineData("https://moodle.example.test/learning/tokenpluginfile.php/pathSecret/91/course/overviewfiles/cover.png")]
    [InlineData("https://moodle.example.test/learning/pluginfile.php/91/user/private/cover.png")]
    [InlineData("https://moodle.example.test/learning/pluginfile.php/91/course/overviewfiles/%2e%2e%2fprivate/cover.png")]
    [InlineData("https://moodle.example.test/learning/pluginfile.php/91/course/overviewfiles/%252e%252e%252fprivate/cover.png")]
    [InlineData("https://moodle.example.test/learning/pluginfile.php/91/course/overviewfiles/%5cprivate/cover.png")]
    public async Task UnsafeDestinationsNeverReceiveAnyRequest(string value)
    {
        var handler = new ImageHandler(() => Response(Png));
        var error = await Assert.ThrowsAsync<ApiFailure>(() => new MoodleImageTransport(new Factory(handler)).Fetch(Site, new(value), "syntheticOwnToken123", default));
        Assert.Equal("course_image_unavailable", error.Code);
        Assert.Equal(0, handler.Requests);
        Assert.DoesNotContain("secret", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact] public async Task RedirectIsNotFollowedOrReturnedToTheBrowser()
    {
        var handler = new ImageHandler(() => new(HttpStatusCode.Found) { Headers = { Location = new("https://other.example.test/?token=secret") } });
        var error = await Assert.ThrowsAsync<ApiFailure>(() => new MoodleImageTransport(new Factory(handler)).Fetch(Site, Source, "syntheticOwnToken123", default));
        Assert.Equal("course_image_unavailable", error.Code);
        Assert.Equal(1, handler.Requests);
        Assert.DoesNotContain("secret", error.Message);
    }

    [Theory]
    [InlineData("image/svg+xml", "<svg onload='secret'></svg>")]
    [InlineData("text/html", "<html>secret</html>")]
    [InlineData("image/png", "<svg onload='secret'></svg>")]
    [InlineData("image/jpeg", "not an image")]
    public async Task UnsupportedMimeAndFalseRasterDeclarationsAreRejected(string mime, string body)
    {
        var handler = new ImageHandler(() => Response(System.Text.Encoding.UTF8.GetBytes(body), mime));
        Assert.Equal("course_image_unsupported", (await Assert.ThrowsAsync<ApiFailure>(() => new MoodleImageTransport(new Factory(handler)).Fetch(Site, Source, "syntheticOwnToken123", default))).Code);
    }

    [Theory][InlineData(true)][InlineData(false)]
    public async Task BothAdvertisedAndStreamingOversizeImagesAreRejected(bool declared)
    {
        var handler = new ImageHandler(() =>
        {
            var response = declared ? Response(Png) : new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StreamContent(new NonSeekableStream(new byte[MoodleCourseImages.MaximumBytes + 1])) };
            response.Content.Headers.ContentType = new("image/png");
            if (declared) response.Content.Headers.ContentLength = MoodleCourseImages.MaximumBytes + 1;
            return response;
        });
        Assert.Equal("course_image_too_large", (await Assert.ThrowsAsync<ApiFailure>(() => new MoodleImageTransport(new Factory(handler)).Fetch(Site, Source, "syntheticOwnToken123", default))).Code);
    }

    [Fact] public async Task RequestCancellationStopsAnUnresponsiveUpstream()
    {
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        var handler = new CancellationHandler();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new MoodleImageTransport(new Factory(handler)).Fetch(Site, Source, "syntheticOwnToken123", cancellation.Token));
        Assert.True(handler.Cancelled);
    }

    private static HttpResponseMessage Response(byte[] bytes, string mime = "image/png") => new(HttpStatusCode.OK)
    { Content = new ByteArrayContent(bytes) { Headers = { ContentType = new MediaTypeHeaderValue(mime) } } };
    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    { public HttpClient CreateClient(string name) { Assert.Equal("moodle", name); return new(handler, disposeHandler: false); } }
    private sealed class ImageHandler(Func<HttpResponseMessage> response) : HttpMessageHandler
    {
        public int Requests { get; private set; }
        public string? Url { get; private set; }
        public string? Body { get; private set; }
        public HttpMethod? Method { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests++; Url = request.RequestUri!.AbsoluteUri; Method = request.Method;
            Body = await request.Content!.ReadAsStringAsync(ct);
            return response();
        }
    }
    private sealed class NonSeekableStream(byte[] bytes) : MemoryStream(bytes)
    { public override bool CanSeek => false; }
    private sealed class CancellationHandler : HttpMessageHandler
    {
        public bool Cancelled { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            try { await Task.Delay(Timeout.InfiniteTimeSpan, ct); }
            catch (OperationCanceledException) { Cancelled = true; throw; }
            throw new InvalidOperationException();
        }
    }
}
