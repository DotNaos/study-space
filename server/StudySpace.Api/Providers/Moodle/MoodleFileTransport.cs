using StudySpace.Api.Infrastructure;
using System.Net;
using System.Text.Json;
namespace StudySpace.Api.Providers.Moodle;

public sealed record MoodleFile(byte[] Bytes, string ContentType, string Name = "Moodle file");
public interface IMoodleFileTransport
{
    Task<MoodleFile> Fetch(Uri site, Uri source, string token, string? previewKind, CancellationToken ct, string? expectedMime = null);
}

public sealed class MoodleFileTransport(IHttpClientFactory clients) : IMoodleFileTransport
{
    public async Task<MoodleFile> Fetch(Uri site, Uri source, string token, string? previewKind, CancellationToken ct, string? expectedMime = null)
    {
        var url = MoodleCourseFiles.DownloadUrl(source.AbsoluteUri, site) ?? throw MoodleCourseFiles.Unavailable();
        using var client = clients.CreateClient("moodle");
        client.Timeout = Timeout.InfiniteTimeSpan; // The service's 45-second deadline includes queuing, metadata and body reads.
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        { Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = token }) };
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (response.StatusCode != HttpStatusCode.OK)
            throw new ApiFailure("course_file_unavailable", "Moodle could not provide this file. Open the activity in Moodle or try again.", 502);
        var mime = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
        if (previewKind is not null && MoodleCourseFiles.PreviewKind(mime) != previewKind) throw Unsupported();
        if (previewKind is null && expectedMime is { Length: > 0 } && mime is "text/html" or "application/json" &&
            !string.Equals(expectedMime, mime, StringComparison.OrdinalIgnoreCase)) throw MoodleCourseFiles.Unavailable();
        if (response.Content.Headers.ContentLength > MoodleCourseFiles.MaximumBytes) throw MoodleCourseFiles.TooLarge();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int count;
        while ((count = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + count > MoodleCourseFiles.MaximumBytes) throw MoodleCourseFiles.TooLarge();
            buffer.Write(chunk, 0, count);
        }
        var bytes = buffer.ToArray();
        if (previewKind is not null && !MatchesSignature(bytes, mime!)) throw Unsupported();
        if (previewKind is null && mime == "application/json" && IsMoodleError(bytes)) throw MoodleCourseFiles.Unavailable();
        return new(bytes, previewKind is null ? "application/octet-stream" : mime!);
    }

    private static bool MatchesSignature(byte[] bytes, string mime) => mime switch
    {
        "application/pdf" => bytes.Length >= 8 && bytes.AsSpan().StartsWith("%PDF-"u8) && bytes[5] is >= (byte)'1' and <= (byte)'2' && bytes[6] == '.' && bytes[7] is >= (byte)'0' and <= (byte)'9',
        "image/png" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        "image/jpeg" => bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 }),
        "image/webp" => bytes.Length >= 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8),
        "image/gif" => bytes.AsSpan().StartsWith("GIF87a"u8) || bytes.AsSpan().StartsWith("GIF89a"u8),
        _ => false
    };
    private static bool IsMoodleError(byte[] bytes)
    {
        try
        {
            using var document = JsonDocument.Parse(bytes);
            return document.RootElement.ValueKind == JsonValueKind.Object &&
                document.RootElement.TryGetProperty("exception", out var exception) && exception.ValueKind == JsonValueKind.String &&
                document.RootElement.TryGetProperty("errorcode", out var code) && code.ValueKind == JsonValueKind.String;
        }
        catch (JsonException) { return false; }
    }
    private static ApiFailure Unsupported() => new("course_file_unsupported", "This file cannot be previewed safely. Download it or open the activity in Moodle.", 415);
}
