namespace StudySpace.Api.Materials;

public sealed record MaterialSnapshot(long CourseId, string? SnapshotId, string Status, MaterialCoverage Coverage,
    MaterialEntry[] Materials, MaterialJob? Job, DateTimeOffset? UpdatedAt);
public sealed record MaterialCoverage(int Total, int Ready, int Failed, int Unsupported, int Pending, bool Complete);
public sealed record MaterialEntry(string Id, string? Revision, string Name, string Kind, string? MimeType,
    long SectionId, string SectionName, long? ModuleId, string Status, string? Reason,
    string? DocumentUrl, string? OriginalUrl, string[] Warnings)
{
    [System.Text.Json.Serialization.JsonPropertyName("study_url")]
    public string? StudyUrl { get; init; }
}
public sealed record MaterialJob(string Id, string Status, int Completed, int Total, DateTimeOffset CreatedAt,
    DateTimeOffset? FinishedAt, string? Error);

public sealed record MaterialDocument(string MaterialId, string Revision, string Name, string MimeType,
    MaterialBlock[] Blocks, MaterialAsset[] Assets, MaterialProvenance[] Provenance, string[] Warnings, bool Complete);
public sealed record MaterialBlock(string Id, string Kind, string Text, int Order, int? Page, int? Slide,
    string? AssetId, MaterialBounds? Bounds = null, string[][]? Cells = null);
public sealed record MaterialBounds(double X, double Y, double Width, double Height);
public sealed record MaterialAsset(string Id, string Kind, string MimeType, string Name, string Url,
    string Sha256, long ByteLength, int? Page = null, int? Slide = null);
public sealed record MaterialProvenance(string Engine, string Version, long DurationMs, string ResultHash);
public sealed record MaterialAssetContent(byte[] Bytes, string MimeType, string Name);

public interface IMaterialCatalog
{
    Task<MaterialSnapshot> GetSnapshot(long courseId, CancellationToken ct = default);
    Task<MaterialSnapshot> StartImport(long courseId, CancellationToken ct = default);
    Task<MaterialSnapshot> Cancel(long courseId, string jobId, CancellationToken ct = default);
    Task<MaterialDocument> GetDocument(string materialId, string revision, CancellationToken ct = default);
    Task<MaterialAssetContent> GetAsset(string materialId, string revision, string assetId, CancellationToken ct = default);
}
