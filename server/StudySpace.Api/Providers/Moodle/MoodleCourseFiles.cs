using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public sealed record MoodleFileSource(Uri Url, CourseResource Resource);

public static class MoodleCourseFiles
{
    public const int MaximumBytes = 32 * 1024 * 1024;
    public static string? PreviewKind(string? mime) => mime?.ToLowerInvariant() switch
    {
        "application/pdf" => "pdf",
        "image/png" or "image/jpeg" or "image/webp" or "image/gif" => "image",
        _ => null
    };

    public static CourseResource Describe(CourseResource resource, JsonElement content, Uri site, long courseId, long moduleId)
    {
        if (resource.Type != "file" || courseId <= 0 || moduleId <= 0 || DownloadUrl(MoodleJson.Text(content, "fileurl"), site) is not { } source)
            return resource;
        var id = Identifier(source, resource.ModifiedAt);
        var path = $"/api/providers/moodle/courses/{courseId}/modules/{moduleId}/resources/{id}";
        var kind = PreviewKind(resource.MimeType);
        return resource with { Id = id, PreviewUrl = kind is null ? null : path + "/preview", DownloadUrl = path + "/download", PreviewKind = kind };
    }

    public static MoodleFileSource Find(JsonElement contents, Uri site, long courseId, long moduleId, string resourceId)
    {
        // Use the same parser/identifier as the public list, never a browser-supplied source URL or array index.
        var modules = MoodleCourseContents.Parse(contents, site, courseId).SelectMany(section => section.Modules).Where(module => module.Id == moduleId).ToArray();
        if (modules.Length != 1) throw Unavailable();
        var resources = modules[0].Resources.Where(resource => resource.Id == resourceId).ToArray();
        if (resources.Length != 1) throw Unavailable();
        var urls = new List<Uri>();
        foreach (var section in contents.EnumerateArray())
        {
            if (!section.TryGetProperty("modules", out var rawModules)) continue;
            foreach (var module in rawModules.EnumerateArray().Where(module => MoodleJson.Number(module, "id") == moduleId))
            {
                if (!module.TryGetProperty("contents", out var files)) continue;
                foreach (var file in files.EnumerateArray())
                    if (MoodleJson.Text(file, "type") == "file" && DownloadUrl(MoodleJson.Text(file, "fileurl"), site) is { } url &&
                        Identifier(url, resources[0].ModifiedAt) == resourceId) urls.Add(url);
            }
        }
        return urls.Count == 1 ? new(urls[0], resources[0]) : throw Unavailable();
    }

    public static Uri? DownloadUrl(string? raw, Uri site)
    {
        if (raw is null || raw.Length > 8192 || raw.Contains('\\') || !Uri.TryCreate(raw, UriKind.Absolute, out var url) ||
            url.Scheme != "https" || url.UserInfo.Length > 0 || url.GetLeftPart(UriPartial.Authority) != site.GetLeftPart(UriPartial.Authority)) return null;
        // Inspect the unnormalized path too: System.Uri otherwise removes literal/encoded dot segments.
        var rawPath = raw[(raw.IndexOf("://", StringComparison.Ordinal) + 3)..];
        var slash = rawPath.IndexOf('/');
        if (slash < 0) return null;
        rawPath = rawPath[slash..].Split('?', '#')[0];
        var decoded = Uri.UnescapeDataString(rawPath);
        if (decoded.Contains('%') || decoded.Contains('\\') || decoded.Any(char.IsControl) || decoded.Split('/').Any(part => part is "." or "..") ||
            rawPath.Contains("%2f", StringComparison.OrdinalIgnoreCase) || rawPath.Contains("%5c", StringComparison.OrdinalIgnoreCase)) return null;
        var root = site.AbsolutePath.TrimEnd('/');
        var prefixes = new[] { root + "/webservice/pluginfile.php/", root + "/pluginfile.php/", root + "/tokenpluginfile.php/" };
        var prefix = prefixes.FirstOrDefault(value => rawPath.StartsWith(value, StringComparison.Ordinal));
        if (prefix is null) return null;
        var suffix = rawPath[prefix.Length..];
        if (prefix.EndsWith("/tokenpluginfile.php/", StringComparison.Ordinal))
        {
            var split = suffix.IndexOf('/');
            if (split < 0 || !Regex.IsMatch(suffix[..split], "^[a-zA-Z0-9]{16,256}$")) return null;
            suffix = suffix[(split + 1)..]; // Discard the mobile access key; authenticate anew using our saved token.
        }
        var parts = Uri.UnescapeDataString(suffix).Split('/');
        if (parts.Length < 4 || !long.TryParse(parts[0], out var contextId) || contextId <= 0 ||
            !Regex.IsMatch(parts[1], "^[a-z][a-z0-9_]{0,63}$") || !Regex.IsMatch(parts[2], "^[a-z][a-z0-9_]{0,63}$") ||
            parts.Any(part => part.Length == 0)) return null;
        return new Uri(site.AbsoluteUri.TrimEnd('/') + "/webservice/pluginfile.php/" + suffix);
    }

    public static string SafeName(string name)
    {
        var safe = new string(name.Where(character => !char.IsControl(character) && char.GetUnicodeCategory(character) != System.Globalization.UnicodeCategory.Format &&
            character is not '/' and not '\\' and not '"').Take(180).ToArray()).Trim().Trim('.');
        return string.IsNullOrWhiteSpace(safe) ? "Moodle file" : safe;
    }
    private static string Identifier(Uri source, long? modifiedAt) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
        source.AbsoluteUri + "\n" + modifiedAt?.ToString(System.Globalization.CultureInfo.InvariantCulture))));
    public static ApiFailure Unavailable() => new("course_file_unavailable", "This file is no longer available here. Reload the course or open it in Moodle.", 404);
    public static ApiFailure TooLarge() => new("course_file_too_large", "This file is larger than the 32 MB viewing and download limit. Open it in Moodle instead.", 413);
}
