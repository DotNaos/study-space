namespace StudySpace.Api.Pipeline;

public static class PipelineEndpoints
{
    public static IServiceCollection AddStudyPipeline(this IServiceCollection services)
    {
        services.AddSingleton<IPipelineInventory, PipelineInventory>();
        services.AddSingleton<PipelineService>();
        return services;
    }
    public static void MapStudyPipeline(this WebApplication app)
    {
        var group = app.MapGroup("/api/pipeline/courses/{courseId:long}");
        group.MapGet("", (long courseId, PipelineService service, CancellationToken ct) => service.Get(courseId, ct));
        group.MapPost("/sync", (long courseId, PlanSyncRequest request, PipelineService service, CancellationToken ct) => service.Sync(courseId, request, ct));
        group.MapPut("/structure", (long courseId, PlanStructureRequest request, PipelineService service, CancellationToken ct) => service.Structure(courseId, request, ct));
        group.MapPost("/decisions", (long courseId, PlanDecisionRequest request, PipelineService service, CancellationToken ct) => service.Decide(courseId, request, ct));
        group.MapPost("/mapping", (long courseId, PlanMappingRequest request, PipelineService service, CancellationToken ct) => service.Map(courseId, request, ct));
    }
}
