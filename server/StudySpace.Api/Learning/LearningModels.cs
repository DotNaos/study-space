using StudySpace.Api.Pipeline;
using System.Text.Json;
namespace StudySpace.Api.Learning;

public sealed record SourceRef(string MaterialId, string Revision, string BlockId, int? Page);
public sealed record LearningSource(string MaterialId, string Revision, string Name);
public sealed record LearningSection(string Id, string Title, string Markdown, SourceRef[] Sources, ScriptProvenance? Provenance = null, string Format = "markdown", string? UnitId = null);
public sealed record LearningExercise(string Id, string Title, string Prompt, string Hint, string Solution, string Origin, SourceRef[] Sources, string SolutionOrigin = "unknown", SourceRef[]? SolutionSources = null, string Derivation = "legacy", string[]? UnitIds = null);
public sealed record LearningVersion(string Id, DateTimeOffset CreatedAt, string SnapshotId, string Title, bool Partial,
    string[] Warnings, LearningSection[] Sections, LearningExercise[] Exercises, LearningSource[] Sources,
    string? ParentVersionId = null, LearningEdit? Edit = null, long? PlanRevision = null, PipelineUnit[]? Units = null, SourceDecision[]? UseDecisions = null, LearningSolution[]? PendingSolutions = null, Dictionary<string, string>? TaskAliases = null, TaskReviewDecision? TaskReview = null, SourceRef[]? UnmappedSourceRefs = null);
public sealed record LearningVersionSummary(string Id, DateTimeOffset CreatedAt, string SnapshotId, string Title, bool Partial,
    int SectionCount, int ExerciseCount);
public sealed record LearningJob(string Id, string Status, string Stage, int CompletedSteps, int TotalSteps,
    string? Error, string? CandidateVersionId);
public sealed record ChatMessage(string Id, string Role, string Content, string Status);
public sealed record LearningState(long CourseId, string? ActiveVersionId, LearningVersionSummary[] Versions,
    LearningVersion? ActiveVersion, LearningJob? Job, Dictionary<string, string> Drafts, string? ReadingSectionId, ChatMessage[] Messages);
public sealed record GenerateRequest(string SnapshotId, bool AllowPartial, bool ConsentToCodex, long? PlanRevision = null, bool ExtraExercises = false);
public sealed record CancelLearningRequest(string JobId);
public sealed record ActivateVersionRequest(string VersionId, string? ExpectedActiveVersionId = null, bool CheckRevision = false);
public sealed record DraftRequest(string Answer);
public sealed record ReadingPositionRequest(string SectionId);
public sealed record LearningChatRequest(string VersionId, string Message, bool ConsentToCodex);

// Saved inputs are immutable and credential-free. They are pinned at the user's
// generation action so a later import never changes an already approved job.
public sealed record LearningInput(string MaterialId, string Revision, string Name, string SectionName,
    string? UnitId = null, string[]? Roles = null, int? FirstPage = null, int? LastPage = null, string? RelatedSourceId = null);
public sealed class LearningManifest
{
    [System.Text.Json.Serialization.JsonExtensionData]
    public Dictionary<string, JsonElement>? ExtensionData { get; set; }
    public long CourseId { get; set; }
    public PipelinePlan Pipeline { get; set; } = new();
    public long? InputPlanRevision { get; set; }
    public PipelineUnit[] InputUnits { get; set; } = [];
    public SourceDecision[] InputDecisions { get; set; } = [];
    public LearningEdit[] Edits { get; set; } = [];
    public AnswerAttempt[] Attempts { get; set; } = [];
    public AttemptFeedback[] Feedback { get; set; } = [];
    public TaskReviewDecision[] TaskReviews { get; set; } = [];
    public bool AllowExtraExercises { get; set; }
    public string? ActiveVersionId { get; set; }
    public List<LearningVersionSummary> Versions { get; set; } = [];
    public LearningJob? Job { get; set; }
    public Dictionary<string, string> Drafts { get; set; } = [];
    public string? ReadingSectionId { get; set; }
    public List<ChatMessage> Messages { get; set; } = [];
    public string? SnapshotId { get; set; }
    public bool Partial { get; set; }
    public string[] Warnings { get; set; } = [];
    public LearningInput[] Inputs { get; set; } = [];
    public List<string> CompletedChunks { get; set; } = [];
    public string? ChunkJobId { get; set; }
}

public interface ILearningModel
{
    Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct, IReadOnlyList<LearningImage>? images = null);
    IAsyncEnumerable<LearningModelDelta> Chat(string prompt, CancellationToken ct);
}
public sealed record LearningModelDelta(string Text, bool IsFinal = false);

public sealed record LearningImage(string MimeType, string Base64);
