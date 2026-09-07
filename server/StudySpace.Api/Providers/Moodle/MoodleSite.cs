using System.Net;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public static class MoodleSite
{
    public static Uri Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || raw.Length > 2048 || !Uri.TryCreate(raw.Trim(), UriKind.Absolute, out var site) ||
            site.Scheme != "https" || site.Port != 443 || site.UserInfo.Length > 0 || site.Query.Length > 0 || site.Fragment.Length > 0 ||
            site.HostNameType != UriHostNameType.Dns || !site.Host.Contains('.') || site.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase) ||
            site.AbsolutePath.Contains('%') || site.AbsolutePath.Contains("//"))
            throw new ApiFailure("site_invalid", "Enter the public HTTPS address of your Moodle site, including its installation path if needed.");
        return new Uri(site.AbsoluteUri.TrimEnd('/'));
    }
    public static bool IsPublic(IPAddress ip)
    {
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (IPAddress.IsLoopback(ip)) return false;
        var b = ip.GetAddressBytes();
        if (b.Length == 16) return (b[0] & 0xe0) == 0x20 && !(b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8);
        return b[0] != 0 && b[0] != 10 && b[0] != 127 && b[0] < 224 &&
            !(b[0] == 100 && b[1] >= 64 && b[1] <= 127) && !(b[0] == 169 && b[1] == 254) &&
            !(b[0] == 172 && b[1] >= 16 && b[1] <= 31) && !(b[0] == 192 && (b[1] == 168 || b[1] == 0 || b[1] == 2)) &&
            !(b[0] == 198 && (b[1] is 18 or 19 || b[1] == 51 && b[2] == 100)) && !(b[0] == 203 && b[1] == 0 && b[2] == 113);
    }
    public static (string Key, long UserId) ParseQr(string? raw, Uri intendedSite)
    {
        if (raw is null || raw.Length > 8192 || !raw.StartsWith("moodlemobile://", StringComparison.OrdinalIgnoreCase))
            throw new ApiFailure("qr_invalid", "Use the mobile-app login QR code from your Moodle profile.");
        var decoded = Uri.UnescapeDataString(raw[15..].Trim());
        decoded = Regex.Replace(decoded, "^https//", "https://", RegexOptions.IgnoreCase);
        if (!Uri.TryCreate(decoded, UriKind.Absolute, out var uri)) throw new ApiFailure("qr_invalid", "The Moodle QR code is invalid.");
        var root = Parse(uri.GetLeftPart(UriPartial.Path));
        if (root != intendedSite) throw new ApiFailure("qr_site_mismatch", "This QR code belongs to a different Moodle site.");
        var query = QueryHelpers.ParseQuery(uri.Query);
        if (!query.TryGetValue("qrlogin", out var key) || key.Count != 1 || !Regex.IsMatch(key.ToString(), "^[a-zA-Z0-9_-]{16,256}$") ||
            !query.TryGetValue("userid", out var user) || user.Count != 1 || !long.TryParse(user, out var id) || id <= 0)
            throw new ApiFailure("qr_invalid", "Use a fresh mobile-app login QR code from your Moodle profile.");
        return (key.ToString(), id);
    }
}
