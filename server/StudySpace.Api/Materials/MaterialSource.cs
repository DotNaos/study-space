using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Materials;

public sealed record MaterialSource(string Id, string ProviderScope, long CourseId, long SectionId, string SectionName,
    long? ModuleId, string Name, string Kind, string? MimeType, string? ResourceId, string? InlineText, string? UnavailableReason, long? ModifiedAt = null, long? Size = null, string? ActivityName = null, string? ActivityType = null)
{
    // Compares the captured acquisition metadata, not inferred teaching relevance.
    // This is not proof that remote bytes stayed unchanged when Moodle supplied no change signal.
    public string AcquisitionHash() => MaterialStore.Hash(System.Text.Json.JsonSerializer.Serialize(new {
        Id, Name, Kind, MimeType, ResourceId, InlineText, ModifiedAt, Size
    }));
}
public sealed record MaterialInventory(string ProviderScope, MaterialSource[] Sources, CourseSection[]? Sections = null);
public sealed record MaterialInput(byte[] Bytes, string MimeType, string Name);
public interface IMaterialSourceProvider
{
    Task<MaterialInventory> Inventory(long courseId, CancellationToken ct);
    Task<MaterialInput> Read(MaterialSource source, CancellationToken ct);
}
public sealed record MaterialExtraction(MaterialBlock[] Blocks, MaterialExtractedAsset[] Assets, MaterialProvenance[] Provenance,
    string[] Warnings, bool Complete);
public sealed record MaterialExtractedAsset(string Id, string Kind, string MimeType, string Name, byte[] Bytes, int? Page = null, int? Slide = null);
public interface IMaterialExtractor
{
    Task<MaterialExtraction> Extract(MaterialInput input, CancellationToken ct);
}
