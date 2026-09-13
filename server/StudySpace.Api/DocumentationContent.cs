using Microsoft.AspNetCore.StaticFiles;

namespace StudySpace.Api;

// Serves only the build-produced docs subtree. Application API origin/auth rules are unchanged.
internal static class DocumentationContent
{
    internal static async Task Serve(HttpContext context, string root, string allowedOrigin)
    {
        var response = context.Response;
        response.Headers.Vary = "Origin";
        response.Headers.CacheControl = "no-store";
        response.Headers.XContentTypeOptions = "nosniff";
        var origin = context.Request.Headers.Origin.ToString();
        if (!Uri.TryCreate(allowedOrigin, UriKind.Absolute, out var allowed) ||
            allowed.Scheme is not ("https" or "http") || allowed.GetLeftPart(UriPartial.Authority) != allowedOrigin ||
            allowed.UserInfo.Length > 0 || (origin.Length > 0 && origin != allowedOrigin))
        { response.StatusCode = 403; return; }
        if (origin == allowedOrigin) response.Headers.AccessControlAllowOrigin = allowedOrigin;
        response.Headers.AccessControlAllowMethods = "GET, HEAD, OPTIONS";
        if (HttpMethods.IsOptions(context.Request.Method)) { response.StatusCode = 204; return; }
        if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        { response.StatusCode = 405; return; }
        var path = context.Request.Path.Value ?? "";
        var relative = path.StartsWith("/docs-content/", StringComparison.Ordinal) ? path[14..] : "";
        var segments = relative.Split('/');
        if (context.Request.QueryString.HasValue || segments.Any(segment => segment.Length == 0 || segment.StartsWith('.') ||
            segment.Trim() != segment || segment.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '_' or ' ' or '.' or '-'))))
        { response.StatusCode = 404; return; }
        var file = Path.Combine(root, "docs-content");
        foreach (var segment in new[] { "" }.Concat(segments))
        {
            file = Path.Combine(file, segment);
            if ((!File.Exists(file) && !Directory.Exists(file)) || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
            { response.StatusCode = 404; return; }
        }
        var extension = Path.GetExtension(file).ToLowerInvariant();
        if (!File.Exists(file) || extension is not (".json" or ".md" or ".markdown" or ".mdx" or ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".avif"))
        { response.StatusCode = 404; return; }
        var types = new FileExtensionContentTypeProvider();
        response.ContentType = extension is ".md" or ".markdown" or ".mdx" ? "text/plain; charset=utf-8" :
            types.TryGetContentType(file, out var contentType) ? contentType : "application/octet-stream";
        response.ContentLength = new FileInfo(file).Length;
        if (HttpMethods.IsGet(context.Request.Method)) await response.SendFileAsync(file, context.RequestAborted);
    }
}
