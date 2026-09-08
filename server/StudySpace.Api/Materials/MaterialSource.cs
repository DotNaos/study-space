namespace StudySpace.Api.Materials;

public sealed record MaterialSource(string Id, string ProviderScope, long CourseId, long SectionId, string SectionName,
    long? ModuleId, string Name, string Kind, string? MimeType, string? ResourceId, string? InlineText, string? UnavailableReason);
public sealed record MaterialInventory(string ProviderScope, MaterialSource[] Sources);
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
