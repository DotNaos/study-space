using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public sealed class CredentialStore(IDataProtectionProvider provider, IConfiguration config)
{
    private readonly IDataProtector protector = provider.CreateProtector("study-space.moodle.credential.v1");
    private readonly string path = Path.Combine(Path.Combine(config["STUDY_PRIVATE_DIR"] ?? "/var/lib/study-space-private", "credentials"), "moodle.protected");
    public async Task<MoodleCredential?> Read()
    {
        if (!File.Exists(path)) return null;
        try { return JsonSerializer.Deserialize<MoodleCredential>(protector.Unprotect(await File.ReadAllBytesAsync(path))); }
        catch (System.Security.Cryptography.CryptographicException) { throw new ApiFailure("credential_unavailable", "The saved connection cannot be unlocked. Reconnect Moodle.", 503); }
    }
    public Task Write(MoodleCredential credential) => PrivateFiles.WriteAsync(path, protector.Protect(JsonSerializer.SerializeToUtf8Bytes(credential)));
    public void Delete() { if (File.Exists(path)) File.Delete(path); }
}
