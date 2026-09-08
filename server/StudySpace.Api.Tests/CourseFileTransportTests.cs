using System.Net;
using System.Text;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class CourseFileTransportTests
{
    internal const string Site = "https://moodle.example.test/learning";
    internal const string Path = "/91/mod_resource/content/1/Lecture%201.pdf";
    internal static readonly byte[] Pdf = "%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF"u8.ToArray();
    private static readonly Uri Source = new(Site + "/tokenpluginfile.php/syntheticPathKey12345" + Path + "?token=upstreamSecret#private");

    [Fact] public async Task MobilePathKeyAndQueryNeverReachUpstreamOrBrowser()
    {
        var handler = new Handler(() => Response(Pdf, "application/pdf"));
        var file = await Fetch(handler, "pdf");
        Assert.Equal(Pdf, file.Bytes); Assert.Equal("application/pdf", file.ContentType);
        Assert.Equal(HttpMethod.Post, handler.Method);
        Assert.Equal(Site + "/webservice/pluginfile.php" + Path, handler.Url);
        Assert.Equal("token=syntheticSavedToken12345", handler.Body);
        Assert.DoesNotContain("PathKey", handler.Url); Assert.DoesNotContain("upstreamSecret", handler.Url);
    }

    [Theory]
    [InlineData("/webservice/pluginfile.php")][InlineData("/pluginfile.php")]
    [InlineData("/tokenpluginfile.php/syntheticPathKey12345")]
    public void CanonicalEndpointsResolveToOnePrivateSource(string endpoint)
    { Assert.Equal(Site + "/webservice/pluginfile.php" + Path, MoodleCourseFiles.DownloadUrl(Site + endpoint + Path + "?token=secret", new(Site))!.AbsoluteUri); }

    [Theory]
    [InlineData("https://other.example.test/pluginfile.php/91/mod_resource/content/1/a.pdf")]
    [InlineData("https://user:secret@moodle.example.test/learning/pluginfile.php/91/mod_resource/content/1/a.pdf")]
    [InlineData("http://moodle.example.test/learning/pluginfile.php/91/mod_resource/content/1/a.pdf")]
    [InlineData(Site + "/%70luginfile.php/91/mod_resource/content/1/a.pdf")]
    [InlineData(Site + "/webservice%2fpluginfile.php/91/mod_resource/content/1/a.pdf")]
    [InlineData(Site + "/tokenpluginfile.php/short/91/mod_resource/content/1/a.pdf")]
    [InlineData(Site + "/tokenpluginfile.php/secret%2fpath/91/mod_resource/content/1/a.pdf")]
    [InlineData(Site + "/pluginfile.php/91/mod_resource/content/../a.pdf")]
    [InlineData(Site + "/pluginfile.php/91/mod_resource/content/%2e%2e/a.pdf")]
    [InlineData(Site + "/pluginfile.php/91/mod_resource/content/%252e%252e/a.pdf")]
    [InlineData(Site + "/pluginfile.php/91/mod_resource/content/%2fetc/passwd")]
    [InlineData(Site + "/pluginfile.php/91/mod_resource/content/%5cetc/passwd")]
    [InlineData(Site + "/pluginfile.php/91/mod_resource/content/a%00.pdf")]
    [InlineData(Site + "/pluginfile.php/91/mod_resource/content//a.pdf")]
    [InlineData(Site + "/pluginfile.php/91/not-a-component/content/a.pdf")]
    [InlineData("https://moodle.example.test/outside/pluginfile.php/91/mod_resource/content/a.pdf")]
    public void UnsafeAndAmbiguousPathsNeverBecomeFileSources(string raw)
    { Assert.Null(MoodleCourseFiles.DownloadUrl(raw, new(Site))); }

    [Fact] public async Task CrossOriginTransportNeverSendsCredentialAndRedirectNeverEscapes()
    {
        var handler = new Handler(() => new(HttpStatusCode.Found) { Headers = { Location = new("https://other.example.test/?secret=1") } });
        await Assert.ThrowsAsync<ApiFailure>(() => new MoodleFileTransport(new Factory(handler)).Fetch(new(Site), new("https://other.example.test/a.pdf"), "secret", "pdf", default));
        Assert.Equal(0, handler.Requests);
        var error = await Assert.ThrowsAsync<ApiFailure>(() => Fetch(handler, "pdf"));
        Assert.Equal("course_file_unavailable", error.Code); Assert.Equal(1, handler.Requests);
        Assert.DoesNotContain("secret", error.Message);
    }

    [Theory]
    [InlineData("application/pdf", "<html>private</html>", "pdf")]
    [InlineData("text/html", "%PDF-1.7", "pdf")]
    [InlineData("image/svg+xml", "<svg></svg>", "image")]
    [InlineData("image/png", "<script>private</script>", "image")]
    [InlineData("image/jpeg", "not an image", "image")]
    [InlineData("image/gif", "invalid", "image")]
    [InlineData("image/webp", "invalid", "image")]
    [InlineData("application/pdf", "%PDF-1.7", "image")]
    public async Task FalseOrActivePreviewContentIsRejected(string mime, string bytes, string kind)
    {
        var error = await Assert.ThrowsAsync<ApiFailure>(() => Fetch(new Handler(() => Response(Encoding.UTF8.GetBytes(bytes), mime)), kind));
        Assert.Equal("course_file_unsupported", error.Code); Assert.DoesNotContain("private", error.Message);
    }

    [Theory][InlineData("image/png")][InlineData("image/gif")][InlineData("image/jpeg")][InlineData("image/webp")]
    public async Task SupportedRasterSignaturesRetainTheVerifiedType(string mime)
    {
        var bytes = mime switch { "image/png" => CourseImageTransportTests.Png, "image/gif" => "GIF89a"u8.ToArray(),
            "image/jpeg" => new byte[] { 255, 216, 255 }, _ => "RIFF0000WEBP"u8.ToArray() };
        Assert.Equal(mime, (await Fetch(new Handler(() => Response(bytes, mime)), "image")).ContentType);
    }

    [Theory][InlineData("text/html")][InlineData("image/svg+xml")][InlineData("application/vnd.openxmlformats-officedocument.presentationml.presentation")]
    public async Task UnsupportedDownloadsAlwaysBecomeInertAttachments(string mime)
    { Assert.Equal("application/octet-stream", (await Fetch(new Handler(() => Response("content"u8.ToArray(), mime)), null)).ContentType); }

    [Theory][InlineData("text/html", "<html>Login required</html>")][InlineData("application/json", "{\"exception\":\"private\",\"errorcode\":\"invalidtoken\"}")]
    public async Task UpstreamErrorPagesDoNotBecomeBogusDocumentAttachments(string mime, string content)
    {
        var handler = new Handler(() => Response(Encoding.UTF8.GetBytes(content), mime));
        var error = await Assert.ThrowsAsync<ApiFailure>(() => new MoodleFileTransport(new Factory(handler)).Fetch(new(Site), Source, "syntheticSavedToken12345", null, default, "application/pdf"));
        Assert.Equal("course_file_unavailable", error.Code); Assert.DoesNotContain("private", error.Message);
        if (mime == "application/json")
            await Assert.ThrowsAsync<ApiFailure>(() => new MoodleFileTransport(new Factory(handler)).Fetch(new(Site), Source, "syntheticSavedToken12345", null, default, "application/json"));
        else Assert.Equal("application/octet-stream", (await new MoodleFileTransport(new Factory(handler)).Fetch(new(Site), Source, "syntheticSavedToken12345", null, default, "text/html")).ContentType);
    }

    [Theory][InlineData(true)][InlineData(false)]
    public async Task DeclaredAndChunkedFilesBothEnforceTheByteLimit(bool declared)
    {
        var handler = new Handler(() =>
        {
            var response = declared ? Response(Pdf, "application/pdf") : new HttpResponseMessage(HttpStatusCode.OK)
            { Content = new StreamContent(new NonSeekableStream(new byte[MoodleCourseFiles.MaximumBytes + 1])) };
            response.Content.Headers.ContentType = new("application/pdf");
            if (declared) response.Content.Headers.ContentLength = MoodleCourseFiles.MaximumBytes + 1;
            return response;
        });
        Assert.Equal("course_file_too_large", (await Assert.ThrowsAsync<ApiFailure>(() => Fetch(handler, "pdf"))).Code);
    }

    [Fact] public async Task CancellationStopsHeadersAndBodyReads()
    {
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        var handler = new BlockingHandler();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Fetch(handler, "pdf", cancellation.Token));
        Assert.True(handler.Cancelled);
        using var bodyCancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        var stream = new BlockingStream();
        var body = new Handler(() => new(HttpStatusCode.OK) { Content = new StreamContent(stream) { Headers = { ContentType = new("application/pdf") } } });
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Fetch(body, "pdf", bodyCancellation.Token));
        Assert.True(stream.Cancelled);
    }
    private static Task<MoodleFile> Fetch(HttpMessageHandler handler, string? kind, CancellationToken ct = default) =>
        new MoodleFileTransport(new Factory(handler)).Fetch(new(Site), Source, "syntheticSavedToken12345", kind, ct);
    private static HttpResponseMessage Response(byte[] bytes, string mime) => new(HttpStatusCode.OK)
    { Content = new ByteArrayContent(bytes) { Headers = { ContentType = new(mime) } } };
    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    { public HttpClient CreateClient(string name) { Assert.Equal("moodle", name); return new(handler, false); } }
    private sealed class Handler(Func<HttpResponseMessage> response) : HttpMessageHandler
    {
        public int Requests { get; private set; }
        public string? Url { get; private set; }
        public string? Body { get; private set; }
        public HttpMethod? Method { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        { Requests++; Url = request.RequestUri!.AbsoluteUri; Method = request.Method; Body = await request.Content!.ReadAsStringAsync(ct); return response(); }
    }
    private sealed class NonSeekableStream(byte[] bytes) : MemoryStream(bytes) { public override bool CanSeek => false; }
    private sealed class BlockingHandler : HttpMessageHandler
    {
        public bool Cancelled { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        { try { await Task.Delay(Timeout.InfiniteTimeSpan, ct); } catch (OperationCanceledException) { Cancelled = true; throw; } throw new InvalidOperationException(); }
    }
    private sealed class BlockingStream : MemoryStream
    {
        public bool Cancelled { get; private set; }
        public override bool CanSeek => false;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        { try { await Task.Delay(Timeout.InfiniteTimeSpan, ct); } catch (OperationCanceledException) { Cancelled = true; throw; } return 0; }
    }
}
