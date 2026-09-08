using System.Text;
using System.Text.Json;
using StudySpace.Api.Codex;

namespace StudySpace.Api.Tests;

public sealed class CodexTests
{
    [Fact] public void ProcessHasOnlyIsolatedEnvironmentAndNoInheritedSecrets()
    {
        var start = CodexPolicy.Process("/fixture/codex", "/fixture/private");
        Assert.Equal(4, start.Environment.Count);
        Assert.Equal("/fixture/private", start.Environment["HOME"]);
        Assert.Equal("/fixture/private/codex", start.Environment["CODEX_HOME"]);
        Assert.Equal(["app-server", "--listen", "stdio://"], start.ArgumentList);
        Assert.True(start.RedirectStandardError);
        Assert.False(start.UseShellExecute);
    }

    [Fact] public void GenerationPolicyExplicitlyDisablesEnvironmentAndNetwork()
    {
        var thread = JsonSerializer.SerializeToElement(CodexPolicy.ThreadStart());
        Assert.True(thread.GetProperty("ephemeral").GetBoolean());
        Assert.Equal("never", thread.GetProperty("approvalPolicy").GetString());
        Assert.Empty(thread.GetProperty("environments").EnumerateArray());
        Assert.Empty(thread.GetProperty("dynamicTools").EnumerateArray());
        Assert.Empty(thread.GetProperty("config").GetProperty("mcp_servers").EnumerateObject());
        Assert.Equal("disabled", thread.GetProperty("config").GetProperty("web_search").GetString());
        var turn = JsonSerializer.SerializeToElement(CodexPolicy.TurnStart("thread", "synthetic", null));
        Assert.Empty(turn.GetProperty("environments").EnumerateArray());
        Assert.False(turn.GetProperty("sandboxPolicy").GetProperty("networkAccess").GetBoolean());
    }

    [Fact] public async Task DisconnectedAccountIsNotReadyEvenWhenAuthenticationNotRequired()
    {
        await using var rpc = new FakeRpc { Respond = (_, _) => new { account = (object?)null, requiresOpenaiAuth = false } };
        using var runtime = new CodexRuntime(rpc);
        Assert.Equal("disconnected", (await runtime.ReadAsync(default)).Status);
        await Assert.ThrowsAsync<CodexUnavailableException>(async () => await Collect(runtime.GenerateAsync("synthetic", null, default)));
        Assert.DoesNotContain(rpc.Calls, call => call.Method == "thread/start");
    }

    [Fact] public async Task DeviceLoginUsesOpaqueIdTracksCompletionAndReturnsNoAccountEmail()
    {
        await using var rpc = new FakeRpc();
        using var runtime = new CodexRuntime(rpc);
        var login = await runtime.StartLoginAsync(default);
        Assert.NotEqual("provider-login", login.Id);
        Assert.Equal("ABCD-EFGH", login.UserCode);
        Assert.Equal("pending", login.Status);
        Assert.Equal(login, await runtime.StartLoginAsync(default));
        rpc.Emit("account/login/completed", new { loginId = "wrong", success = true });
        Assert.Equal("pending", (await runtime.ReadLoginAsync(login.Id, default)).Status);
        rpc.Emit("account/login/completed", new { loginId = "provider-login", success = true });
        Assert.Equal("success", (await runtime.ReadLoginAsync(login.Id, default)).Status);
        var connection = await runtime.ReadAsync(default);
        Assert.Equal("ChatGPT", connection.AccountLabel);
        Assert.DoesNotContain("private@example.test", JsonSerializer.Serialize(connection));
    }

    [Fact] public async Task LoginCompletionCanArriveBeforeStartResponse()
    {
        await using var rpc = new FakeRpc();
        rpc.BeforeResponse = (method, _) => { if (method == "account/login/start") rpc.Emit("account/login/completed", new { loginId = "provider-login", success = true }); };
        using var runtime = new CodexRuntime(rpc);
        Assert.Equal("success", (await runtime.StartLoginAsync(default)).Status);
    }

    [Fact] public async Task UntrustedVerificationAddressIsRejected()
    {
        await using var rpc = new FakeRpc { Respond = (_, _) => new { type = "chatgptDeviceCode", loginId = "provider", userCode = "ABCD-EFGH", verificationUrl = "https://attacker.example/codex/device" } };
        using var runtime = new CodexRuntime(rpc);
        await Assert.ThrowsAsync<CodexUnavailableException>(() => runtime.StartLoginAsync(default));
        Assert.True(rpc.Aborted);
    }

    [Fact] public async Task CancelOnlyTargetsMatchingLoginAndLogoutUsesIsolatedRuntime()
    {
        await using var rpc = new FakeRpc();
        using var runtime = new CodexRuntime(rpc);
        var login = await runtime.StartLoginAsync(default);
        await Assert.ThrowsAsync<KeyNotFoundException>(() => runtime.CancelLoginAsync("not-this-login", default));
        await runtime.CancelLoginAsync(login.Id, default);
        Assert.Equal("cancelled", (await runtime.ReadLoginAsync(login.Id, default)).Status);
        Assert.Equal("provider-login", rpc.Calls.Single(call => call.Method == "account/login/cancel").Parameters.GetProperty("loginId").GetString());
        await runtime.LogoutAsync(default);
        Assert.True(rpc.Aborted);
        Assert.Contains(rpc.Calls, call => call.Method == "account/logout");
    }

