using StudySpace.Api.Materials;
using StudySpace.Api.Providers.Moodle;

namespace StudySpace.Api.Infrastructure;

public static class StudyLinks
{
    private const long MaxSafeInteger = 9_007_199_254_740_991;

    public static string? CourseUrl(IConfiguration config, long courseId)
    {
        var raw = config["STUDY_PUBLIC_URL"] ?? "http://localhost:8080";
        if (courseId is <= 0 or > MaxSafeInteger ||
            !Uri.TryCreate(raw, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("https" or "http") || uri.UserInfo.Length > 0 ||
            uri.Query.Length > 0 || uri.Fragment.Length > 0 || uri.AbsolutePath != "/")
            return null;
        return $"{uri.GetLeftPart(UriPartial.Authority)}/courses/{courseId}";
    }

    public static string? ActivityUrl(IConfiguration config, long courseId, long moduleId, string? resourceId = null)
    {
        var course = CourseUrl(config, courseId);
        if (course is null || moduleId is <= 0 or > MaxSafeInteger ||
            resourceId is not null && (resourceId.Length != 64 || resourceId.Any(c => !char.IsAsciiHexDigitLower(c))))
            return null;
        return $"{course}/activities/{moduleId}" + (resourceId is null ? "" : $"?resource={resourceId}");
    }

    public static Course[] Courses(IConfiguration config, Course[] courses) =>
        courses.Select(course => course with { StudyUrl = CourseUrl(config, course.Id) }).ToArray();

    public static CourseSection[] Contents(IConfiguration config, long courseId, CourseSection[] sections) =>
        sections.Select(section => section with
        {
            Modules = section.Modules.Select(module => module with
            {
                StudyUrl = ActivityUrl(config, courseId, module.Id),
                Resources = module.Resources.Select(resource => resource with
                {
                    StudyUrl = resource.Id is null ? null : ActivityUrl(config, courseId, module.Id, resource.Id),
                }).ToArray(),
            }).ToArray(),
        }).ToArray();

    public static MoodleTaskList Tasks(IConfiguration config, MoodleTaskList list) => list with
    {
        Tasks = list.Tasks.Select(task => task with
        {
            StudyUrl = ActivityUrl(config, task.CourseId, task.ModuleId),
        }).ToArray(),
    };

    public static MaterialSnapshot Materials(IConfiguration config, MaterialSnapshot snapshot) => snapshot with
    {
        Materials = snapshot.Materials.Select(material => material with
        {
            StudyUrl = material.ModuleId is { } moduleId ? ActivityUrl(config, snapshot.CourseId, moduleId) : null,
        }).ToArray(),
    };
}
