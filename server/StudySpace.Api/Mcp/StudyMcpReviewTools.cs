using System.Net.Http.Json;
using System.Text.Json;
using StudySpace.Api.Learning;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Mcp;

public sealed partial class StudyMcpTools
{
    public object[] Definitions => ToolDefinitions.Concat(ReviewReadTools)
        .Concat(allowFeedbackWrites ? [FeedbackTool] : Array.Empty<object>())
        .Concat(allowPipelineWrites ? [PipelineDecisionTool, PipelineStructureTool] : Array.Empty<object>()).ToArray();
    private static readonly object[] ReviewReadTools = [
        Tool("study_pipeline", "Read observed Moodle sources, reviewed learning units, pending/stale decisions and revision tokens. No import, model job or write is started. Use source_id for full bounded source evidence.", new {
            type = "object", additionalProperties = false, required = new[] { "course_id" },
            properties = new { course_id = Integer(1, long.MaxValue), source_id = String(64, 64), offset = Integer(0, 10000), max_items = Integer(1, 50) }
        }),
        Tool("study_attempts", "Read submitted Study Space answer attempts and their feedback. Returns a bounded index by default; use attempt_id to read the exact answer, task/version and answer hash before writing feedback. Drafts are not exposed unless include_drafts is true.", new {
            type = "object", additionalProperties = false, required = new[] { "course_id" },
            properties = new { course_id = Integer(1, long.MaxValue), attempt_id = String(32, 32), include_drafts = new { type = "boolean" }, offset = Integer(0, 10000), max_items = Integer(1, 50) }
        })
    ];
    private static object WritableTool(string name, string description, object inputSchema) => new {
        name, description, inputSchema, annotations = new { readOnlyHint = false, destructiveHint = false, idempotentHint = false, openWorldHint = false }
    };
    private static readonly object FeedbackTool = WritableTool("study_feedback", "Append learning feedback to one exact submitted attempt only. Requires explicit deployment opt-in. Does not change answers, tasks, script, Moodle submissions or grades. Read study_attempts first and use its exact attempt revision and answer hash.", Schema("""
        {"type":"object","additionalProperties":false,"required":["course_id","attempt_id","attempt_revision","answer_hash","reviewer","outcome","comment"],"properties":{"course_id":{"type":"integer","minimum":1},"attempt_id":{"type":"string","pattern":"^[a-f0-9]{32}$"},"attempt_revision":{"type":"integer","minimum":1},"answer_hash":{"type":"string","pattern":"^[a-f0-9]{64}$"},"reviewer":{"type":"string","minLength":1,"maxLength":100},"outcome":{"type":"string","enum":["correct","partly-correct","needs-work","uncertain"]},"comment":{"type":"string","minLength":1,"maxLength":12000}}}
        """));
    private static readonly object PipelineDecisionTool = WritableTool("study_pipeline_decide", "Confirm a source-use/exclusion decision after reviewing the original and evidence. Explicit deployment opt-in required. Use expected_revision and source_version from study_pipeline. Never confirm uncertain evidence silently. Does not import, generate or activate content.", Schema("""
        {"type":"object","additionalProperties":false,"required":["course_id","expected_revision","source_id","source_version","disposition","uses","reason","actor"],"properties":{"course_id":{"type":"integer","minimum":1},"expected_revision":{"type":"integer","minimum":0},"source_id":{"type":"string","pattern":"^[a-f0-9]{64}$"},"source_version":{"type":"string","pattern":"^[a-f0-9]{64}$"},"disposition":{"type":"string","enum":["use","exclude"]},"reason":{"type":"string","minLength":1,"maxLength":4000},"actor":{"type":"string","minLength":1,"maxLength":100},"uses":{"type":"array","maxItems":64,"items":{"type":"object","additionalProperties":false,"required":["unitId","role"],"properties":{"unitId":{"type":"string"},"role":{"type":"string","enum":["teaching","task","solution","support","reference"]},"firstPage":{"type":["integer","null"]},"lastPage":{"type":["integer","null"]},"relatedSourceId":{"type":["string","null"]},"order":{"type":["integer","null"],"minimum":0,"maximum":1000000}}}}}}
        """));
    private static readonly object PipelineStructureTool = WritableTool("study_pipeline_structure", "Save the reviewed ordered learning-unit structure with a reason and optimistic revision check. Does not change Moodle. Explicit deployment opt-in required. Referenced units cannot be deleted before their source uses are moved.", Schema("""
        {"type":"object","additionalProperties":false,"required":["course_id","expected_revision","units","reason","actor"],"properties":{"course_id":{"type":"integer","minimum":1},"expected_revision":{"type":"integer","minimum":0},"reason":{"type":"string","minLength":1,"maxLength":4000},"actor":{"type":"string","minLength":1,"maxLength":100},"units":{"type":"array","maxItems":250,"items":{"type":"object","additionalProperties":false,"required":["id","title","parentId","order"],"properties":{"id":{"type":"string","pattern":"^[a-f0-9]{32}$"},"title":{"type":"string","minLength":1,"maxLength":250},"parentId":{"type":["string","null"]},"order":{"type":"integer","minimum":0}}}}}}
        """));
    private static JsonElement Schema(string json) { using var document = JsonDocument.Parse(json); return document.RootElement.Clone(); }

