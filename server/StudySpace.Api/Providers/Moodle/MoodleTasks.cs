using System.Text.Json;
using StudySpace.Api.Infrastructure;

namespace StudySpace.Api.Providers.Moodle;

public sealed record MoodleTaskAttachment(string Name, string? MimeType, long? Size, long? ModifiedAt);

public sealed record MoodleTask(
    string Id,
    long CourseId,
    string CourseName,
    long SectionId,
    string SectionName,
    long ModuleId,
    long? AssignmentId,
    string Title,
    string Description,
    long? OpensAt,
    long? DueAt,
    long? CutoffAt,
    string Status,
    string? SubmissionStatus,
    string? GradingStatus,
    bool? CanSubmit,
    bool? Locked,
    long? SubmittedAt,
    MoodleTaskAttachment[] Attachments,
    string[] Warnings);

public sealed record MoodleTaskList(MoodleTask[] Tasks, bool Partial, string[] Warnings);

internal sealed record MoodleAssignment(
    long CourseId,
    long AssignmentId,
    long ModuleId,
    string Title,
    string Description,
    long? OpensAt,
    long? DueAt,
    long? CutoffAt,
    bool NoSubmissions,
    MoodleTaskAttachment[] Attachments);

internal sealed record MoodleSubmissionState(
    string? SubmissionStatus,
    string? GradingStatus,
    bool? CanSubmit,
    bool? Locked,
    bool Graded,
    long? SubmittedAt,
    long? ExtensionDueAt);

internal static class MoodleTasks
{
    public static (MoodleAssignment[] Assignments, string[] Warnings) ParseAssignments(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("courses", out var courses) || courses.ValueKind != JsonValueKind.Array)
            throw Unsupported("Moodle returned unsupported assignment data.");

        var assignments = new List<MoodleAssignment>();
        foreach (var course in courses.EnumerateArray())
        {
            if (course.ValueKind != JsonValueKind.Object) throw Unsupported("Moodle returned unsupported assignment data.");
            var courseId = MoodleJson.Number(course, "id");
            if (courseId <= 0) continue;
            if (!course.TryGetProperty("assignments", out var values)) continue;
            if (values.ValueKind != JsonValueKind.Array) throw Unsupported("Moodle returned unsupported assignment data.");
            foreach (var assignment in values.EnumerateArray())
            {
                if (assignment.ValueKind != JsonValueKind.Object) throw Unsupported("Moodle returned unsupported assignment data.");
                var assignmentId = MoodleJson.Number(assignment, "id");
                var moduleId = MoodleJson.Number(assignment, "cmid");
                if (assignmentId <= 0 || moduleId <= 0) continue;
                var attachments = Files(assignment, "introfiles").Concat(Files(assignment, "activityattachments"))
                    .DistinctBy(file => (file.Name, file.MimeType, file.Size, file.ModifiedAt)).Take(32).ToArray();
                assignments.Add(new(
                    courseId,
                    assignmentId,
                    moduleId,
                    MoodleText.Plain(MoodleJson.Text(assignment, "name") ?? "Assignment"),
                    MoodleText.Plain(MoodleJson.Text(assignment, "intro")),
                    OptionalPositive(assignment, "allowsubmissionsfromdate"),
                    OptionalPositive(assignment, "duedate"),
                    OptionalPositive(assignment, "cutoffdate"),
                    Bool(assignment, "nosubmissions") == true,
                    attachments));
            }
        }
        return (assignments.ToArray(), Warnings(result));
    }

    public static MoodleSubmissionState ParseSubmission(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Object) throw Unsupported("Moodle returned unsupported submission status data.");
        JsonElement attempt = default;
        if (result.TryGetProperty("lastattempt", out var last) && last.ValueKind == JsonValueKind.Object) attempt = last;
        else if (result.TryGetProperty("status", out var status) && status.ValueKind == JsonValueKind.Object) attempt = status;

        JsonElement submission = default;
        if (attempt.ValueKind == JsonValueKind.Object && attempt.TryGetProperty("submission", out var value) && value.ValueKind == JsonValueKind.Object)
            submission = value;

        var submissionStatus = submission.ValueKind == JsonValueKind.Object ? MoodleJson.Text(submission, "status") : null;
        var gradingStatus = attempt.ValueKind == JsonValueKind.Object ? MoodleJson.Text(attempt, "gradingstatus") : null;
        var submittedAt = submission.ValueKind == JsonValueKind.Object && submissionStatus is not null and not "new"
            ? OptionalPositive(submission, "timemodified")
            : null;
        return new(
            submissionStatus,
            gradingStatus,
            attempt.ValueKind == JsonValueKind.Object ? Bool(attempt, "cansubmit") : null,
            attempt.ValueKind == JsonValueKind.Object ? Bool(attempt, "locked") : null,
            (attempt.ValueKind == JsonValueKind.Object && Bool(attempt, "graded") == true) || string.Equals(gradingStatus, "graded", StringComparison.OrdinalIgnoreCase),
            submittedAt,
            attempt.ValueKind == JsonValueKind.Object ? OptionalPositive(attempt, "extensionduedate") : null);
    }

    public static string[] Warnings(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Object || !result.TryGetProperty("warnings", out var warnings) || warnings.ValueKind != JsonValueKind.Array)
            return [];
        return warnings.EnumerateArray().Select(warning => warning.ValueKind == JsonValueKind.Object ? MoodleJson.Text(warning, "message") : null)
            .Where(message => !string.IsNullOrWhiteSpace(message)).Select(message => MoodleText.Plain(message!)).Distinct().Take(16).ToArray();
    }

    private static IEnumerable<MoodleTaskAttachment> Files(JsonElement parent, string property)
    {
        if (!parent.TryGetProperty(property, out var files)) yield break;
        if (files.ValueKind != JsonValueKind.Array) throw Unsupported("Moodle returned unsupported assignment file metadata.");
        foreach (var file in files.EnumerateArray())
        {
            if (file.ValueKind != JsonValueKind.Object) continue;
            var name = MoodleText.Plain(MoodleJson.Text(file, "filename") ?? "Attachment");
            yield return new(name, MoodleJson.Text(file, "mimetype"), OptionalPositive(file, "filesize"), OptionalPositive(file, "timemodified"));
        }
    }

    internal static long? OptionalPositive(JsonElement value, string name) => value.TryGetProperty(name, out var property) &&
        property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var number) && number > 0 ? number : null;

    internal static bool? Bool(JsonElement value, string name)
    {
        if (!value.TryGetProperty(name, out var property)) return null;
        if (property.ValueKind is JsonValueKind.True or JsonValueKind.False) return property.GetBoolean();
        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number) && number is 0 or 1) return number == 1;
        return null;
    }

    private static ApiFailure Unsupported(string message) => new("moodle_response", message, 502);
}
