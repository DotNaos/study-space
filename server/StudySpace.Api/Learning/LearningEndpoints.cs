namespace StudySpace.Api.Learning;

public static class LearningEndpoints
{
    public static IServiceCollection AddStudyLearning(this IServiceCollection services)
    {
        services.AddSingleton<LearningStore>();
        services.AddSingleton<LearningService>();
        services.AddSingleton<LearningChat>();
        services.AddSingleton<ILearningModel, CodexLearningModel>();
        services.AddHostedService<LearningWorker>();
        return services;
    }
    public static void MapStudyLearning(this WebApplication app)
    {
        var group = app.MapGroup("/api/learning/courses/{courseId:long}");
        group.MapGet("", (long courseId, LearningService service, CancellationToken ct) => service.Get(courseId, ct));
        group.MapPost("/generate", async (long courseId, GenerateRequest request, LearningService service, CancellationToken ct) =>
            Results.Json(await service.Generate(courseId, request, ct), statusCode: 202));
        group.MapPost("/cancel", (long courseId, CancelLearningRequest request, LearningService service, CancellationToken ct) => service.Cancel(courseId, request.JobId, ct));
        group.MapGet("/versions/{id}", (long courseId, string id, LearningService service, CancellationToken ct) => service.Version(courseId, id, ct));
        group.MapPost("/activate", (long courseId, ActivateVersionRequest request, LearningService service, CancellationToken ct) => service.Activate(courseId, request.VersionId, ct));
        group.MapPut("/drafts/{id}", (long courseId, string id, DraftRequest request, LearningService service, CancellationToken ct) => service.SaveDraft(courseId, id, request.Answer, ct));
        group.MapPut("/position", (long courseId, ReadingPositionRequest request, LearningService service, CancellationToken ct) => service.SavePosition(courseId, request.SectionId, ct));
        group.MapPost("/chat", (long courseId, LearningChatRequest request, LearningChat chat, HttpContext context) => chat.Stream(courseId, request, context));
    }
}
