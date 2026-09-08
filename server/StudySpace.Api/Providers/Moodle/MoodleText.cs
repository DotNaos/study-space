using System.Net;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Providers.Moodle;

public static class MoodleText
{
    private static readonly TimeSpan Limit = TimeSpan.FromMilliseconds(250);
    private static readonly Regex Hidden = new(@"<!--.*?-->|<(script|style)\b[^>]*>.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline, Limit);
    private static readonly Regex Tags = new("<(?:\"[^\"]*\"|'[^']*'|[^'\">])*>", RegexOptions.Singleline, Limit);
    private static readonly Regex Spaces = new(@"\s+", RegexOptions.None, Limit);

    public static string Plain(string? html)
    {
        if (string.IsNullOrEmpty(html)) return "";
        try
        {
            // Remove attributes (including token-bearing href/src values) before decoding visible text.
            var visible = Tags.Replace(Hidden.Replace(html, " "), " ");
            return Spaces.Replace(WebUtility.HtmlDecode(visible), " ").Trim();
        }
        catch (RegexMatchTimeoutException)
        { throw new ApiFailure("moodle_response", "Moodle returned unsupported course text.", 502); }
    }
}
