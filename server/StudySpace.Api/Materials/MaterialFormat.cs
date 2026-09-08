using System.Text;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

public static class MaterialFormat
{
    public const int MaximumBytes = 32 * 1024 * 1024;
    public const string Profile = "local-structured-v1";
    public static string Detect(byte[] bytes, string name, string? declared)
    {
        if (bytes.AsSpan().StartsWith("%PDF-"u8)) return "application/pdf";
        if (bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return "image/png";
        if (bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 })) return "image/jpeg";
        if (bytes.AsSpan().StartsWith("GIF87a"u8) || bytes.AsSpan().StartsWith("GIF89a"u8)) return "image/gif";
        if (bytes.Length >= 12 && bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8)) return "image/webp";
        var extension = Path.GetExtension(name).ToLowerInvariant();
        if (bytes.AsSpan().StartsWith("PK\u0003\u0004"u8)) return extension switch
        {
            ".pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            _ => "application/zip"
        };
        if (extension is ".html" or ".htm" || declared?.Split(';')[0] == "text/html") return "text/html";
        if (extension is ".txt" or ".md" || declared?.Split(';')[0] == "text/plain") return "text/plain";
        return "application/octet-stream";
    }
    internal static string Text(byte[] bytes)
    {
        try
        {
            var text = new UTF8Encoding(false, true).GetString(bytes);
            if (text.Contains('\0')) throw new DecoderFallbackException();
            return text;
        }
        catch (DecoderFallbackException) { throw new ApiFailure("material_text_encoding", "This text file is not supported UTF-8 text; no binary bytes were treated as document text.", 415); }
    }
}
