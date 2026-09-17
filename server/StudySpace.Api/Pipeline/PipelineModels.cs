using StudySpace.Api.Learning;
namespace StudySpace.Api.Pipeline;

// Source observations, reviewed intent, and learning content have different lifecycles.
public sealed record PipelineUnit(string Id, string Title, string? ParentId, int Order,
    string? Kind = null, bool? Hidden = null, string? CustomTitle = null, long? SourceGroupId = null, string[]? ScriptUnitIds = null);
public sealed record SourceUse(string UnitId, string Role, int? FirstPage = null, int? LastPage = null,
    string? RelatedSourceId = null, int? Order = null);
public sealed record SourceDecision(string SourceId, string SourceVersion, string Disposition, SourceUse[] Uses,
    string Reason, string Actor, DateTimeOffset DecidedAt, Dictionary<string, string>? DependencyVersions = null);
public sealed record PipelineSource(string Id, long SectionId, long? ModuleId, string Name, string Kind, string? MimeType,
    string SourceVersion, string? MaterialRevision, string Acquisition, string? Problem, string[] Warnings,
    string Text, string? StudyUrl, bool Present, string SuggestedRole);
public sealed record PipelineGroup(long Id, string Title, int Order, long? ParentId = null);
public sealed record PipelineObservation(PipelineGroup[] Groups, PipelineSource[] Sources, string Hash, string? Problem);
public sealed record PipelineEvent(long Revision, string Action, string Actor, string Reason, DateTimeOffset At,
    string? SourceId = null, SourceDecision? Previous = null);
public sealed class PipelinePlan
{
    public long Revision { get; set; }
    public string ObservedHash { get; set; } = "";
    public PipelineGroup[] Groups { get; set; } = [];
    public PipelineSource[] Sources { get; set; } = [];
    public PipelineUnit[] Units { get; set; } = [];
    public SourceDecision[] Decisions { get; set; } = [];
    public PipelineEvent[] History { get; set; } = [];
    public DateTimeOffset? SyncedAt { get; set; }
}
public sealed record PipelineSourceView(PipelineSource Source, string Status, SourceDecision? Decision,
    string[] SectionIds, string[] ExerciseIds, int UnmappedBlocks = 0,
    string? DefaultPlacementId = null, string? CurrentPlacementId = null, bool Hidden = false);
public sealed record PipelineView(long CourseId, long Revision, string ObservedHash, bool Persisted, string? Problem,
    PipelineGroup[] Groups, PipelineSourceView[] Sources, PipelineUnit[] Units, PipelineUnit[] SuggestedUnits,
    PipelineEvent[] History, int Pending, int Blocked, string[] UnattributedSections);
public sealed record PlanSyncRequest(long ExpectedRevision);
public sealed record PlanStructureRequest(long ExpectedRevision, PipelineUnit[] Units, string Reason, string Actor = "user", string[]? DeletedUnitIds = null);
public sealed record PlanDecisionRequest(long ExpectedRevision, string SourceId, string SourceVersion,
    string Disposition, SourceUse[] Uses, string Reason, string Actor = "user");
public sealed record PlanMappingItem(string SourceId, string SourceVersion, string Disposition, SourceUse[] Uses);
public sealed record PlanMappingRequest(long ExpectedRevision, PlanMappingItem[] Items, string Actor = "user",
    string Reason = "Zuordnung in der Übersicht bestätigt.");
public sealed record PipelineRunSelection(long PlanRevision, LearningInput[] Inputs, string[] Warnings, bool Partial);
public interface IPipelineInventory
{
    Task<PipelineObservation> Read(long courseId, CancellationToken ct);
}
