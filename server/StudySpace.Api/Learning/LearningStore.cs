using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Learning;

public sealed class LearningStore(IConfiguration configuration)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly string root = Path.Combine(RuntimeConfiguration.DataDirectory(configuration), "learning");
    private readonly ConcurrentDictionary<long, SemaphoreSlim> locks = new();

    public async Task<T> WithCourse<T>(long courseId, Func<LearningManifest, Task<T>> action, CancellationToken ct = default)
    {
        CheckCourse(courseId);
        var gate = locks.GetOrAdd(courseId, _ => new(1, 1));
        await gate.WaitAsync(ct);
        try { return await action(await Load(courseId, ct)); }
        finally { gate.Release(); }
    }

    public Task Save(LearningManifest manifest, CancellationToken ct = default) =>
        Atomic(Path.Combine(CoursePath(manifest.CourseId), "state.json"), manifest, ct);

    public async Task<LearningVersion> Version(long courseId, string id, CancellationToken ct = default)
    {
        CheckId(id);
        return await Read<LearningVersion>(Path.Combine(CoursePath(courseId), "versions", id + ".json"), ct)
            ?? throw new ApiFailure("learning_version_missing", "This learning version is not available.", 404);
    }

    public Task WriteVersion(long courseId, LearningVersion version, CancellationToken ct) =>
        Atomic(Path.Combine(CoursePath(courseId), "versions", version.Id + ".json"), version, ct);

    public Task WriteChunk(long courseId, string jobId, string chunkId, ChunkResult value, CancellationToken ct) =>
        Atomic(ChunkPath(courseId, jobId, chunkId), value, ct);

    public Task<ChunkResult?> ReadChunk(long courseId, string jobId, string chunkId, CancellationToken ct) =>
        Read<ChunkResult>(ChunkPath(courseId, jobId, chunkId), ct);

    public IEnumerable<long> Courses() => Directory.Exists(root)
        ? Directory.EnumerateDirectories(root).Select(Path.GetFileName).Where(name => long.TryParse(name, out var id) && id > 0).Select(name => long.Parse(name!))
        : [];

    private async Task<LearningManifest> Load(long id, CancellationToken ct) =>
        await Read<LearningManifest>(Path.Combine(CoursePath(id), "state.json"), ct) ?? new() { CourseId = id };

    private string CoursePath(long id) { CheckCourse(id); return Path.Combine(root, id.ToString(System.Globalization.CultureInfo.InvariantCulture)); }
    private string ChunkPath(long courseId, string jobId, string chunkId)
    {
        CheckId(jobId); CheckId(chunkId);
        return Path.Combine(CoursePath(courseId), "jobs", jobId, chunkId + ".json");
    }
    private static void CheckCourse(long id)
    { if (id <= 0) throw new ApiFailure("course_invalid", "Choose a valid course.", 400); }
    public static void CheckId(string id)
    { if (!Regex.IsMatch(id ?? "", "^[a-f0-9]{32,64}$")) throw new ApiFailure("learning_id_invalid", "This learning reference is invalid.", 400); }

    private static async Task<T?> Read<T>(string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return default;
        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<T>(stream, Json, ct)
                ?? throw new JsonException();
        }
        catch (JsonException)
        { throw new ApiFailure("learning_state_unreadable", "Saved learning data could not be read. It has been preserved; do not start over or delete it.", 500); }
    }
    private static async Task Atomic<T>(string path, T value, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 8192, FileOptions.Asynchronous))
            {
                if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                await JsonSerializer.SerializeAsync(stream, value, Json, ct);
                await stream.FlushAsync(ct);
                stream.Flush(flushToDisk: true);
            }
            ct.ThrowIfCancellationRequested();
            File.Move(temporary, path, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
