using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public interface IMoodleTransport
{
    Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct);
    Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct);
}

public sealed class MoodleTransport(IHttpClientFactory clients) : IMoodleTransport
{
    public async Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(site.AbsoluteUri.TrimEnd('/') + "/lib/ajax/service-nologin.php"));
        request.Content = JsonContent.Create(new[] { new { index = 0, methodname = method, args } });
        var result = await Send(request, ct);
        if (result.ValueKind != JsonValueKind.Array || result.GetArrayLength() != 1)
            throw new ApiFailure("moodle_response", "Moodle returned an unsupported response.", 502);
        var first = result[0];
        if (first.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.True)
        {
            var code = first.TryGetProperty("exception", out var exception) ? MoodleJson.Text(exception, "errorcode") : null;
            if (code is "ipmismatch" or "invalidip") throw new ApiFailure("qr_network_mismatch", "Open Moodle on the same internet connection as your Study Space server, generate a fresh QR code, and try again.");
            throw new ApiFailure("moodle_rejected", "Moodle rejected the request. For QR login, generate a fresh code and use the same internet connection as your server.", 422);
        }
        if (!first.TryGetProperty("data", out var data)) throw new ApiFailure("moodle_response", "Moodle returned an unsupported response.", 502);
        return data.Clone();
    }
    public Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct)
    {
        var fields = new Dictionary<string, string>(args ?? []) { ["wstoken"] = token, ["wsfunction"] = method, ["moodlewsrestformat"] = "json" };
        var request = new HttpRequestMessage(HttpMethod.Post, new Uri(site.AbsoluteUri.TrimEnd('/') + "/webservice/rest/server.php")) { Content = new FormUrlEncodedContent(fields) };
        return SendOwned(request, ct);
    }
    private async Task<JsonElement> SendOwned(HttpRequestMessage request, CancellationToken ct)
    { using (request) return await Send(request, ct); }
    private async Task<JsonElement> Send(HttpRequestMessage request, CancellationToken ct)
    {
        using var client = clients.CreateClient("moodle");
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new ApiFailure("moodle_unreachable", "Moodle could not be reached securely. Check the site address and try again.", 502);
        if (response.Content.Headers.ContentLength > 4 * 1024 * 1024) throw new ApiFailure("moodle_response", "Moodle returned an oversized response.", 502);
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > 4 * 1024 * 1024) throw new ApiFailure("moodle_response", "Moodle returned an oversized response.", 502);
            buffer.Write(chunk, 0, read);
        }
        try
        {
            using var json = JsonDocument.Parse(buffer.ToArray());
            var root = json.RootElement;
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("exception", out _))
            {
                if (MoodleJson.Text(root, "errorcode") == "invalidtoken")
                    throw new ApiFailure("moodle_token_rejected", "Moodle no longer accepts this connection. Reconnect Moodle.", 401);
                if (MoodleJson.Text(root, "errorcode") is "nopermissions" or "requireloginerror" or "coursehidden" or "notenrolled")
                    throw new ApiFailure("moodle_access_denied", "Moodle does not allow access to this course or material.", 403);
                throw new ApiFailure("moodle_rejected", "Moodle could not complete the request. Try again later; the saved connection is preserved.", 502);
            }
            return root.Clone();
        }
        catch (JsonException) { throw new ApiFailure("moodle_response", "Moodle returned an unsupported response.", 502); }
    }

    public static SocketsHttpHandler CreateHandler() => new()
    {
        AllowAutoRedirect = false, UseCookies = false, UseProxy = false,
        ConnectTimeout = TimeSpan.FromSeconds(10), PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        ConnectCallback = async (context, ct) =>
        {
            // Resolve once and connect to that exact validated address, preventing DNS rebinding.
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
            if (addresses.Length == 0 || addresses.Any(a => !MoodleSite.IsPublic(a)))
                throw new ApiFailure("site_private", "Moodle must use a public HTTPS address.");
            foreach (var address in addresses)
            {
                var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                try { await socket.ConnectAsync(new IPEndPoint(address, context.DnsEndPoint.Port), ct); return new NetworkStream(socket, ownsSocket: true); }
                catch (SocketException) { socket.Dispose(); }
            }
            throw new HttpRequestException("Moodle connection unavailable.");
        }
    };
}

public static class MoodleJson
{
    public static string? Text(JsonElement element, string key) => element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    public static long Number(JsonElement element, string key) => element.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out var number) ? number : 0;
}
