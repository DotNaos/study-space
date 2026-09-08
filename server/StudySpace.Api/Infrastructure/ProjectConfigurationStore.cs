using System.Text.Json;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Infrastructure;

public sealed record ProjectConfiguration(MoodleConfiguration Moodle);
public sealed record MoodleConfiguration(string? SiteUrl);

public sealed class ProjectConfigurationStore(IConfiguration configuration, CredentialStore credentials)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    private readonly string path = Path.Combine(RuntimeConfiguration.DataDirectory(configuration), "config.json");
    private readonly SemaphoreSlim changes = new(1, 1);

    public async Task<ProjectConfiguration> Read(CancellationToken ct = default)
    {
        await changes.WaitAsync(ct);
        try
        {
            if (!File.Exists(path))
            {
                // Only migrate when creating the file. An explicitly cleared URL must stay cleared.
                var credential = await credentials.Read();
                var initial = Normalize(new(new(credential?.SiteUrl)));
                await WriteFile(initial);
                return initial;
            }
            try
            {
                var saved = JsonSerializer.Deserialize<ProjectConfiguration>(await File.ReadAllBytesAsync(path, ct), Json);
                return Normalize(saved);
            }
            catch (Exception error) when (error is JsonException or ApiFailure)
            { throw new ApiFailure("config_invalid", "The saved project configuration is invalid. Correct it before continuing.", 503); }
        }
        finally { changes.Release(); }
    }

    public async Task<ProjectConfiguration> Write(ProjectConfiguration request, CancellationToken ct = default)
    {
        var normalized = Normalize(request);
        await changes.WaitAsync(ct);
        try { await WriteFile(normalized); return normalized; }
        finally { changes.Release(); }
    }

    private Task WriteFile(ProjectConfiguration value) => PrivateFiles.WriteAsync(path, JsonSerializer.SerializeToUtf8Bytes(value, Json));
    private static ProjectConfiguration Normalize(ProjectConfiguration? value)
    {
        if (value?.Moodle is null) throw new ApiFailure("config_invalid", "Provide the Moodle configuration, using a null site URL to clear it.");
        var site = value.Moodle.SiteUrl is null ? null : MoodleSite.Parse(value.Moodle.SiteUrl).AbsoluteUri.TrimEnd('/');
        return new(new(site));
    }
}
