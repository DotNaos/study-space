using System.Text.Json;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public sealed record CourseSection(long Id, string Name, string Summary, CourseModule[] Modules);
public sealed record CourseModule(long Id, string Name, string Type, string? Url, string Description, CourseResource[] Resources);
public sealed record CourseResource(string Type, string Name, string? MimeType, long? Size, long? ModifiedAt, string? Url,
    string? Id = null, string? PreviewUrl = null, string? DownloadUrl = null, string? PreviewKind = null);

public static class MoodleCourseContents
{
    public static CourseSection[] Parse(JsonElement result, Uri site, long courseId = 0)
    {
        if (result.ValueKind != JsonValueKind.Array) throw Unsupported();
        return result.EnumerateArray().Select(section =>
        {
            RequireObject(section);
            return new CourseSection(MoodleJson.Number(section, "id"), MoodleText.Plain(MoodleJson.Text(section, "name") ?? "Section"),
                MoodleText.Plain(MoodleJson.Text(section, "summary")), Children(section, "modules").Select(module => Module(module, site, courseId)).ToArray());
        }).ToArray();
    }

    private static CourseModule Module(JsonElement module, Uri site, long courseId)
    {
        RequireObject(module);
        var id = MoodleJson.Number(module, "id");
        var type = MoodleJson.Text(module, "modname") ?? "unknown";
        // Generate the activity link instead of forwarding upstream URL credentials or query parameters.
        var url = id > 0 && SameSiteUrl(MoodleJson.Text(module, "url"), site) is not null && Regex.IsMatch(type, "^[a-z][a-z0-9_]{0,63}$")
            ? $"{site.AbsoluteUri.TrimEnd('/')}/mod/{type}/view.php?id={id}" : null;
        var resources = Children(module, "contents").Select(content =>
        {
            RequireObject(content);
            var resource = new CourseResource(MoodleJson.Text(content, "type") ?? "unknown", MoodleText.Plain(MoodleJson.Text(content, "filename") ?? "Resource"),
                MoodleJson.Text(content, "mimetype"), OptionalNumber(content, "filesize"), OptionalNumber(content, "timemodified"),
                ResourceUrl(MoodleJson.Text(content, "fileurl"), site));
            return MoodleCourseFiles.Describe(resource, content, site, courseId, id);
        }).ToArray();
        return new(id, MoodleText.Plain(MoodleJson.Text(module, "name") ?? "Activity"), type, url, MoodleText.Plain(MoodleJson.Text(module, "description")), resources);
    }

    private static string? ResourceUrl(string? raw, Uri site)
    {
        var url = SameSiteUrl(raw, site);
        if (url is null) return null;
        var prefix = site.AbsolutePath.TrimEnd('/') + "/pluginfile.php/";
        var decoded = Uri.UnescapeDataString(url.AbsolutePath);
        // Only the canonical browser endpoint is safe to expose. Mobile endpoints can carry
        // access keys in the path, so removing the query is insufficient.
        if (!url.AbsolutePath.StartsWith(prefix, StringComparison.Ordinal) || !decoded.StartsWith(prefix, StringComparison.Ordinal) ||
            decoded.Contains('%') || decoded.Contains('\\') || decoded.Split('/').Any(segment => segment is "." or "..") ||
            url.AbsolutePath.Contains("%2f", StringComparison.OrdinalIgnoreCase) || url.AbsolutePath.Contains("%5c", StringComparison.OrdinalIgnoreCase)) return null;
        return url.GetLeftPart(UriPartial.Path);
    }

    private static Uri? SameSiteUrl(string? raw, Uri site)
    {
        if (raw is null || raw.Length > 8192 || !Uri.TryCreate(raw, UriKind.Absolute, out var url) || url.Scheme != "https" ||
            url.UserInfo.Length > 0 || url.GetLeftPart(UriPartial.Authority) != site.GetLeftPart(UriPartial.Authority)) return null;
        var prefix = site.AbsolutePath.TrimEnd('/') + "/";
        if (!url.AbsolutePath.StartsWith(prefix, StringComparison.Ordinal)) return null;
        return url;
    }

    private static IEnumerable<JsonElement> Children(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out var value)) return [];
        if (value.ValueKind != JsonValueKind.Array) throw Unsupported();
        return value.EnumerateArray();
    }
    private static long? OptionalNumber(JsonElement value, string name) => value.TryGetProperty(name, out var property) &&
        property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var number) && number >= 0 ? number : null;
    private static void RequireObject(JsonElement value) { if (value.ValueKind != JsonValueKind.Object) throw Unsupported(); }
    private static ApiFailure Unsupported() => new("moodle_response", "Moodle returned unsupported course contents.", 502);
}
