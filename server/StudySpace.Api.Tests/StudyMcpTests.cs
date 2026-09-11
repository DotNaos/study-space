using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Mcp;
using StudySpace.Api.Providers.Moodle;

namespace StudySpace.Api.Tests;

public sealed class StudyMcpTests
{
    [Fact]
    public void ExposedToolsAreReadOnlyAndBounded()
    {
        var tools = JsonSerializer.SerializeToElement(StudyMcpTools.ToolDefinitions, Options);
        Assert.Equal(
            ["study_status", "study_courses", "study_course", "study_learning", "study_materials", "study_source", "study_file", "study_search"],
            tools.EnumerateArray().Select(tool => tool.GetProperty("name").GetString() ?? "").ToArray());
        foreach (var tool in tools.EnumerateArray())
        {
            var annotations = tool.GetProperty("annotations");
            Assert.True(annotations.GetProperty("readOnlyHint").GetBoolean());
            Assert.False(annotations.GetProperty("destructiveHint").GetBoolean());
            Assert.False(annotations.GetProperty("openWorldHint").GetBoolean());
            Assert.False(tool.GetProperty("inputSchema").GetProperty("additionalProperties").GetBoolean());
        }
    }

    [Fact]
    public async Task ExerciseSolutionsAndDraftsRequireExplicitOptIn()
    {
        var handler = new FixtureHandler();
        var tools = Tools(handler);

        var hidden = Structured(await tools.Call(Parameters("study_learning", new { course_id = 7, exercise_id = "exercise-1" }), default));
        var exercise = hidden.GetProperty("exercise");
        Assert.Equal(JsonValueKind.Null, exercise.GetProperty("solution").ValueKind);
        Assert.Equal(JsonValueKind.Null, exercise.GetProperty("draft").ValueKind);

        var shown = Structured(await tools.Call(Parameters("study_learning", new
        {
            course_id = 7,
            exercise_id = "exercise-1",
            include_solutions = true,
            include_drafts = true,
        }), default));
        exercise = shown.GetProperty("exercise");
        Assert.Equal("42", exercise.GetProperty("solution").GetString());
        Assert.Equal("my draft", exercise.GetProperty("draft").GetString());
        Assert.All(handler.Methods, method => Assert.Equal(HttpMethod.Get, method));
    }

    [Fact]
    public async Task SearchDoesNotExposeExerciseSolutionsWithoutOptIn()
    {
        var tools = Tools(new FixtureHandler());
        var hidden = Structured(await tools.Call(Parameters("study_search", new { course_id = 7, query = "42" }), default));
        Assert.Empty(hidden.GetProperty("results").EnumerateArray());

        var shown = Structured(await tools.Call(Parameters("study_search", new { course_id = 7, query = "42", include_solutions = true }), default));
        var hit = Assert.Single(shown.GetProperty("results").EnumerateArray());
        Assert.Equal("exercise", hit.GetProperty("kind").GetString());
        Assert.Equal("exercise-1", hit.GetProperty("id").GetString());
    }

    [Fact]
    public async Task FileReturnsPdfAsEmbeddedResource()
    {
        var handler = new FixtureHandler();
        var result = JsonSerializer.SerializeToElement(await Tools(handler).Call(
            Parameters("study_file", new { material_id = "material-1", revision = "revision-1" }), default), Options);

        Assert.False(result.TryGetProperty("structuredContent", out _));
        var content = result.GetProperty("content").EnumerateArray().ToArray();
        Assert.Equal(2, content.Length);
        Assert.Equal("text", content[0].GetProperty("type").GetString());
        Assert.Equal("resource", content[1].GetProperty("type").GetString());
        var resource = content[1].GetProperty("resource");
        Assert.Equal("application/pdf", resource.GetProperty("mimeType").GetString());
        Assert.Equal("study://materials/material-1/revisions/revision-1/original", resource.GetProperty("uri").GetString());
        Assert.Equal("JVBERg==", resource.GetProperty("blob").GetString());
        Assert.All(handler.Methods, method => Assert.Equal(HttpMethod.Get, method));

        var compatibility = JsonSerializer.SerializeToElement(await Tools(handler).Call(
            Parameters("study_source", new { material_id = "material-1", revision = "revision-1", block_id = "original" }), default), Options);
        var compatibilityResource = compatibility.GetProperty("content").EnumerateArray().Single(item => item.GetProperty("type").GetString() == "resource")
            .GetProperty("resource");
        Assert.Equal("JVBERg==", compatibilityResource.GetProperty("blob").GetString());
    }

