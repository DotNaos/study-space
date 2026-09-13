using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using StudySpace.Api.Mcp;
namespace StudySpace.Api.Tests;

public sealed class StudyMcpReviewTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    [Fact] public void ReadToolsRemainReadOnlyAndWriteCapabilitiesRequireSeparateOptIns()
    {
        using var client = new HttpClient(new Handler()) { BaseAddress = new("http://fixture.test") };
        var readOnly = JsonSerializer.SerializeToElement(new StudyMcpTools(client).Definitions, Json);
        Assert.Equal(11, readOnly.GetArrayLength());
        Assert.All(readOnly.EnumerateArray(), tool => Assert.True(tool.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean()));
        var feedback = JsonSerializer.SerializeToElement(new StudyMcpTools(client, allowFeedbackWrites: true).Definitions, Json);
        Assert.Contains(feedback.EnumerateArray(), tool => tool.GetProperty("name").GetString() == "study_feedback" && !tool.GetProperty("annotations").GetProperty("readOnlyHint").GetBoolean());
        Assert.DoesNotContain(feedback.EnumerateArray(), tool => tool.GetProperty("name").GetString() == "study_pipeline_decide");
        var pipeline = JsonSerializer.SerializeToElement(new StudyMcpTools(client, allowPipelineWrites: true).Definitions, Json);
        Assert.Equal(13, pipeline.GetArrayLength());
        Assert.DoesNotContain(pipeline.EnumerateArray(), tool => tool.GetProperty("name").GetString() == "study_feedback");
    }
    [Fact] public async Task DisabledWritesNeverReachTheApplication()
    {
        var handler = new Handler(); using var client = new HttpClient(handler) { BaseAddress = new("http://fixture.test") };
        foreach (var name in new[] { "study_feedback", "study_pipeline_decide", "study_pipeline_structure" })
            await Assert.ThrowsAsync<StudyMcpException>(() => new StudyMcpTools(client).Call(Parameters(name, new { course_id = 7 }), default));
        Assert.Empty(handler.Requests);
    }
    [Fact] public async Task FeedbackWriteIsScopedToExactAttemptAndDoesNotForwardUnrelatedFields()
    {
        var handler = new Handler(); using var client = new HttpClient(handler) { BaseAddress = new("http://fixture.test") };
        await new StudyMcpTools(client, allowFeedbackWrites: true).Call(Parameters("study_feedback", new {
            course_id = 7, attempt_id = new string('a', 32), attempt_revision = 3, answer_hash = new string('b', 64), reviewer = "review-agent",
            outcome = "uncertain", comment = "The original figure is needed.", ignored_path = "/private/config"
        }), default);
        var request = Assert.Single(handler.Requests); Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("/api/learning/courses/7/attempts/" + new string('a', 32) + "/feedback", request.Path);
        Assert.DoesNotContain("ignored_path", request.Body); Assert.DoesNotContain("private", request.Body);
        Assert.Contains("answerHash", request.Body);
    }
    [Fact] public async Task InvalidAttemptPathCannotEscapeOwnedEndpoint()
    {
        var handler = new Handler(); using var client = new HttpClient(handler) { BaseAddress = new("http://fixture.test") };
        await Assert.ThrowsAsync<StudyMcpException>(() => new StudyMcpTools(client, allowFeedbackWrites: true).Call(Parameters("study_feedback", new {
            course_id = 7, attempt_id = "../../../private"
        }), default));
        Assert.Empty(handler.Requests);
    }
    private static JsonElement Parameters(string name, object arguments) => JsonSerializer.SerializeToElement(new { name, arguments }, Json);
    private sealed class Handler : HttpMessageHandler
    {
        public List<(HttpMethod Method, string Path, string Body)> Requests { get; } = [];
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add((request.Method, request.RequestUri!.AbsolutePath, request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));
            return new(HttpStatusCode.OK) { Content = JsonContent.Create(new { recorded = true }) };
        }
    }
}
