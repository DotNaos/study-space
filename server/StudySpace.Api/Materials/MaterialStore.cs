using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

public sealed class MaterialStore
{
    private readonly string root;
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public MaterialStore(IConfiguration config)
    {
        root = Path.Combine(RuntimeConfiguration.DataDirectory(config), "materials");
        PrivateFiles.Directory(root);
    }
    internal string TemporaryDirectory()
    {
        var path = Path.Combine(root, "work", Guid.NewGuid().ToString("N"));
        PrivateFiles.Directory(path); return path;
    }
    internal IEnumerable<long> Courses() => Directory.Exists(Path.Combine(root, "courses"))
        ? Directory.EnumerateFiles(Path.Combine(root, "courses"), "*.json").Select(Path.GetFileNameWithoutExtension)
            .Select(value => long.TryParse(value, out var courseId) ? courseId : 0).Where(courseId => courseId > 0).ToArray() : [];
    internal Task<MaterialCourseState?> Read(long courseId, CancellationToken ct) => ReadJson<MaterialCourseState>(CoursePath(courseId), ct);
    internal Task Write(MaterialCourseState state) => PrivateFiles.WriteAsync(CoursePath(state.CourseId), JsonSerializer.SerializeToUtf8Bytes(state, Json));
    internal async Task WriteSnapshot(MaterialSnapshot snapshot)
    {
        if (snapshot.SnapshotId is null) return;
        var path = Path.Combine(root, "snapshots", Key(snapshot.SnapshotId) + ".json");
        if (!File.Exists(path)) await PrivateFiles.WriteAsync(path, JsonSerializer.SerializeToUtf8Bytes(snapshot, Json));
    }
    internal async Task<MaterialDocument?> Document(string materialId, string revision, CancellationToken ct) =>
        await ReadJson<MaterialDocument>(DocumentPath(materialId, revision), ct);
    internal async Task SaveDocument(MaterialDocument document)
    {
        var path = DocumentPath(document.MaterialId, document.Revision);
        if (!File.Exists(path)) await PrivateFiles.WriteAsync(path, JsonSerializer.SerializeToUtf8Bytes(document, Json));
    }
    internal async Task<string> PutBlob(byte[] bytes)
    {
        var hash = Hash(bytes); var path = BlobPath(hash);
        if (!File.Exists(path)) await PrivateFiles.WriteAsync(path, bytes);
        return hash;
    }
    internal async Task<byte[]> Blob(string hash, CancellationToken ct)
    {
        var path = BlobPath(hash);
        if (!File.Exists(path)) throw Missing();
        var info = new FileInfo(path);
        if (info.Length > MaterialFormat.MaximumBytes) throw new ApiFailure("material_asset_too_large", "This stored asset exceeds the supported size.", 413);
        var bytes = await File.ReadAllBytesAsync(path, ct);
        if (Hash(bytes) != hash) throw new ApiFailure("material_asset_damaged", "This source copy failed its integrity check. Reimport the material.", 409);
        return bytes;
    }
    private string CoursePath(long courseId) => courseId > 0 ? Path.Combine(root, "courses", courseId + ".json") : throw Missing();
    private string DocumentPath(string materialId, string revision) => Path.Combine(root, "documents", Key(materialId), Key(revision) + ".json");
    private string BlobPath(string hash) => Path.Combine(root, "blobs", Key(hash)[..2], hash);
    private static string Key(string value) => Regex.IsMatch(value, "^[a-f0-9]{64}$") ? value : throw Missing();
    private static async Task<T?> ReadJson<T>(string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return default;
        if (new FileInfo(path).Length > 32 * 1024 * 1024) throw new ApiFailure("material_state_damaged", "Stored material state is too large to read safely.", 409);
        try { return JsonSerializer.Deserialize<T>(await File.ReadAllBytesAsync(path, ct), Json); }
        catch (JsonException) { throw new ApiFailure("material_state_damaged", "Stored material state could not be read. Existing source copies are preserved.", 409); }
    }
    public static string Hash(string text) => Hash(Encoding.UTF8.GetBytes(text));
    public static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    public static ApiFailure Missing() => new("material_not_found", "This imported material or source revision is not available.", 404);
}

internal sealed class MaterialCourseState
{
    public long CourseId { get; set; }
    public string? SnapshotId { get; set; }
    public string Status { get; set; } = "not-imported";
    public DateTimeOffset? UpdatedAt { get; set; }
    public MaterialJob? Job { get; set; }
    public bool InventoryReady { get; set; }
    public List<MaterialItemState> Items { get; set; } = [];
}
internal sealed class MaterialItemState
{
    public required MaterialSource Source { get; set; }
    public string? Revision { get; set; }
    public string Status { get; set; } = "pending";
    public string? Reason { get; set; }
    public string[] Warnings { get; set; } = [];
    public int Attempts { get; set; }
    public string? CandidateRevision { get; set; }
    public bool Complete { get; set; }
}
