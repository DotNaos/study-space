using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public sealed class MoodleFileService(MoodleService moodle, CredentialStore credentials, IMoodleFileTransport transport) : IDisposable
{
    private readonly SemaphoreSlim downloads = new(2, 2);
    public async Task<MoodleFile> Get(long courseId, long moduleId, string resourceId, bool preview, CancellationToken ct)
    {
        if (courseId <= 0 || moduleId <= 0 || !Regex.IsMatch(resourceId, "^[a-f0-9]{64}$")) throw MoodleCourseFiles.Unavailable();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(45));
        try
        {
            var credential = await credentials.Read() ?? throw new ApiFailure("moodle_disconnected", "Connect Moodle first.", 409);
            await downloads.WaitAsync(timeout.Token);
            try
            {
                await CheckConnection(credential);
                var contents = await moodle.AuthorizedContents(credential, courseId, timeout.Token, freshEnrollment: true);
                var source = MoodleCourseFiles.Find(contents, MoodleSite.Parse(credential.SiteUrl), courseId, moduleId, resourceId);
                if (source.Resource.Size > MoodleCourseFiles.MaximumBytes) throw MoodleCourseFiles.TooLarge();
                if (preview && source.Resource.PreviewKind is null)
                    throw new ApiFailure("course_file_unsupported", "This file has no preview. Download it or open it in Moodle.", 415);
                await CheckConnection(credential);
                var file = await transport.Fetch(MoodleSite.Parse(credential.SiteUrl), source.Url, credential.Token, preview ? source.Resource.PreviewKind : null, timeout.Token, source.Resource.MimeType);
                timeout.Token.ThrowIfCancellationRequested();
                await CheckConnection(credential);
                return file with { Name = MoodleCourseFiles.SafeName(source.Resource.Name) };
            }
            finally { downloads.Release(); }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new ApiFailure("course_file_timeout", "Moodle took too long to provide this file. Try again or open it in Moodle.", 504); }
        catch (HttpRequestException)
        { throw new ApiFailure("course_file_unavailable", "Moodle could not provide this file. Try again or open it in Moodle.", 502); }
    }
    private async Task CheckConnection(MoodleCredential credential)
    {
        if (await credentials.Read() != credential)
            throw new ApiFailure("moodle_connection_changed", "The Moodle connection changed. Reload the course before opening the file.", 409);
    }
    public void Dispose() => downloads.Dispose();
}
