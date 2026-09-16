namespace StudySpace.Api.Content;

public static class ContentEndpoints
{
    public static IServiceCollection AddStudyContent(this IServiceCollection services)
    {
        services.AddSingleton<ContentStore>();
        services.AddSingleton<ContentService>();
        return services;
    }

    public static void MapStudyContent(this WebApplication app)
    {
        var group = app.MapGroup("/api/content/courses/{courseId:long}");
        group.MapGet("", (long courseId, ContentService service, CancellationToken ct) => service.Get(courseId, ct));
        group.MapPost("/materialize", (long courseId, ContentMaterializeRequest request, ContentService service, CancellationToken ct) => service.Materialize(courseId, request, ct));
        group.MapGet("/blocks/{blockId}", (long courseId, string blockId, ContentService service, CancellationToken ct) => service.Block(courseId, blockId, ct));
        group.MapGet("/blocks/{blockId}/revisions/{revisionId}", (long courseId, string blockId, string revisionId, ContentService service, CancellationToken ct) => service.Revision(courseId, blockId, revisionId, ct));
        group.MapPut("/blocks/{blockId}", (long courseId, string blockId, ContentEditRequest request, ContentService service, CancellationToken ct) => service.Edit(courseId, blockId, request, ct));
        group.MapPost("/blocks/{blockId}/reset", (long courseId, string blockId, ContentResetRequest request, ContentService service, CancellationToken ct) => service.Reset(courseId, blockId, request, ct));
    }
}
