using StudySpace.Api.Materials;

namespace StudySpace.Api.Content;

public sealed record ContentPlacement(
    string UnitId,
    string Role,
    int UnitOrder,
    int Order,
    int? FirstPage = null,
    int? LastPage = null,
    string? RelatedSourceId = null);

public sealed record ContentProvenance(
    string SourceBlockId,
    int? Page,
    int? Slide,
    MaterialBounds? Bounds,
    int Start,
    int Length);

public sealed record ContentRevision(
    string Id,
    string? ParentRevisionId,
    DateTimeOffset CreatedAt,
    string Actor,
    string Reason,
    string Kind,
    string SourceVersion,
    string? MaterialRevision,
    string Content,
    ContentProvenance[] Provenance,
    string ProvenanceStatus = "current");

public sealed class ContentBlockState
{
    public string Id { get; set; } = "";
    public string SourceId { get; set; } = "";
    public string Name { get; set; } = "";
    public string? MimeType { get; set; }
    public string ObservedSourceVersion { get; set; } = "";
    public string? ObservedMaterialRevision { get; set; }
    public string? BaselineSourceVersion { get; set; }
    public string? BaselineMaterialRevision { get; set; }
    public string? CurrentRevisionId { get; set; }
    public bool Included { get; set; }
    public ContentPlacement[] Placements { get; set; } = [];
}

public sealed class ContentCourseState
{
    public long CourseId { get; set; }
    public long PipelineRevision { get; set; }
    public List<ContentBlockState> Blocks { get; set; } = [];
}

public sealed record ContentBlockSummary(
    string Id,
    string SourceId,
    string Name,
    string? MimeType,
    string ObservedSourceVersion,
    string? ObservedMaterialRevision,
    string? BaselineSourceVersion,
    string? BaselineMaterialRevision,
    string? CurrentRevisionId,
    bool Included,
    bool Stale,
    string Status,
    ContentPlacement[] Placements);

public sealed record ContentWorkspace(
    long CourseId,
    long PipelineRevision,
    ContentBlockSummary[] Blocks);

public sealed record ContentBlockView(
    ContentBlockSummary Block,
    ContentRevision? Revision);

public sealed record ContentMaterializeRequest(
    long ExpectedPipelineRevision,
    string Reason,
    string Actor = "user");

public sealed record ContentEditRequest(
    string ExpectedRevisionId,
    string Content,
    string Reason,
    string Actor = "user");

public sealed record ContentResetRequest(
    string ExpectedRevisionId,
    string Reason,
    string Actor = "user");

public sealed record ContentUndoRequest(
    string ExpectedRevisionId,
    string Reason,
    string Actor = "user");

public sealed record ContentAgentRequest(
    string ExpectedRevisionId,
    string Instruction,
    bool ConsentToCodex,
    string? SelectionText = null,
    int? Page = null,
    string[]? SourceBlockIds = null);

public sealed record ContentAgentResult(
    ContentBlockView View,
    string Summary);
