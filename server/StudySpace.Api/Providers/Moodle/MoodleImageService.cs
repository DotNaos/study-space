using Microsoft.Extensions.Caching.Memory;
using StudySpace.Api.Infrastructure;

namespace StudySpace.Api.Providers.Moodle;

public sealed class MoodleImageService(MoodleService moodle, CredentialStore credentials, IMoodleImageTransport transport,
    CourseArtworkStore? artwork = null) : IDisposable
{
    // Four bounded lanes coalesce same-course reads without serialising the whole library.
    private readonly SemaphoreSlim[] downloads = Enumerable.Range(0, 4).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    private readonly MemoryCache cache = new(new MemoryCacheOptions { SizeLimit = 32 * 1024 * 1024 });

    public async Task<MoodleImage> Get(long courseId, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var credential = await Credential();
        // Even cache hits must still verify enrollment and the current account.
        var course = await moodle.ImageCourse(credential, courseId, timeout.Token);
        if (course.ImageUrl is null) throw new ApiFailure("course_image_unavailable", "This course has no image.", 404);
        var key = (credential, courseId, course.ImageVersion);
        var lane = downloads[(int)(courseId % downloads.Length)];
        await lane.WaitAsync(timeout.Token);
        try
        {
            await Verify(credential);
            if (cache.TryGetValue(key, out MoodleImage? cached) && cached is not null) return cached;
            MoodleImage image;
            if (course.HasCustomImage && artwork is not null)
            {
                image = await artwork.Get(credential, courseId, timeout.Token)
                    ?? throw new ApiFailure("artwork_changed", "The course image changed. Reload the course.", 409);
                if (image.Version != course.ImageVersion)
                    throw new ApiFailure("artwork_changed", "The course image changed. Reload the course.", 409);
            }
            else
            {
                var source = await moodle.ImageSource(credential, courseId, timeout.Token);
                image = (await transport.Fetch(MoodleSite.Parse(credential.SiteUrl), source, credential.Token, timeout.Token))
                    with { Version = course.ImageVersion };
            }
            await Verify(credential);
            cache.Set(key, image, new MemoryCacheEntryOptions { Size = image.Bytes.Length, AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(15) });
            return image;
        }
        finally { lane.Release(); }
    }

    public async Task<Course> Update(long courseId, byte[]? bytes, string? mimeType, CancellationToken ct)
    {
        if (artwork is null) throw new ApiFailure("artwork_unavailable", "Course artwork is unavailable.", 503);
        var credential = await Credential();
        await moodle.ImageCourse(credential, courseId, ct);
        await Verify(credential);
        if (bytes is null) await artwork.Reset(credential, courseId, ct);
        else await artwork.Set(credential, courseId, bytes, mimeType ?? "", ct);
        await Verify(credential);
        return await moodle.ImageCourse(credential, courseId, ct);
    }

    private async Task<MoodleCredential> Credential() => await credentials.Read()
        ?? throw new ApiFailure("moodle_disconnected", "Connect Moodle first.", 409);
    private async Task Verify(MoodleCredential credential)
    {
        if (await credentials.Read() != credential)
            throw new ApiFailure("moodle_connection_changed", "The Moodle connection changed. Reload the course list.", 409);
    }
    public void Dispose()
    {
        cache.Dispose();
        foreach (var lane in downloads) lane.Dispose();
    }
}
