using StudySpace.Api.Materials;
namespace StudySpace.Api.Infrastructure;

public static class MaterialEndpoints
{
    public static IServiceCollection AddStudyMaterials(this IServiceCollection services)
    {
        services.AddSingleton<MaterialStore>();
        services.AddSingleton<MaterialToolRunner>();
        services.AddSingleton<IMaterialSourceProvider, MoodleMaterialSourceProvider>();
        services.AddSingleton<IMaterialExtractor, MaterialExtractor>();
        services.AddSingleton<MaterialCatalog>();
        services.AddSingleton<IMaterialCatalog>(provider => provider.GetRequiredService<MaterialCatalog>());
        services.AddHostedService<MaterialWorker>();
        return services;
    }
    public static void MapStudyMaterials(this WebApplication app)
    {
        var routes = app.MapGroup("/api/materials");
        routes.MapGet("/courses/{courseId:long}", (long courseId, IMaterialCatalog catalog, CancellationToken ct) => catalog.GetSnapshot(courseId, ct));
        routes.MapPost("/courses/{courseId:long}/import", async (long courseId, IMaterialCatalog catalog, CancellationToken ct) =>
            Results.Json(await catalog.StartImport(courseId, ct), statusCode: 202));
        routes.MapDelete("/courses/{courseId:long}/jobs/{jobId}", (long courseId, string jobId, IMaterialCatalog catalog, CancellationToken ct) => catalog.Cancel(courseId, jobId, ct));
        routes.MapGet("/{materialId}/revisions/{revision}", (string materialId, string revision, IMaterialCatalog catalog, CancellationToken ct) => catalog.GetDocument(materialId, revision, ct));
        routes.MapGet("/{materialId}/revisions/{revision}/assets/{assetId}", async (string materialId, string revision, string assetId, IMaterialCatalog catalog, HttpContext context, CancellationToken ct) =>
        {
            var asset = await catalog.GetAsset(materialId, revision, assetId, ct);
            var mime = asset.MimeType;
            var inline = mime is "application/pdf" or "image/png" or "image/jpeg" or "image/webp" or "image/gif";
            context.Response.Headers.ContentSecurityPolicy = "sandbox; default-src 'none'; frame-ancestors 'none'";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            return Results.File(asset.Bytes, inline ? mime : "application/octet-stream",
                fileDownloadName: inline ? null : Providers.Moodle.MoodleCourseFiles.SafeName(asset.Name), enableRangeProcessing: true);
        });
    }
}
