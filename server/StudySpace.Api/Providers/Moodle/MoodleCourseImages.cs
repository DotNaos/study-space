using System.Text.Json;
namespace StudySpace.Api.Providers.Moodle;

public static class MoodleCourseImages
{
    public const int MaximumBytes = 4 * 1024 * 1024;
    public static bool AllowedMime(string? mime) => mime is "image/png" or "image/jpeg" or "image/webp";

    public static Uri? Select(JsonElement course, Uri site)
    {
        if (course.TryGetProperty("overviewfiles", out var files) && files.ValueKind == JsonValueKind.Array)
        {
            foreach (var file in files.EnumerateArray())
            {
                if (file.ValueKind != JsonValueKind.Object || !AllowedMime(MoodleJson.Text(file, "mimetype")) ||
                    MoodleJson.Number(file, "filesize") > MaximumBytes) continue;
                if (DownloadUrl(MoodleJson.Text(file, "fileurl"), site) is { } image) return image;
            }
            if (files.GetArrayLength() > 0) return null; // Do not bypass known unsupported MIME/size metadata via courseimage.
        }
        // Moodle also returns generated courseimage placeholders. Only uploaded overview files qualify.
        var fallback = DownloadUrl(MoodleJson.Text(course, "courseimage"), site);
        return fallback is not null && Path.GetExtension(fallback.AbsolutePath).ToLowerInvariant() is ".png" or ".jpg" or ".jpeg" or ".webp"
            ? fallback : null;
    }

    public static Uri? DownloadUrl(string? raw, Uri site)
    {
        if (raw is null || raw.Length > 8192 || !Uri.TryCreate(raw, UriKind.Absolute, out var url) || url.Scheme != "https" ||
            url.UserInfo.Length > 0 || url.GetLeftPart(UriPartial.Authority) != site.GetLeftPart(UriPartial.Authority)) return null;
        var root = site.AbsolutePath.TrimEnd('/');
        var prefixes = new[] { root + "/webservice/pluginfile.php/", root + "/pluginfile.php/" };
        var prefix = prefixes.FirstOrDefault(value => url.AbsolutePath.StartsWith(value, StringComparison.Ordinal));
        if (prefix is null) return null;
        var suffix = url.AbsolutePath[prefix.Length..];
        var decoded = Uri.UnescapeDataString(suffix);
        var parts = decoded.Split('/');
        if (decoded.Contains('%') || decoded.Contains('\\') || suffix.Contains("%2f", StringComparison.OrdinalIgnoreCase) ||
            suffix.Contains("%5c", StringComparison.OrdinalIgnoreCase) || parts.Length < 4 ||
            !long.TryParse(parts[0], out var contextId) || contextId <= 0 || parts[1] != "course" || parts[2] != "overviewfiles" ||
            parts.Any(part => part.Length == 0 || part is "." or "..")) return null;
        // Discard every upstream query/fragment. The connection token is sent separately in a POST body.
        return new Uri(site.AbsoluteUri.TrimEnd('/') + "/webservice/pluginfile.php/" + suffix);
    }
}
