using AngleSharp.Html.Parser;
using System.Text.RegularExpressions;
using StudySpace.Api.Infrastructure;

namespace StudySpace.Api.Providers.Moodle;

// Rich Moodle text is normalized on the server. No HTML, executable content or
// token-bearing href/src attributes leave this boundary.
public static class MoodleActivityContent
{
    public static string Text(string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return "";
        if (html.Length > 512 * 1024) throw new ApiFailure("moodle_response", "Activity text is too large to display.", 502);
        var document = new HtmlParser().ParseDocument(html);
        foreach (var node in document.QuerySelectorAll("script,style,template,form,iframe,object,embed")) node.Remove();
        foreach (var node in document.QuerySelectorAll("br")) node.Replace(document.CreateTextNode("\n"));
        foreach (var node in document.QuerySelectorAll("p,div,li,h1,h2,h3,h4,h5,h6,tr,pre,blockquote")) node.AppendChild(document.CreateTextNode("\n\n"));
        foreach (var node in document.QuerySelectorAll("td,th")) node.AppendChild(document.CreateTextNode("\t"));
        foreach (var image in document.QuerySelectorAll("img")) image.Replace(document.CreateTextNode(image.GetAttribute("alt") is { Length: >0 } alt ? $"[Bild: {alt}]" : "[Bild]"));
        var text = document.Body?.TextContent ?? "";
        text = Regex.Replace(text, @"[^\S\n]+", " ", RegexOptions.None, TimeSpan.FromMilliseconds(250));
        return Regex.Replace(text, @"\n\s*\n(?:\s*\n)*", "\n\n", RegexOptions.None, TimeSpan.FromMilliseconds(250)).Trim();
    }
}
