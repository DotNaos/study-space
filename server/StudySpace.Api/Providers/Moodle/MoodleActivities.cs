using System.Globalization;
using System.Text.Json;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public sealed record MoodleSubmissionRequirements(bool? FilesEnabled, long? MaximumFiles, long? MaximumFileBytes, string? AcceptedFileTypes, bool? OnlineTextEnabled);
public sealed record MoodleActivity(long CourseId, long ModuleId, long SectionId, string Type, string Title,
    string Description, string Instructions, string Content, CourseResource[] Resources, MoodleTask? Assignment,
    MoodleSubmissionRequirements? SubmissionRequirements, bool Partial, string[] Warnings);

public sealed partial class MoodleService
{
    public async Task<MoodleActivity> Activity(long courseId, long moduleId, CancellationToken ct)
    {
        var credential = await credentials.Read() ?? throw new ApiFailure("moodle_disconnected", "Connect Moodle first.", 409);
        var site = MoodleSite.Parse(credential.SiteUrl);
        var rawContents = await AuthorizedContents(credential, courseId, ct, freshEnrollment: true);
        var sections = MoodleCourseContents.Parse(rawContents, site, courseId);
        var matches = sections.SelectMany(s => s.Modules.Where(m => m.Id == moduleId).Select(m => (Section: s, Module: m))).ToArray();
        if (matches.Length != 1) throw new ApiFailure("activity_unavailable", "Diese Aktivität ist in diesem Kurs nicht verfügbar.", 404);
        var (section, module) = matches[0];
        var warnings = new List<string>();
        var resources = module.Resources.Where(r => r.Type == "file" && r.Name != "index.html").ToList();
        var description = module.Description;
        var instructions = "";
        var content = "";
        MoodleTask? task = null;
        MoodleSubmissionRequirements? requirements = null;
        if (module.Type == "assign")
        {
            try
            {
                var raw = await AssignmentData(credential, courseId, ct);
                var assignment = MoodleTasks.ParseAssignments(raw).Assignments.SingleOrDefault(a => a.CourseId == courseId && a.ModuleId == moduleId);
                var entry = MoodleActivityFiles.Assignment(raw, courseId, moduleId);
                if (assignment is null || entry.ValueKind != JsonValueKind.Object)
                    throw new ApiFailure("moodle_rejected", "Moodle liefert keine Details für diese Aufgabe.", 502);
                warnings.AddRange(MoodleTasks.Warnings(raw));
                description = MoodleActivityContent.Text(MoodleJson.Text(entry, "intro"));
                if (description.Length == 0) description = module.Description;
                instructions = MoodleActivityContent.Text(MoodleJson.Text(entry, "activity"));
                resources.AddRange(MoodleActivityFiles.Sources(entry, site, courseId, moduleId).Select(s => s.Resource));
                requirements = Requirements(entry);
                MoodleSubmissionState? submission = null;
                var taskWarnings = new List<string>();
                if (!assignment.NoSubmissions)
                {
                    try
                    {
                        var status = await transport.Authenticated(site, credential.Token, "mod_assign_get_submission_status",
                            new() { ["assignid"] = assignment.AssignmentId.ToString(CultureInfo.InvariantCulture) }, ct);
                        submission = MoodleTasks.ParseSubmission(status);
                        taskWarnings.AddRange(MoodleTasks.Warnings(status));
                        if (instructions.Length == 0 && status.TryGetProperty("assignmentdata", out var data) && data.ValueKind == JsonValueKind.Object)
                            instructions = MoodleActivityContent.Text(MoodleJson.Text(data, "activity"));
                    }
                    catch (ApiFailure error) when (error.Code is "moodle_rejected" or "moodle_response")
                    { taskWarnings.Add("Der Abgabestatus konnte von Moodle nicht gelesen werden."); }
                }
                var dueAt = submission?.ExtensionDueAt is { } extension && (assignment.DueAt is null || extension > assignment.DueAt) ? extension : assignment.DueAt;
                task = new($"moodle:{courseId}:assign:{assignment.AssignmentId}", courseId, "", section.Id, section.Name, moduleId,
                    assignment.AssignmentId, assignment.Title, description, assignment.OpensAt, dueAt, assignment.CutoffAt,
                    TaskStatus(assignment, submission, dueAt), submission?.SubmissionStatus, submission?.GradingStatus,
                    submission?.CanSubmit, submission?.Locked, submission?.SubmittedAt, assignment.Attachments, taskWarnings.ToArray());
                warnings.AddRange(taskWarnings);
            }
            catch (ApiFailure error) when (error.Code is "moodle_rejected" or "moodle_response")
            { warnings.Add("Moodle liefert momentan keine vollständigen Aufgabendetails. Bereits sichtbare Materialien bleiben verfügbar."); }
        }
        else if (module.Type == "page")
        {
            try
            {
                var raw = await transport.Authenticated(site, credential.Token, "mod_page_get_pages_by_courses",
                    new() { ["courseids[0]"] = courseId.ToString(CultureInfo.InvariantCulture) }, ct);
                if (!raw.TryGetProperty("pages", out var pages) || pages.ValueKind != JsonValueKind.Array)
                    throw new ApiFailure("moodle_response", "Moodle liefert keinen Seiteninhalt.", 502);
                var page = pages.EnumerateArray().SingleOrDefault(p => MoodleJson.Number(p, "coursemodule") == moduleId && MoodleJson.Number(p, "course") == courseId);
                if (page.ValueKind != JsonValueKind.Object) throw new ApiFailure("moodle_response", "Moodle liefert keinen Seiteninhalt.", 502);
                description = MoodleActivityContent.Text(MoodleJson.Text(page, "intro"));
                content = MoodleActivityContent.Text(MoodleJson.Text(page, "content"));
                warnings.AddRange(MoodleTasks.Warnings(raw));
                if ((MoodleJson.Text(page, "content") ?? "").Contains("<img", StringComparison.OrdinalIgnoreCase))
                    warnings.Add("Bilder im Seitentext werden derzeit als Bildhinweise angezeigt.");
            }
            catch (ApiFailure error) when (error.Code is "moodle_rejected" or "moodle_response")
            { warnings.Add("Der Seiteninhalt konnte von Moodle nicht gelesen werden."); }
        }
        else if (module.Type is not ("resource" or "folder" or "label"))
            warnings.Add("Dieser Aktivitätstyp wird noch nicht vollständig in der App unterstützt. Es wird keine externe Seite geöffnet.");
        if (await credentials.Read() != credential) throw new ApiFailure("moodle_connection_changed", "Die Moodle-Verbindung wurde geändert. Bitte erneut laden.", 409);
        return new(courseId, moduleId, section.Id, module.Type, module.Name, description, instructions, content,
            resources.DistinctBy(r => r.Id ?? r.Name).ToArray(), task, requirements, warnings.Count > 0, warnings.Distinct().ToArray());
    }

