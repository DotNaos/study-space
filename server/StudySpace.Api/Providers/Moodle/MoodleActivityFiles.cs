using System.Text.Json;
namespace StudySpace.Api.Providers.Moodle;

internal static class MoodleActivityFiles
{
    internal static JsonElement Assignment(JsonElement result, long courseId, long moduleId)
    {
        if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("courses", out var courses) || courses.ValueKind != JsonValueKind.Array) return default;
        var matches = new List<JsonElement>();
        foreach (var course in courses.EnumerateArray().Where(c => c.ValueKind == JsonValueKind.Object && MoodleJson.Number(c, "id") == courseId))
        {
            if (!course.TryGetProperty("assignments", out var assignments) || assignments.ValueKind != JsonValueKind.Array) continue;
            matches.AddRange(assignments.EnumerateArray().Where(a => a.ValueKind == JsonValueKind.Object && MoodleJson.Number(a, "cmid") == moduleId &&
                (!a.TryGetProperty("course", out _) || MoodleJson.Number(a, "course") == courseId)));
        }
        return matches.Count == 1 ? matches[0] : default;
    }

    internal static IEnumerable<MoodleFileSource> Sources(JsonElement assignment, Uri site, long courseId, long moduleId)
    {
        if (assignment.ValueKind != JsonValueKind.Object) yield break;
        foreach (var key in new[] { "introfiles", "introattachments", "activityattachments" })
        {
            if (!assignment.TryGetProperty(key, out var files) || files.ValueKind != JsonValueKind.Array) continue;
            foreach (var file in files.EnumerateArray().Where(f => f.ValueKind == JsonValueKind.Object))
            {
                var url = MoodleCourseFiles.DownloadUrl(MoodleJson.Text(file, "fileurl"), site);
                if (url is null) continue;
                var resource = new CourseResource("file", MoodleText.Plain(MoodleJson.Text(file, "filename") ?? "Datei"),
                    MoodleJson.Text(file, "mimetype"), MoodleTasks.OptionalPositive(file, "filesize"), MoodleTasks.OptionalPositive(file, "timemodified"), null);
                resource = MoodleCourseFiles.Describe(resource, file, site, courseId, moduleId);
                yield return new(url, resource);
            }
        }
    }
}
