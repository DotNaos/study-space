using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Learning;

namespace StudySpace.Api.Content;

public sealed class ContentStore(IConfiguration configuration)
{
    private readonly string root = Path.Combine(RuntimeConfiguration.DataDirectory(configuration), "content");
    private readonly ConcurrentDictionary<long, SemaphoreSlim> locks = new();

    public async Task<T> WithCourse<T>(long courseId, Func<ContentCourseState, Task<T>> action, CancellationToken ct = default)
    {
        CheckCourse(courseId);
        var gate = locks.GetOrAdd(courseId, _ => new(1, 1));
        await gate.WaitAsync(ct);
        try { return await action(await Load(courseId, ct)); }
        finally { gate.Release(); }
    }

    public Task Save(ContentCourseState state, CancellationToken ct = default) =>
        Atomic(Path.Combine(CoursePath(state.CourseId), "state.json"), state, ct);

    public async Task<ContentRevision?> Revision(long courseId, string blockId, string revisionId, CancellationToken ct = default)
    {
        CheckId(blockId, 64);
        CheckId(revisionId, 32);
        return await Read<ContentRevision>(RevisionPath(courseId, blockId, revisionId), ct);
    }

    public Task WriteRevision(long courseId, string blockId, ContentRevision revision, CancellationToken ct = default)
    {
        CheckId(blockId, 64);
        CheckId(revision.Id, 32);
        return Atomic(RevisionPath(courseId, blockId, revision.Id), revision, ct);
    }

    private async Task<ContentCourseState> Load(long courseId, CancellationToken ct) =>
        await Read<ContentCourseState>(Path.Combine(CoursePath(courseId), "state.json"), ct) ?? new() { CourseId = courseId };

    private string CoursePath(long courseId)
    {
        CheckCourse(courseId);
        return Path.Combine(root, courseId.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private string RevisionPath(long courseId, string blockId, string revisionId) =>
        Path.Combine(CoursePath(courseId), "blocks", blockId, "revisions", revisionId + ".json");

    private static void CheckCourse(long courseId)
    {
        if (courseId <= 0) throw new ApiFailure("content_course_invalid", "Choose a valid course.", 400);
    }

    private static void CheckId(string id, int length)
    {
        if (id is null || id.Length != length || !Regex.IsMatch(id, "^[a-f0-9]+$"))
            throw new ApiFailure("content_id_invalid", "This content reference is invalid.", 400);
    }

    private static async Task<T?> Read<T>(string path, CancellationToken ct)
    {
        if (!File.Exists(path)) return default;
        try
        {
            await using var stream = File.OpenRead(path);
            return await JsonSerializer.DeserializeAsync<T>(stream, LearningStore.Json, ct) ?? throw new JsonException();
        }
        catch (JsonException)
        {
            throw new ApiFailure("content_state_unreadable", "Saved authored content could not be read. It has been preserved.", 500);
        }
    }

    private static async Task Atomic<T>(string path, T value, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            await using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 8192, FileOptions.Asynchronous))
            {
                if (!OperatingSystem.IsWindows())
                    File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
                await JsonSerializer.SerializeAsync(stream, value, LearningStore.Json, ct);
                await stream.FlushAsync(ct);
                stream.Flush(flushToDisk: true);
            }
            ct.ThrowIfCancellationRequested();
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }
}