    [Fact] public async Task EventsBeforeTurnResponseAreBufferedAndFinalTextIsAuthoritative()
    {
        await using var rpc = new FakeRpc();
        rpc.BeforeResponse = (method, _) =>
        {
            if (method != "turn/start") return;
            rpc.Emit("item/agentMessage/delta", new { threadId = "unrelated", turnId = "turn", delta = "wrong" });
            rpc.Emit("item/completed", new { threadId = "thread", turnId = "turn", item = new { type = "reasoning" } });
            rpc.Emit("item/agentMessage/delta", new { threadId = "thread", turnId = "turn", delta = "partial" });
            rpc.Emit("item/completed", new { threadId = "thread", turnId = "turn", item = new { type = "agentMessage", text = "complete answer" } });
            rpc.Emit("turn/completed", new { threadId = "thread", turn = new { id = "turn", status = "completed" } });
        };
        using var runtime = new CodexRuntime(rpc);
        var result = await Collect(runtime.GenerateAsync("synthetic", null, default));
        Assert.Equal([new CodexDelta("text", "partial"), new CodexDelta("completed", "complete answer")], result);
        Assert.True(rpc.Aborted); // Completed ephemeral context is released too.
    }

    [Fact] public async Task ToolActivityFailsClosedAndInterruptsTurn()
    {
        await using var rpc = new FakeRpc();
        rpc.BeforeResponse = (method, _) =>
        {
            if (method == "turn/start") rpc.Emit("item/started", new { threadId = "thread", turnId = "turn", item = new { type = "commandExecution" } });
        };
        using var runtime = new CodexRuntime(rpc);
        await Assert.ThrowsAsync<CodexUnavailableException>(async () => await Collect(runtime.GenerateAsync("synthetic", null, default)));
        Assert.Contains(rpc.Calls, call => call.Method == "turn/interrupt");
        Assert.True(rpc.Aborted);
    }

    [Fact] public async Task CancellationInterruptsAndReleasesGenerationSlot()
    {
        await using var rpc = new FakeRpc();
        using var runtime = new CodexRuntime(rpc);
        using var cancellation = new CancellationTokenSource();
        rpc.BeforeResponse = (method, _) => { if (method == "turn/start") cancellation.Cancel(); };
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () => await Collect(runtime.GenerateAsync("synthetic", null, cancellation.Token)));
        Assert.True(rpc.Aborted);
        Assert.Contains(rpc.Calls, call => call.Method == "turn/interrupt");
    }

    [Fact] public async Task InputAndLineLimitsRejectOversizeData()
    {
        await using var rpc = new FakeRpc();
        using var runtime = new CodexRuntime(rpc);
        await Assert.ThrowsAsync<ArgumentException>(async () => await Collect(runtime.GenerateAsync(new string('x', CodexPolicy.MaximumPromptCharacters + 1), null, default)));
        using var reader = new StreamReader(new MemoryStream(Encoding.UTF8.GetBytes(new string('x', CodexPolicy.MaximumLineCharacters + 1))));
        await Assert.ThrowsAsync<CodexUnavailableException>(async () => { await foreach (var _ in CodexProcess.ReadLinesAsync(reader, default)) { } });
        Assert.Empty(rpc.Calls);
    }

    private static async Task<List<CodexDelta>> Collect(IAsyncEnumerable<CodexDelta> source)
    { var output = new List<CodexDelta>(); await foreach (var delta in source) output.Add(delta); return output; }

    private sealed class FakeRpc : ICodexRpc
    {
        public event Action<JsonElement>? Notification;
        public List<(string Method, JsonElement Parameters)> Calls { get; } = [];
        public bool Aborted { get; private set; }
        public Action<string, object>? BeforeResponse { get; set; }
        public Func<string, object, object>? Respond { get; init; }
        public Task<JsonElement> CallAsync(string method, object parameters, CancellationToken ct)
        {
            Calls.Add((method, JsonSerializer.SerializeToElement(parameters)));
            BeforeResponse?.Invoke(method, parameters);
            object response = Respond?.Invoke(method, parameters) ?? method switch
            {
                "account/read" => new { account = new { type = "chatgpt", email = "private@example.test" } },
                "account/login/start" => new { type = "chatgptDeviceCode", loginId = "provider-login", userCode = "ABCD-EFGH", verificationUrl = "https://auth.openai.com/codex/device" },
                "thread/start" => new { thread = new { id = "thread" } },
                "turn/start" => new { turn = new { id = "turn" } },
                _ => new { }
            };
            return Task.FromResult(JsonSerializer.SerializeToElement(response));
        }
        public void Emit(string method, object parameters) => Notification?.Invoke(JsonSerializer.SerializeToElement(new { method, @params = parameters }));
        public void Abort() { Aborted = true; Emit("study/process-stopped", new { }); }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
