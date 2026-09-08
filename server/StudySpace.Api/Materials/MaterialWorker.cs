namespace StudySpace.Api.Materials;

public sealed class MaterialWorker(MaterialCatalog catalog, ILogger<MaterialWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!await catalog.RunNext(stoppingToken)) await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception)
            {
                // Never log upstream documents, provider URLs or process output.
                logger.LogWarning("Material processing paused after a storage failure; it will retry.");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }
    }
}
