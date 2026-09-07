using System.Net;
using System.Text;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class TransportTests
{
    [Theory]
    [InlineData("invalidtoken", "moodle_token_rejected", 401)]
    [InlineData("maintenance", "moodle_rejected", 502)]
    [InlineData("invalidparameter", "moodle_rejected", 502)]
    public async Task OnlyExplicitInvalidTokenMeansReconnect(string upstreamCode, string expectedCode, int expectedStatus)
    {
        var handler = new RecordingHandler($"{{\"exception\":\"moodle_exception\",\"errorcode\":\"{upstreamCode}\",\"message\":\"PRIVATE UPSTREAM DETAILS\"}}");
        var transport = new MoodleTransport(new FixtureFactory(handler));
        var failure = await Assert.ThrowsAsync<ApiFailure>(() => transport.Authenticated(new("https://moodle.example.test"), "syntheticSecret123456789", "core_webservice_get_site_info", null, default));
        Assert.Equal(expectedCode, failure.Code); Assert.Equal(expectedStatus, failure.Status);
        Assert.DoesNotContain("PRIVATE", failure.Message);
        Assert.DoesNotContain("syntheticSecret", handler.Url!);
        Assert.Contains("wstoken=syntheticSecret", handler.Body!);
        Assert.Equal(HttpMethod.Post, handler.Method);
    }
    [Fact] public async Task InvalidJsonIsSanitized()
    {
        var transport = new MoodleTransport(new FixtureFactory(new RecordingHandler("not json PRIVATE")));
        var error = await Assert.ThrowsAsync<ApiFailure>(() => transport.Public(new("https://moodle.example.test"), "tool_mobile_get_public_config", new { }, default));
        Assert.Equal("moodle_response", error.Code); Assert.DoesNotContain("PRIVATE", error.Message);
    }
    private sealed class FixtureFactory(HttpMessageHandler handler) : IHttpClientFactory
    { public HttpClient CreateClient(string name) => new(handler, disposeHandler: false); }
    private sealed class RecordingHandler(string response) : HttpMessageHandler
    {
        public string? Url { get; private set; }
        public string? Body { get; private set; }
        public HttpMethod? Method { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Url = request.RequestUri!.AbsoluteUri; Method = request.Method;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(response, Encoding.UTF8, "application/json") };
        }
    }
}
