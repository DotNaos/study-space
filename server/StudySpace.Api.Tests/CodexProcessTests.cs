using Microsoft.Extensions.Configuration;
using StudySpace.Api.Codex;

namespace StudySpace.Api.Tests;

public sealed class CodexProcessTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-codex-tests-" + Guid.NewGuid().ToString("N"));

    [Fact] public async Task ServerApprovalWithCollidingRequestIdFailsClosed()
    {
        if (OperatingSystem.IsWindows()) return;
        Directory.CreateDirectory(directory);
        var binary = Path.Combine(directory, "fake-codex");
        await File.WriteAllTextAsync(binary, """
            #!/bin/sh
            IFS= read -r initialize
            printf '%s\n' '{"id":1,"result":{}}'
            IFS= read -r initialized
            IFS= read -r account
            printf '%s\n' '{"id":2,"method":"item/commandExecution/requestApproval","params":{"command":"never execute"}}'
            sleep 10
            """ + "\n");
        File.SetUnixFileMode(binary, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        { ["STUDY_CODEX_BINARY"] = binary, ["STUDY_CODEX_PRIVATE_DIR"] = Path.Combine(directory, "private") }).Build();
        await using var rpc = new CodexProcess(configuration);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var error = await Assert.ThrowsAsync<CodexUnavailableException>(() => rpc.CallAsync("account/read", new { refreshToken = false }, deadline.Token));
        Assert.DoesNotContain("never execute", error.Message);
        Assert.False(File.Exists(Path.Combine(directory, "private", "codex", "auth.json")));
    }

    [Fact] public async Task PrivateDirectoryHasRestrictedPermissionsAndNoHistory()
    {
        CodexPolicy.PrepareDirectory(directory);
        var file = Path.Combine(directory, "codex", "config.toml");
        var config = await File.ReadAllTextAsync(file);
        Assert.Contains("cli_auth_credentials_store = \"file\"", config);
        Assert.Contains("forced_login_method = \"chatgpt\"", config);
        Assert.Contains("persistence = \"none\"", config);
        if (!OperatingSystem.IsWindows())
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute, File.GetUnixFileMode(directory));
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(file));
        }
    }

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
