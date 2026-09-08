namespace StudySpace.Api.Providers.Moodle;

public sealed class MoodleImageService(MoodleService moodle, CredentialStore credentials, IMoodleImageTransport transport) : IDisposable
{
    private readonly SemaphoreSlim downloads = new(4, 4);
    public async Task<MoodleImage> Get(long courseId, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(20));
        var credential = await credentials.Read() ?? throw new Infrastructure.ApiFailure("moodle_disconnected", "Connect Moodle first.", 409);
        var source = await moodle.ImageSource(credential, courseId, timeout.Token);
        await downloads.WaitAsync(timeout.Token);
        try
        {
            if (await credentials.Read() != credential)
                throw new Infrastructure.ApiFailure("moodle_connection_changed", "The Moodle connection changed. Reload the course list.", 409);
            var image = await transport.Fetch(MoodleSite.Parse(credential.SiteUrl), source, credential.Token, timeout.Token);
            if (await credentials.Read() != credential)
                throw new Infrastructure.ApiFailure("moodle_connection_changed", "The Moodle connection changed. Reload the course list.", 409);
            return image;
        }
        finally { downloads.Release(); }
    }
    public void Dispose() => downloads.Dispose();
}
