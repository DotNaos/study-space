using System.Diagnostics;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;
namespace StudySpace.Api.Materials;

internal static class MaterialHtmlExtractor
{
    public static MaterialExtraction Extract(string html)
    {
        var started = Stopwatch.GetTimestamp();
        // HtmlParser parses a string only: no browsing context, network loader, script engine or renderer.
        using var document = new HtmlParser(new HtmlParserOptions { IsScripting = false }).ParseDocument(html);
        var warnings = new List<string>();
        if (document.QuerySelectorAll("iframe,object,embed,video,audio").Length > 0) warnings.Add("Embedded interactive or media content was not fetched; inspect it in the original Moodle page.");
        foreach (var hidden in document.QuerySelectorAll("script,style,form,iframe,object,embed,link,meta,base")) hidden.Remove();
        var blocks = new List<MaterialBlock>();
        var body = document.Body;
        if (body is not null) Walk(body, blocks, warnings);
        return new(blocks.ToArray(), [], [new("anglesharp-html", typeof(HtmlParser).Assembly.GetName().Version?.ToString() ?? "unknown",
            (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds, MaterialStore.Hash(html))], warnings.Distinct().ToArray(), warnings.Count == 0);
    }
    private static void Walk(INode node, List<MaterialBlock> blocks, List<string> warnings)
    {
        foreach (var child in node.ChildNodes)
        {
            if (child is IText text) { Add(blocks, "paragraph", text.Data); continue; }
            if (child is not IElement element) continue;
            var name = element.LocalName;
            if (name == "table")
            {
                var cells = element.QuerySelectorAll("tr").Select(row => row.Children.Where(cell => cell.LocalName is "td" or "th").Select(Text).ToArray()).ToArray();
                Add(blocks, "table", string.Join("\n", cells.Select(row => string.Join("\t", row))), cells);
                if (element.QuerySelectorAll("[rowspan],[colspan]").Length > 0) warnings.Add("A table uses merged cells; retain the original page when interpreting its layout.");
            }
            else if (name == "img")
            {
                Add(blocks, "image", element.GetAttribute("alt") ?? "Embedded image in the original Moodle page.");
                warnings.Add("An embedded page image remains a separate source; its visual content was not read from the HTML text.");
            }
            else if (name is "h1" or "h2" or "h3" or "h4" or "h5" or "h6" or "p" or "li" or "pre" or "blockquote")
            {
                Add(blocks, name.StartsWith('h') ? "heading" : name == "li" ? "list" : name == "pre" ? "code" : "paragraph", Text(element));
                foreach (var image in element.QuerySelectorAll("img"))
                { Add(blocks, "image", image.GetAttribute("alt") ?? "Embedded source image."); warnings.Add("An embedded page image requires its separate image source."); }
            }
            else Walk(element, blocks, warnings);
            if (element.LocalName == "a" || element.QuerySelector("a") is not null)
                warnings.Add("Linked references were retained as text but were not automatically fetched.");
        }
    }
    private static string Text(INode node) => string.Concat(node.ChildNodes.Select(child => child switch
    {
        IText text => text.Data,
        IElement element when element.LocalName == "br" => "\n",
        IElement element when element.LocalName == "sub" => "_{" + Text(element) + "}",
        IElement element when element.LocalName == "sup" => "^{" + Text(element) + "}",
        IElement element when element.LocalName == "img" => element.GetAttribute("alt") ?? "",
        IElement element => Text(element),
        _ => ""
    }));
    private static void Add(List<MaterialBlock> blocks, string kind, string text, string[][]? cells = null)
    {
        text = text.Trim(); if (text.Length == 0) return;
        blocks.Add(new($"b-{blocks.Count + 1:00000}", kind, text, blocks.Count, null, null, null, null, cells));
    }
}
