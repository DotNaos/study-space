using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using StudySpace.Api.Infrastructure;

namespace StudySpace.Api.Providers.Moodle;

public sealed record CourseArtworkInfo(string MimeType, string Sha256, int ByteLength);

// Local artwork is isolated by Moodle site/account; no upstream files are changed.
public sealed class CourseArtworkStore(IConfiguration config) : IDisposable
{
    private readonly string root = Path.Combine(RuntimeConfiguration.DataDirectory(config), "course-artwork");
    private readonly SemaphoreSlim gate = new(1, 1);

    public static string Version(MoodleCredential credential, string source) => Hash(Encoding.UTF8.GetBytes(
        $"{credential.SiteUrl}\n{credential.UserId}\n{credential.LastVerifiedAt:O}\n{source}"));

    public async Task<CourseArtworkInfo?> Info(MoodleCredential credential, long courseId, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try { return await ReadInfo(DirectoryFor(credential, courseId), ct); }
        finally { gate.Release(); }
    }

    public async Task<MoodleImage?> Get(MoodleCredential credential, long courseId, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var directory = DirectoryFor(credential, courseId);
            var info = await ReadInfo(directory, ct);
            if (info is null) return null;
            var path = Path.Combine(directory, info.Sha256 + ".image");
            if (!File.Exists(path) || new FileInfo(path).Length != info.ByteLength) throw Damaged();
            var bytes = await File.ReadAllBytesAsync(path, ct);
            if (Hash(bytes) != info.Sha256) throw Damaged();
            return new(bytes, info.MimeType, Version(credential, $"{courseId}:custom:{info.Sha256}"));
        }
        finally { gate.Release(); }
    }

    public async Task Set(MoodleCredential credential, long courseId, byte[] bytes, string mimeType, CancellationToken ct)
    {
        if (!MoodleCourseImages.AllowedMime(mimeType) || !MoodleImageTransport.MatchesSignature(bytes, mimeType))
            throw new ApiFailure("artwork_format", "Choose a PNG, JPEG or WebP image.", 415);
        if (bytes.Length > MoodleCourseImages.MaximumBytes)
            throw new ApiFailure("artwork_size", "Choose an image no larger than 4 MiB.", 413);
        var info = new CourseArtworkInfo(mimeType, Hash(bytes), bytes.Length);
        await gate.WaitAsync(ct);
        try
        {
            var directory = DirectoryFor(credential, courseId);
            var previous = await ReadInfo(directory, ct);
            await PrivateFiles.WriteAsync(Path.Combine(directory, info.Sha256 + ".image"), bytes);
            await PrivateFiles.WriteAsync(Path.Combine(directory, "current.json"), JsonSerializer.SerializeToUtf8Bytes(info));
            if (previous is not null && previous.Sha256 != info.Sha256)
                File.Delete(Path.Combine(directory, previous.Sha256 + ".image"));
        }
        finally { gate.Release(); }
    }

    public async Task Reset(MoodleCredential credential, long courseId, CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            var directory = DirectoryFor(credential, courseId);
            if (!Directory.Exists(directory)) return;
            var previous = await ReadInfo(directory, ct);
            File.Delete(Path.Combine(directory, "current.json"));
            if (previous is not null) File.Delete(Path.Combine(directory, previous.Sha256 + ".image"));
        }
        finally { gate.Release(); }
    }

    private string DirectoryFor(MoodleCredential credential, long courseId)
    {
        if (courseId <= 0) throw new ApiFailure("course_unavailable", "Course not found.", 404);
        var account = Hash(Encoding.UTF8.GetBytes($"{credential.SiteUrl}\n{credential.UserId}"));
        return Path.Combine(root, account, courseId.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    private static async Task<CourseArtworkInfo?> ReadInfo(string directory, CancellationToken ct)
    {
        var path = Path.Combine(directory, "current.json");
        if (!File.Exists(path)) return null;
        if (new FileInfo(path).Length > 1024) throw Damaged();
        var info = JsonSerializer.Deserialize<CourseArtworkInfo>(await File.ReadAllBytesAsync(path, ct));
        if (info is null || info.Sha256.Length != 64 || !info.Sha256.All(char.IsAsciiHexDigit) ||
            !MoodleCourseImages.AllowedMime(info.MimeType) || info.ByteLength <= 0 || info.ByteLength > MoodleCourseImages.MaximumBytes) throw Damaged();
        return info;
    }

    private static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    private static ApiFailure Damaged() => new("artwork_damaged", "The saved course image is damaged. Replace or reset it.", 422);
    public void Dispose() => gate.Dispose();
}
