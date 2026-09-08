using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.AspNetCore.WebUtilities;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public sealed class MoodleService(IMoodleTransport transport, CredentialStore credentials, TimeProvider clock)
{
    private readonly ConcurrentDictionary<string, PendingLogin> logins = new();
    private readonly SemaphoreSlim changes = new(1, 1);
    private readonly SemaphoreSlim courseReads = new(1, 1);
    private volatile CourseSnapshot? courseSnapshot;
    private static readonly string[] QrInstructions = [
        "Öffne dein Moodle-Profil und melde dich auf der Seite deiner Hochschule an.",
        "Zeige im Bereich Mobile App den Anmelde-QR-Code an und lade sein Bild hier hoch.",
        "Browser und Study-Space-Server müssen dieselbe öffentliche Internetadresse verwenden. Nutze dasselbe Heimnetz oder einen bereits eingerichteten Exit Node des Servers.",
        "Halte den QR-Code privat. Er ist kurz gültig und kann nur einmal verwendet werden."
    ];
    public async Task<Discovery> Discover(string raw, CancellationToken ct)
    {
        var site = MoodleSite.Parse(raw);
        var config = await transport.Public(site, "tool_mobile_get_public_config", new { }, ct);
        var canonical = MoodleJson.Text(config, "httpswwwroot");
        if (string.IsNullOrWhiteSpace(canonical)) canonical = MoodleJson.Text(config, "wwwroot");
        if (canonical is not null && MoodleSite.Parse(canonical) != site)
            throw new ApiFailure("site_canonical_mismatch", "Use the site's canonical Moodle address. The supplied address reports a different installation.");
        var enabled = MoodleJson.Number(config, "enablemobilewebservice") == 1 && MoodleJson.Number(config, "enablewebservices") == 1;
        var qr = enabled && MoodleJson.Number(config, "tool_mobile_qrcodetype") == 2;
        var browser = enabled && MoodleJson.Number(config, "typeoflogin") is 2 or 3;
        var advertisedLaunch = MoodleJson.Text(config, "launchurl");
        var expectedLaunch = site.AbsoluteUri.TrimEnd('/') + "/admin/tool/mobile/launch.php";
        if (!string.IsNullOrEmpty(advertisedLaunch) && advertisedLaunch != expectedLaunch) browser = false;
        var warnings = new List<string>();
        if (!enabled) warnings.Add("Diese Moodle-Seite hat mobile Webdienste deaktiviert. Die Administration muss sie vor der Verbindung aktivieren.");
        else if (!qr && !browser) warnings.Add("Diese Moodle-Seite bietet keine Anmeldung per mobilem QR-Code an. Dafür benötigt Study Space noch eine native Browser-Rückgabe. Hier wird kein Passwort abgefragt.");
        if (qr) warnings.Add("Für die QR-Anmeldung müssen Moodle im Browser und dieser Server dieselbe öffentliche Internetverbindung verwenden.");
        if (browser) warnings.Add("Die Browser-Anmeldung benötigt einen Browser mit Protokoll-Registrierung, etwa Chrome oder Edge am Computer. Erlaube Study Space als Handler, bevor du Moodle öffnest.");
        var methods = new List<string>();
        if (browser) methods.Add("browser-sso");
        if (qr) methods.Add("qr");
        return new Discovery(site.AbsoluteUri.TrimEnd('/'), MoodleJson.Text(config, "sitename") ?? "Moodle", browser ? "browser-sso" : "site-login", methods.ToArray(), warnings.ToArray());
    }
    public async Task<LoginView> Start(LoginRequest request, CancellationToken ct)
    {
        var discovery = await Discover(request.SiteUrl, ct);
        if (!discovery.Methods.Contains(request.Method)) throw new ApiFailure("login_unsupported", "This site does not support the selected password-free connection method.", 422);
        await changes.WaitAsync(ct);
        try
        {
            // One active connection flow for a single-user installation; bound storage and invalidate old flows.
            logins.Clear();
            var id = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));
            var login = new PendingLogin(MoodleSite.Parse(discovery.SiteUrl), clock.GetUtcNow().AddMinutes(5), request.Method, Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32)));
            logins[id] = login;
            var launch = request.Method == "qr" ? discovery.SiteUrl + "/user/profile.php" : QueryHelpers.AddQueryString(discovery.SiteUrl + "/admin/tool/mobile/launch.php",
                new Dictionary<string, string?> { ["service"] = "moodle_mobile_app", ["passport"] = login.Passport,
                    ["urlscheme"] = MoodleBrowserReturn.Scheme, ["confirmed"] = "1" });
            string[] instructions = request.Method == "qr" ? QrInstructions : [
                "Erlaube Study Space in deinem Browser, Anmeldelinks zu öffnen.",
                "Öffne anschließend Moodle und melde dich auf der Seite deiner Hochschule an.",
                "Erlaube die Rückkehr zu Study Space. Dein Passwort bleibt auf der Seite deiner Hochschule."
            ];
            return new LoginView(id, "pending", request.Method, login.ExpiresAt, launch, instructions);
        }
        finally { changes.Release(); }
    }
    public LoginStatus Status(string id)
    {
        var login = Find(id);
        return new LoginStatus(id, login.ExpiresAt <= clock.GetUtcNow() && login.Status == "pending" ? "expired" : login.Status, login.ExpiresAt);
    }
    public async Task<LoginStatus> Complete(string id, CompleteRequest request, CancellationToken ct)
    {
        await changes.WaitAsync(ct);
        try { return await CompleteLocked(id, request, ct); }
        finally { changes.Release(); }
    }
    public async Task<LoginStatus> CompleteBrowserReturn(CompleteRequest request, CancellationToken ct)
    {
        await changes.WaitAsync(ct);
        try
        {
            // A stable browser handler contains no login ID. Match the one active browser flow
            // using Moodle's site/passport digest before CompleteLocked consumes the request.
            var active = logins.SingleOrDefault(pair => pair.Value.Method == "browser-sso" && pair.Value.Status == "pending");
            if (active.Value is null) throw new ApiFailure("login_unknown", "There is no active browser connection. Start again.", 404);
            return await CompleteLocked(active.Key, request, ct);
        }
        finally { changes.Release(); }
    }
    private async Task<LoginStatus> CompleteLocked(string id, CompleteRequest request, CancellationToken ct)
    {
            var login = Find(id);
            if (login.ExpiresAt <= clock.GetUtcNow()) throw new ApiFailure("login_expired", "This connection request expired. Start again.", 410);
            if (login.Status != "pending") throw new ApiFailure("login_consumed", "This connection request was already used. Start again.", 409);
            string token;
            long? expectedUserId = null;
            if (login.Method == "qr")
            {
                if (request.CallbackUrl is not null) throw new ApiFailure("login_method_mismatch", "Use the selected connection method.");
                var qr = MoodleSite.ParseQr(request.QrCode, login.Site);
                expectedUserId = qr.UserId;
                login.Status = "failed";
                var exchange = await transport.Public(login.Site, "tool_mobile_get_tokens_for_qr_login", new { qrloginkey = qr.Key, userid = qr.UserId }, ct);
                token = MoodleJson.Text(exchange, "token") ?? "";
            }
            else
            {
                if (request.QrCode is not null) throw new ApiFailure("login_method_mismatch", "Use the selected connection method.");
                token = MoodleBrowserReturn.Token(request.CallbackUrl, login.Site, login.Passport);
                login.Status = "failed";
            }
            if (!Regex.IsMatch(token, "^[a-zA-Z0-9]{16,256}$")) throw new ApiFailure("moodle_response", "Moodle did not return a valid mobile connection.", 502);
            var info = await transport.Authenticated(login.Site, token, "core_webservice_get_site_info", null, ct);
            var userId = MoodleJson.Number(info, "userid");
            if (userId <= 0 || expectedUserId is not null && userId != expectedUserId || MoodleSite.Parse(MoodleJson.Text(info, "siteurl")) != login.Site)
                throw new ApiFailure("account_mismatch", "Moodle returned a different site or account. Start a new connection.", 422);
            var credential = new MoodleCredential(login.Site.AbsoluteUri.TrimEnd('/'), MoodleJson.Text(info, "sitename") ?? "Moodle", userId,
                MoodleJson.Text(info, "fullname") ?? MoodleJson.Text(info, "username") ?? "Moodle user", token, clock.GetUtcNow());
            await credentials.Write(credential);
            courseSnapshot = null;
            login.Status = "completed";
            return new LoginStatus(id, login.Status, login.ExpiresAt);
    }
    public async Task<MoodleState> State(CancellationToken ct)
    {
        var credential = await credentials.Read();
        if (credential is null) return new("disconnected");
        try { await Validate(credential, ct); }
        catch (ApiFailure error) when (error.Code == "moodle_token_rejected")
        { return new("expired", credential.SiteUrl, credential.SiteName, credential.DisplayName, credential.LastVerifiedAt); }
        return new("connected", credential.SiteUrl, credential.SiteName, credential.DisplayName, clock.GetUtcNow());
    }
    public async Task<Course[]> Courses(CancellationToken ct)
    {
        var credential = await credentials.Read() ?? throw new ApiFailure("moodle_disconnected", "Connect Moodle first.", 409);
        return await Courses(credential, ct);
    }
    private async Task<Course[]> Courses(MoodleCredential credential, CancellationToken ct)
    {
        return (await CourseEntries(credential, ct)).Select(entry => entry.Course).ToArray();
    }
    private async Task<CourseEntry[]> CourseEntries(MoodleCredential credential, CancellationToken ct, bool fresh = false)
    {
        await courseReads.WaitAsync(ct);
        try
        {
            if (!fresh && courseSnapshot is { } cached && cached.ExpiresAt > clock.GetUtcNow() &&
                cached.Credential.SiteUrl == credential.SiteUrl && cached.Credential.UserId == credential.UserId &&
                cached.Credential.Token == credential.Token && cached.Credential.LastVerifiedAt == credential.LastVerifiedAt)
                return cached.Entries;
            await Validate(credential, ct);
            var site = MoodleSite.Parse(credential.SiteUrl);
            var result = await transport.Authenticated(site, credential.Token, "core_enrol_get_users_courses", new() { ["userid"] = credential.UserId.ToString() }, ct);
            if (result.ValueKind != System.Text.Json.JsonValueKind.Array) throw new ApiFailure("moodle_response", "Moodle returned an unsupported course list.", 502);
            var entries = result.EnumerateArray().Select(x =>
            {
                if (x.ValueKind != System.Text.Json.JsonValueKind.Object || MoodleJson.Number(x, "id") <= 0)
                    throw new ApiFailure("moodle_response", "Moodle returned an unsupported course list.", 502);
                var id = MoodleJson.Number(x, "id");
                var image = MoodleCourseImages.Select(x, site);
                var startDate = MoodleJson.Number(x, "startdate");
                var endDate = MoodleJson.Number(x, "enddate");
                var course = new Course(id, MoodleText.Plain(MoodleJson.Text(x, "fullname") ?? "Course"),
                    MoodleText.Plain(MoodleJson.Text(x, "shortname")), MoodleText.Plain(MoodleJson.Text(x, "summary")),
                    image is null ? null : $"/api/providers/moodle/courses/{id}/image", startDate > 0 ? startDate : null, endDate > 0 ? endDate : null);
                return new CourseEntry(course, image);
            }).ToArray();
            courseSnapshot = new(credential, clock.GetUtcNow().AddSeconds(30), entries);
            return entries;
        }
        finally { courseReads.Release(); }
    }
    internal async Task<Uri> ImageSource(MoodleCredential credential, long courseId, CancellationToken ct)
    {
        var course = (await CourseEntries(credential, ct)).SingleOrDefault(entry => entry.Course.Id == courseId);
        if (course is null) throw new ApiFailure("course_unavailable", "This course is not available in your Moodle course list.", 404);
        return course.Image ?? throw new ApiFailure("course_image_unavailable", "This course has no supported image.", 404);
    }
    public async Task<CourseSection[]> Contents(long courseId, CancellationToken ct)
    {
        var credential = await credentials.Read() ?? throw new ApiFailure("moodle_disconnected", "Connect Moodle first.", 409);
        var result = await AuthorizedContents(credential, courseId, ct);
        return MoodleCourseContents.Parse(result, MoodleSite.Parse(credential.SiteUrl), courseId);
    }
    internal async Task<System.Text.Json.JsonElement> AuthorizedContents(MoodleCredential credential, long courseId, CancellationToken ct, bool freshEnrollment = false)
    {
        if (courseId <= 0 || !(await CourseEntries(credential, ct, freshEnrollment)).Any(entry => entry.Course.Id == courseId))
            throw new ApiFailure("course_unavailable", "This course is not available in your Moodle course list.", 404);
        var site = MoodleSite.Parse(credential.SiteUrl);
        return await transport.Authenticated(site, credential.Token, "core_course_get_contents", new() { ["courseid"] = courseId.ToString(System.Globalization.CultureInfo.InvariantCulture) }, ct);
    }
    private async Task Validate(MoodleCredential credential, CancellationToken ct)
    {
        var site = MoodleSite.Parse(credential.SiteUrl);
        var info = await transport.Authenticated(site, credential.Token, "core_webservice_get_site_info", null, ct);
        if (MoodleJson.Number(info, "userid") != credential.UserId || MoodleSite.Parse(MoodleJson.Text(info, "siteurl")) != site)
            throw new ApiFailure("moodle_token_rejected", "The saved connection no longer matches this account. Reconnect Moodle.", 401);
    }
    public async Task Cancel(string id, CancellationToken ct)
    {
        await changes.WaitAsync(ct);
        try { logins.TryRemove(id, out _); }
        finally { changes.Release(); }
    }
    public async Task Disconnect(CancellationToken ct)
    {
        await changes.WaitAsync(ct);
        try { logins.Clear(); credentials.Delete(); courseSnapshot = null; }
        finally { changes.Release(); }
    }
    private PendingLogin Find(string id) => logins.TryGetValue(id, out var login) ? login : throw new ApiFailure("login_unknown", "This connection request is no longer available. Start again.", 404);
    private sealed record CourseEntry(Course Course, Uri? Image);
    private sealed record CourseSnapshot(MoodleCredential Credential, DateTimeOffset ExpiresAt, CourseEntry[] Entries);
    private sealed class PendingLogin(Uri site, DateTimeOffset expiresAt, string method, string passport)
    {
        public Uri Site { get; } = site;
        public string Method { get; } = method;
        public string Passport { get; } = passport;
        public DateTimeOffset ExpiresAt { get; } = expiresAt;
        public string Status { get; set; } = "pending";
    }
}
