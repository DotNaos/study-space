namespace StudySpace.Api.Learning;

public static class LearningEndpoints
{
    public static IServiceCollection AddStudyLearning(this IServiceCollection services)
    {
        services.AddSingleton<LearningStore>();
        services.AddSingleton<LearningService>();
        services.AddSingleton<LearningEditing>();
        services.AddSingleton<LearningAttempts>();
        services.AddSingleton<LearningTaskReview>();
        services.AddSingleton<LearningChat>();
        services.AddSingleton<ILearningModel, CodexLearningModel>();
        services.AddHostedService<LearningWorker>();
        return services;
    }
    public static void MapStudyLearning(this WebApplication app)
    {
        var group = app.MapGroup("/api/learning/courses/{courseId:long}");
        group.MapPost("/versions/{id}/tasks/reconcile", (long courseId, string id, TaskReconcileRequest request, LearningTaskReview service, CancellationToken ct) => service.Reconcile(courseId, id, request, ct));
        group.MapGet("/attempts", (long courseId, LearningAttempts service, CancellationToken ct) => service.Get(courseId, ct));
        group.MapPost("/attempts", (long courseId, AttemptSaveRequest request, LearningAttempts service, CancellationToken ct) => service.Save(courseId, request, ct));
        group.MapPost("/attempts/{id}/submit", (long courseId, string id, AttemptSubmitRequest request, LearningAttempts service, CancellationToken ct) => service.Submit(courseId, id, request, ct));
        group.MapPost("/attempts/{id}/feedback", (long courseId, string id, FeedbackRequest request, LearningAttempts service, CancellationToken ct) => service.Feedback(courseId, id, request, ct));
        group.MapPost("/attempts/{id}/review", (long courseId, string id, CodexReviewRequest request, LearningAttempts service, CancellationToken ct) => service.Review(courseId, id, request, ct));
        group.MapPut("/sections/{id}", (long courseId, string id, SectionEditRequest request, LearningEditing editing, CancellationToken ct) => editing.Edit(courseId, id, request, ct));
        group.MapGet("/versions/{versionId}/sections/{id}/mdx", async (long courseId, string versionId, string id, LearningService service, CancellationToken ct) =>
        {
            var version = await service.Version(courseId, versionId, ct);
            var section = version.Sections.SingleOrDefault(section => section.Id == id) ?? throw new StudySpace.Api.Infrastructure.ApiFailure("learning_content_missing", "Dieser Abschnitt ist nicht verfügbar.", 404);
            return Results.File(System.Text.Encoding.UTF8.GetBytes(section.Markdown), "text/plain; charset=utf-8", "section-" + id + ".mdx");
        });
        group.MapGet("", (long courseId, LearningService service, CancellationToken ct) => service.Get(courseId, ct));
        group.MapPost("/generate", async (long courseId, GenerateRequest request, LearningService service, CancellationToken ct) =>
            Results.Json(await service.Generate(courseId, request, ct), statusCode: 202));
        group.MapPost("/cancel", (long courseId, CancelLearningRequest request, LearningService service, CancellationToken ct) => service.Cancel(courseId, request.JobId, ct));
        group.MapGet("/versions/{id}", (long courseId, string id, LearningService service, CancellationToken ct) => service.Version(courseId, id, ct));
        group.MapPost("/activate", (long courseId, ActivateVersionRequest request, LearningService service, CancellationToken ct) => service.Activate(courseId, request.VersionId, ct, request.ExpectedActiveVersionId, request.CheckRevision));
        group.MapPut("/drafts/{id}", (long courseId, string id, DraftRequest request, LearningService service, CancellationToken ct) => service.SaveDraft(courseId, id, request.Answer, ct));
        group.MapPut("/position", (long courseId, ReadingPositionRequest request, LearningService service, CancellationToken ct) => service.SavePosition(courseId, request.SectionId, ct));
        group.MapPost("/chat", (long courseId, LearningChatRequest request, LearningChat chat, HttpContext context) => chat.Stream(courseId, request, context));
    }
}