    private Task<JsonElement> AssignmentData(MoodleCredential credential, long courseId, CancellationToken ct) =>
        transport.Authenticated(MoodleSite.Parse(credential.SiteUrl), credential.Token, "mod_assign_get_assignments",
            new() { ["courseids[0]"] = courseId.ToString(CultureInfo.InvariantCulture) }, ct);

    internal async Task<MoodleFileSource> ActivityFile(MoodleCredential credential, JsonElement contents, long courseId, long moduleId, string resourceId, CancellationToken ct)
    {
        var site = MoodleSite.Parse(credential.SiteUrl);
        var module = MoodleCourseContents.Parse(contents, site, courseId).SelectMany(s => s.Modules).SingleOrDefault(m => m.Id == moduleId);
        if (module is null) throw MoodleCourseFiles.Unavailable();
        if (module.Resources.Any(r => r.Id == resourceId)) return MoodleCourseFiles.Find(contents, site, courseId, moduleId, resourceId);
        if (module.Type != "assign") throw MoodleCourseFiles.Unavailable();
        var raw = await AssignmentData(credential, courseId, ct);
        var entry = MoodleActivityFiles.Assignment(raw, courseId, moduleId);
        return MoodleActivityFiles.Sources(entry, site, courseId, moduleId).DistinctBy(s => s.Resource.Id)
            .SingleOrDefault(s => s.Resource.Id == resourceId) ?? throw MoodleCourseFiles.Unavailable();
    }

    private static MoodleSubmissionRequirements Requirements(JsonElement entry)
    {
        if (!entry.TryGetProperty("configs", out var configs) || configs.ValueKind != JsonValueKind.Array) return new(null, null, null, null, null);
        string? Value(string plugin, string name) => configs.EnumerateArray().Where(c => c.ValueKind == JsonValueKind.Object &&
            MoodleJson.Text(c, "subtype") == "assignsubmission" && MoodleJson.Text(c, "plugin") == plugin && MoodleJson.Text(c, "name") == name)
            .Select(c => MoodleJson.Text(c, "value")).FirstOrDefault();
        long? Number(string name) => long.TryParse(Value("file", name), NumberStyles.None, CultureInfo.InvariantCulture, out var n) && n >= 0 ? n : null;
        bool? Enabled(string plugin) => Value(plugin, "enabled") switch { "1" => true, "0" => false, _ => null };
        return new(Enabled("file"), Number("maxfilesubmissions"), Number("maxsubmissionsizebytes"),
            MoodleText.Plain(Value("file", "acceptedfiletypes")), Enabled("onlinetext"));
    }
}
