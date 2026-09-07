using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.WebUtilities;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public static class MoodleBrowserReturn
{
    public const string Scheme = "web+studyspace";
    public static string Token(string? callback, Uri site, string passport)
    {
        if (callback is null || callback.Length > 4096) throw Invalid();
        var match = Regex.Match(callback, "^web\\+studyspace://token=([a-zA-Z0-9%+/_=-]+)$", RegexOptions.CultureInvariant);
        if (!match.Success) throw Invalid();
        string payload;
        try { payload = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(Uri.UnescapeDataString(match.Groups[1].Value).Replace('+', '-').Replace('/', '_').TrimEnd('='))); }
        catch (FormatException) { throw Invalid(); }
        var parts = payload.Split(":::", StringSplitOptions.None);
        if (parts.Length is < 2 or > 3 || !Regex.IsMatch(parts[0], "^[a-f0-9]{32}$") || !Regex.IsMatch(parts[1], "^[a-zA-Z0-9]{16,256}$")) throw Invalid();
        // MD5 is Moodle's wire-format correlation digest, not password protection or our token generator.
        var expected = MD5.HashData(Encoding.UTF8.GetBytes(site.AbsoluteUri.TrimEnd('/') + passport));
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(parts[0]), expected))
            throw new ApiFailure("login_signature_mismatch", "This Moodle return does not match the connection you started. Start again.");
        return parts[1]; // Private auto-login token, when supplied by Moodle, is deliberately discarded.
    }
    private static ApiFailure Invalid() => new("login_callback_invalid", "Moodle did not return a valid Study Space browser login. Start again, or use QR login.");
}
