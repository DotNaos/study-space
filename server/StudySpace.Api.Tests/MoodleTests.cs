using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Tests;

public sealed class MoodleTests : IDisposable
{
    private const string Site = "https://moodle.example.test/learning";
    private const string Qr = "moodlemobile://https//moodle.example.test/learning?qrlogin=synthetic_one_use_key&userid=42";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-test-" + Guid.NewGuid());
    private readonly FixtureTransport transport = new();
    private readonly TestClock clock = new();
    private readonly CredentialStore store;
    private readonly MoodleService service;
    public MoodleTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_PRIVATE_DIR"] = directory }).Build();
        store = new CredentialStore(DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(directory, "keys"))), config);
        service = new MoodleService(transport, store, clock);
    }
    [Fact] public async Task FullQrConnectionStoresOnlyProtectedCredentialAndNormalizesCourses()
    {
        var discovery = await service.Discover(Site, default);
        Assert.Equal(["browser-sso", "qr"], discovery.Methods);
        Assert.Contains(discovery.Warnings, w => w.Contains("dieselbe öffentliche"));
        var login = await service.Start(new(Site, "qr"), default);
        Assert.Equal(Site + "/user/profile.php", login.LaunchUrl);
        Assert.Equal("pending", service.Status(login.Id).Status);
        Assert.Equal("completed", (await service.Complete(login.Id, new(Qr), default)).Status);
        Assert.Equal("connected", (await service.State(default)).Status);
        Assert.Equal("Algebra", Assert.Single(await service.Courses(default)).Name);
        var saved = await store.Read();
        Assert.Equal(42, saved!.UserId);
        var bytes = await File.ReadAllBytesAsync(Path.Combine(directory, "credentials", "moodle.protected"));
        Assert.DoesNotContain(FixtureTransport.Token, Encoding.UTF8.GetString(bytes));
        var replay = await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(Qr), default));
        Assert.Equal("login_consumed", replay.Code);
        await service.Disconnect(default);
        Assert.Equal("disconnected", (await service.State(default)).Status);
        Assert.Null(await store.Read());
    }
    [Fact] public async Task WrongSiteNeverExchangesQr()
    {
        var login = await service.Start(new(Site, "qr"), default);
        var error = await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(Qr.Replace("moodle.example.test", "other.example.test")), default));
        Assert.Equal("qr_site_mismatch", error.Code);
        Assert.Equal(0, transport.Exchanges);
        Assert.Null(await store.Read());
    }
    [Fact] public async Task WrongAccountConsumesFlowWithoutSavingToken()
    {
        var login = await service.Start(new(Site, "qr"), default);
        transport.UserId = 43;
        Assert.Equal("account_mismatch", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(Qr), default))).Code);
        Assert.Null(await store.Read());
        Assert.Equal("failed", service.Status(login.Id).Status);
    }
    [Fact] public async Task ExpiryAndNewStartInvalidateRequests()
    {
        var old = await service.Start(new(Site, "qr"), default);
        var login = await service.Start(new(Site, "qr"), default);
        Assert.Equal("login_unknown", Assert.Throws<ApiFailure>(() => service.Status(old.Id)).Code);
        clock.Advance(TimeSpan.FromMinutes(6));
        Assert.Equal("expired", service.Status(login.Id).Status);
        Assert.Equal("login_expired", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(Qr), default))).Code);
        Assert.Equal(0, transport.Exchanges);
    }
    [Fact] public async Task ConcurrentCompletionsExchangeOnlyOnce()
    {
        var login = await service.Start(new(Site, "qr"), default);
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 2).Select(async _ =>
        { try { await service.Complete(login.Id, new(Qr), default); return "ok"; } catch (ApiFailure e) { return e.Code; } }));
        Assert.Contains("ok", outcomes); Assert.Contains("login_consumed", outcomes); Assert.Equal(1, transport.Exchanges);
    }
    [Fact] public async Task UnsupportedSiteNeverAdvertisesFakeBrowserReturn()
    {
        transport.QrEnabled = false;
        transport.BrowserEnabled = false;
        var discovery = await service.Discover(Site, default);
        Assert.Empty(discovery.Methods);
        Assert.Equal("site-login", discovery.LoginMode);
        Assert.Equal("login_unsupported", (await Assert.ThrowsAsync<ApiFailure>(() => service.Start(new(Site, "browser-sso"), default))).Code);
    }
    [Fact] public async Task InvalidatedTokenReportsExpiredWithoutExposingIt()
    {
        var login = await service.Start(new(Site, "qr"), default);
        await service.Complete(login.Id, new(Qr), default);
        transport.RejectToken = true;
        var state = await service.State(default);
        Assert.Equal("expired", state.Status);
        Assert.DoesNotContain(FixtureTransport.Token, JsonSerializer.Serialize(state));
    }
    [Fact] public async Task BrowserLoginUsesCorrelatedReturnAndRejectsReplay()
    {
        var login = await service.Start(new(Site, "browser-sso"), default);
        var launch = new Uri(login.LaunchUrl!);
        Assert.Equal("/learning/admin/tool/mobile/launch.php", launch.AbsolutePath);
        var query = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(launch.Query);
        Assert.Equal("web+studyspace", query["urlscheme"].ToString());
        Assert.Equal("moodle_mobile_app", query["service"].ToString());
        var callback = Callback(query["passport"].ToString());
        Assert.Equal("completed", (await service.Complete(login.Id, new(CallbackUrl: callback), default)).Status);
        Assert.Equal("connected", (await service.State(default)).Status);
        Assert.Equal(0, transport.Exchanges);
        Assert.Equal("login_consumed", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(CallbackUrl: callback), default))).Code);
    }
    [Fact] public async Task BrowserReturnRejectsOtherFlowSiteSchemeAndMixedMethod()
    {
        var login = await service.Start(new(Site, "browser-sso"), default);
        var passport = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(login.LaunchUrl!).Query)["passport"].ToString();
        Assert.Equal("login_signature_mismatch", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(CallbackUrl: Callback("wrong-passport")), default))).Code);
        Assert.Equal("login_signature_mismatch", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(CallbackUrl: Callback(passport, "https://other.example.test")), default))).Code);
        Assert.Equal("login_callback_invalid", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(CallbackUrl: Callback(passport).Replace("web+studyspace", "moodlemobile")), default))).Code);
        Assert.Equal("login_method_mismatch", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(QrCode: Qr, CallbackUrl: Callback(passport)), default))).Code);
        Assert.Null(await store.Read());
    }
    private static string Callback(string passport, string site = Site)
    {
        var signature = Convert.ToHexStringLower(System.Security.Cryptography.MD5.HashData(Encoding.UTF8.GetBytes(site + passport)));
        return "web+studyspace://token=" + Convert.ToBase64String(Encoding.UTF8.GetBytes(signature + ":::" + FixtureTransport.Token + ":::discardedPrivateToken"));
    }
    [Fact] public async Task CancelInvalidatesDelayedCallbackAndPreservesExistingConnection()
    {
        var connected = await service.Start(new(Site, "qr"), default);
        await service.Complete(connected.Id, new(Qr), default);
        var login = await service.Start(new(Site, "browser-sso"), default);
        var passport = Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(new Uri(login.LaunchUrl!).Query)["passport"].ToString();
        await service.Cancel(login.Id, default);
        await service.Cancel(login.Id, default); // Retry and unknown IDs are idempotent.
        await service.Cancel("unknown", default);
        Assert.Equal("login_unknown", (await Assert.ThrowsAsync<ApiFailure>(() => service.Complete(login.Id, new(CallbackUrl: Callback(passport)), default))).Code);
        Assert.Equal("connected", (await service.State(default)).Status);
        Assert.Equal(42, (await store.Read())!.UserId);
    }
    [Theory]
    [InlineData("http://moodle.example.test")][InlineData("https://user:pass@moodle.example.test")]
    [InlineData("https://127.0.0.1")][InlineData("https://localhost")][InlineData("https://x.localhost")]
    [InlineData("https://moodle.example.test:8443")][InlineData("https://moodle.example.test/?token=value")]
    public void InvalidSitesRejected(string value) => Assert.Throws<ApiFailure>(() => MoodleSite.Parse(value));
    [Theory]
    [InlineData("127.0.0.1")][InlineData("10.0.0.2")][InlineData("100.101.38.8")][InlineData("169.254.169.254")]
    [InlineData("172.16.0.1")][InlineData("192.168.0.1")][InlineData("::1")][InlineData("::ffff:10.0.0.2")]
    [InlineData("fd00::1")][InlineData("fe80::1")][InlineData("2001:db8::1")]
    public void PrivateDestinationsRejected(string ip) => Assert.False(MoodleSite.IsPublic(IPAddress.Parse(ip)));
    [Theory][InlineData("1.1.1.1")][InlineData("::ffff:8.8.8.8")][InlineData("2606:4700:4700::1111")]
    public void PublicDestinationsAllowed(string ip) => Assert.True(MoodleSite.IsPublic(IPAddress.Parse(ip)));
    [Fact] public void RedirectsCookiesAndProxyDisabled()
    { using var handler = MoodleTransport.CreateHandler(); Assert.False(handler.AllowAutoRedirect); Assert.False(handler.UseCookies); Assert.False(handler.UseProxy); Assert.NotNull(handler.ConnectCallback); }
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    private sealed class TestClock : TimeProvider
    {
        private DateTimeOffset current = new(2026, 9, 7, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => current;
        public void Advance(TimeSpan by) => current += by;
    }
    private sealed class FixtureTransport : IMoodleTransport
    {
        public const string Token = "syntheticMoodleToken00000000000001";
        public int Exchanges { get; private set; }
        public long UserId { get; set; } = 42;
        public bool QrEnabled { get; set; } = true;
        public bool BrowserEnabled { get; set; } = true;
        public bool RejectToken { get; set; }
        public Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct)
        {
            Assert.Equal(Site, site.AbsoluteUri.TrimEnd('/'));
            if (method == "tool_mobile_get_public_config") return Json(new { wwwroot = Site, sitename = "Fixture Moodle", enablewebservices = 1, enablemobilewebservice = 1, tool_mobile_qrcodetype = QrEnabled ? 2 : 0, typeoflogin = BrowserEnabled ? 2 : 1 });
            Assert.Equal("tool_mobile_get_tokens_for_qr_login", method);
            Exchanges++;
            return Json(new { token = Token });
        }
        public Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct)
        {
            Assert.Equal(Token, token);
            if (RejectToken) throw new ApiFailure("moodle_token_rejected", "Reconnect.", 401);
            if (method == "core_webservice_get_site_info") return Json(new { siteurl = Site, userid = UserId, sitename = "Fixture Moodle", fullname = "Synthetic Student" });
            Assert.Equal("core_enrol_get_users_courses", method);
            return Json(new[] { new { id = 7, fullname = "Algebra", shortname = "ALG", summary = "Linear algebra" } });
        }
        private static Task<JsonElement> Json(object value) => Task.FromResult(JsonSerializer.SerializeToElement(value));
    }
}