    [Fact]
    public async Task EveryToolUsesOnlyReadRequestsAgainstStudySpace()
    {
        var handler = new FixtureHandler();
        var tools = Tools(handler);
        var calls = new[]
        {
            Parameters("study_status", new { }),
            Parameters("study_courses", new { }),
            Parameters("study_course", new { course_id = 7 }),
            Parameters("study_learning", new { course_id = 7 }),
            Parameters("study_materials", new { course_id = 7 }),
            Parameters("study_source", new { material_id = "material-1", revision = "revision-1", block_id = "block-1" }),
            Parameters("study_file", new { material_id = "material-1", revision = "revision-1" }),
            Parameters("study_search", new { course_id = 7, query = "matrix" }),
        };

        foreach (var call in calls)
        {
            var result = JsonSerializer.SerializeToElement(await tools.Call(call, default), Options);
            Assert.False(result.TryGetProperty("isError", out _));
        }
        Assert.NotEmpty(handler.Methods);
        Assert.All(handler.Methods, method => Assert.Equal(HttpMethod.Get, method));
    }

    private static StudyMcpTools Tools(HttpMessageHandler handler) => new(new HttpClient(handler)
    {
        BaseAddress = new Uri("http://app:8080"),
    });

    private static JsonElement Parameters(string name, object arguments) => JsonSerializer.SerializeToElement(new { name, arguments }, Options);
    private static JsonElement Structured(object value) => JsonSerializer.SerializeToElement(value, Options).GetProperty("structuredContent");
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    private sealed class FixtureHandler : HttpMessageHandler
    {
        public List<HttpMethod> Methods { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Methods.Add(request.Method);
            if (request.Method != HttpMethod.Get) throw new InvalidOperationException("MCP must not mutate Study Space.");
            var path = request.RequestUri!.AbsolutePath;
            if (path == "/api/materials/material-1/revisions/revision-1/assets/original")
            {
                var content = new ByteArrayContent([0x25, 0x50, 0x44, 0x46]);
                content.Headers.TryAddWithoutValidation("Content-Type", "application/pdf");
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
            }
            object body = path switch
            {
                "/health/ready" => new { status = "ready" },
                "/api/status" => new { app = "study-space", database = "ready" },
                "/api/providers/moodle" => new { status = "connected" },
                "/api/providers/moodle/courses" => new Course[] { new(7, "Biology", "BIO", "Course summary") },
                "/api/providers/moodle/courses/7/contents" => new CourseSection[]
                {
                    new(11, "Week 1", "Introduction", [new(12, "Exercise sheet", "resource", null, "Solve matrix tasks", [])]),
                },
                "/api/learning/courses/7" => LearningState(),
                "/api/materials/courses/7" => Snapshot(),
                "/api/materials/material-1/revisions/revision-1" => Document(),
                _ => throw new InvalidOperationException($"Unexpected fixture request: {path}"),
            };
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = JsonContent.Create(body, options: Options) });
        }

        private static LearningState LearningState()
        {
            var source = new SourceRef("material-1", "revision-1", "block-1", 1);
            var version = new LearningVersion("version-1", DateTimeOffset.UnixEpoch, "snapshot-1", "Biology", false, [],
                [new("section-1", "Matrices", "A matrix has rows and columns.", [source])],
                [new("exercise-1", "Matrix exercise", "Compute the matrix result.", "Use row operations.", "42", "source", [source])],
                [new("material-1", "revision-1", "Sheet.pdf")]);
            return new(7, version.Id, [new(version.Id, version.CreatedAt, version.SnapshotId, version.Title, false, 1, 1)],
                version, null, new Dictionary<string, string> { ["exercise-1"] = "my draft" }, "section-1", []);
        }

        private static MaterialSnapshot Snapshot() => new(7, "snapshot-1", "ready", new(1, 1, 0, 0, 0, true),
            [new("material-1", "revision-1", "Sheet.pdf", "file", "application/pdf", 11, "Week 1", 12, "ready", null, null, null, [])],
            null, DateTimeOffset.UnixEpoch);

        private static MaterialDocument Document() => new("material-1", "revision-1", "Sheet.pdf", "application/pdf",
            [new("block-1", "text", "Matrix multiplication and row operations.", 0, 1, null, null)],
            [new("original", "original", "application/pdf", "Sheet.pdf", "/api/materials/material-1/revisions/revision-1/assets/original", "hash", 4)],
            [new("pdftotext", "fixture", 1, "hash")], [], true);
    }
}
