using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public sealed record MoodleImage(byte[] Bytes, string ContentType, string? Version = null);
public interface IMoodleImageTransport
{
    Task<MoodleImage> Fetch(Uri site, Uri source, string token, CancellationToken ct);
}

public sealed class MoodleImageTransport(IHttpClientFactory clients) : IMoodleImageTransport
{
    public async Task<MoodleImage> Fetch(Uri site, Uri source, string token, CancellationToken ct)
    {
        var url = MoodleCourseImages.DownloadUrl(source.AbsoluteUri, site)
            ?? throw new ApiFailure("course_image_unavailable", "This course image cannot be opened safely.", 404);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        using var client = clients.CreateClient("moodle");
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = token })
        };
        request.Headers.Accept.ParseAdd("image/png, image/jpeg, image/webp");
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        // The shared Moodle handler disables redirects, proxying, cookies and private/rebound destinations.
        if (!response.IsSuccessStatusCode)
            throw new ApiFailure("course_image_unavailable", "Moodle could not provide this course image.", 502);
        var mime = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
        if (!MoodleCourseImages.AllowedMime(mime))
            throw new ApiFailure("course_image_unsupported", "This course image has an unsupported format.", 415);
        if (response.Content.Headers.ContentLength > MoodleCourseImages.MaximumBytes) throw TooLarge();
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(chunk, timeout.Token)) > 0)
        {
            if (buffer.Length + count > MoodleCourseImages.MaximumBytes) throw TooLarge();
            buffer.Write(chunk, 0, count);
        }
        var bytes = buffer.ToArray();
        if (!MatchesSignature(bytes, mime!))
            throw new ApiFailure("course_image_unsupported", "Moodle did not return a supported image.", 415);
        return new(bytes, mime!);
    }

    internal static bool MatchesSignature(byte[] bytes, string mime) => mime switch
    {
        "image/png" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        "image/jpeg" => bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 }),
        "image/webp" => bytes.Length >= 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8),
        _ => false
    };
    private static ApiFailure TooLarge() => new("course_image_too_large", "This course image exceeds the supported size.", 413);
}