    private async Task<object> PipelineRead(JsonElement args, CancellationToken ct)
    {
        var course = Long(args, "course_id", 1, long.MaxValue);
        var state = await Get<PipelineView>($"/api/pipeline/courses/{course}", ct);
        var id = OptionalString(args, "source_id", 64);
        var sources = id is null ? state.Sources : state.Sources.Where(item => item.Source.Id == id).ToArray();
        if (id is not null && sources.Length == 0) throw new StudyMcpException("Source is not available in this course.");
        var offset = Int(args, "offset", 0, 0, 10000); var count = Int(args, "max_items", 20, 1, 50);
        return new { state.CourseId, state.Revision, state.ObservedHash, state.Problem, state.Groups, state.Units, state.SuggestedUnits, state.Pending, state.Blocked,
            total = sources.Length, offset, sources = sources.Skip(offset).Take(count).Select(item => new {
                source = item.Source with { Text = Clip(item.Source.Text, id is null ? 500 : 30000) },
                textTruncated = item.Source.Text.Length > (id is null ? 500 : 30000), item.Status, item.Decision, item.SectionIds, item.ExerciseIds
            }).ToArray() };
    }
    private async Task<object> AttemptsRead(JsonElement args, CancellationToken ct)
    {
        var course = Long(args, "course_id", 1, long.MaxValue);
        var state = await Get<AttemptState>($"/api/learning/courses/{course}/attempts", ct);
        var id = OptionalString(args, "attempt_id", 32);
        var attempts = state.Attempts.Where(attempt => attempt.Status == "submitted" || Bool(args, "include_drafts", false));
        if (id is not null)
        {
            var attempt = attempts.SingleOrDefault(item => item.Id == id) ?? throw new StudyMcpException("Attempt is unavailable or draft access was not requested.");
            var version = await Get<LearningVersion>($"/api/learning/courses/{course}/versions/{attempt.VersionId}", ct);
            var task = version.Exercises.SingleOrDefault(task => task.Id == attempt.ExerciseId);
            return new { courseId = course, attempt, answerHash = LearningChunks.Hash(attempt.Answer),
                task = task is null ? null : new { task.Id, task.Title, task.Prompt, task.Sources },
                feedback = state.Feedback.Where(feedback => feedback.AttemptId == id).ToArray() };
        }
        var offset = Int(args, "offset", 0, 0, 10000); var count = Int(args, "max_items", 20, 1, 50);
        return new { courseId = course, total = attempts.Count(), offset,
            attempts = attempts.Skip(offset).Take(count).Select(attempt => new { attempt.Id, attempt.VersionId, attempt.ExerciseId, attempt.Revision, attempt.Status, attempt.SubmittedAt,
                feedbackCount = state.Feedback.Count(feedback => feedback.AttemptId == attempt.Id) }).ToArray() };
    }
    private async Task<object> FeedbackWrite(JsonElement args, CancellationToken ct)
    {
        if (!allowFeedbackWrites) throw new StudyMcpException("Feedback writes are disabled. Enable STUDY_MCP_ALLOW_FEEDBACK_WRITES explicitly.");
        var course = Long(args, "course_id", 1, long.MaxValue); var id = RequiredString(args, "attempt_id", 32);
        if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-f0-9]{32}$")) throw new StudyMcpException("Invalid attempt ID.");
        var body = new FeedbackRequest(Long(args, "attempt_revision", 1, long.MaxValue), RequiredString(args, "answer_hash", 64),
            RequiredString(args, "reviewer", 100), RequiredString(args, "outcome", 30), RequiredString(args, "comment", 12000), []);
        return await Post($"/api/learning/courses/{course}/attempts/{id}/feedback", HttpMethod.Post, body, ct);
    }
    private async Task<object> PipelineWrite(JsonElement args, bool structure, CancellationToken ct)
    {
        if (!allowPipelineWrites) throw new StudyMcpException("Pipeline writes are disabled. Enable STUDY_MCP_ALLOW_PIPELINE_WRITES explicitly.");
        var course = Long(args, "course_id", 1, long.MaxValue); var revision = Long(args, "expected_revision", 0, long.MaxValue);
        var reason = RequiredString(args, "reason", 4000); var actor = RequiredString(args, "actor", 100);
        if (structure)
        {
            var units = args.GetProperty("units").Deserialize<PipelineUnit[]>(JsonOptions) ?? throw new StudyMcpException("Units are required.");
            return await Post($"/api/pipeline/courses/{course}/structure", HttpMethod.Put, new PlanStructureRequest(revision, units, reason, actor), ct);
        }
        var uses = args.GetProperty("uses").Deserialize<SourceUse[]>(JsonOptions) ?? throw new StudyMcpException("Uses are required.");
        return await Post($"/api/pipeline/courses/{course}/decisions", HttpMethod.Post, new PlanDecisionRequest(revision,
            RequiredString(args, "source_id", 64), RequiredString(args, "source_version", 64), RequiredString(args, "disposition", 20), uses, reason, actor), ct);
    }
    private async Task<object> Post(string path, HttpMethod method, object value, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(value, options: JsonOptions) };
        using var response = await client.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) throw new StudyMcpException(await FailureMessage(response, ct));
        return await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions, ct);
    }
}
