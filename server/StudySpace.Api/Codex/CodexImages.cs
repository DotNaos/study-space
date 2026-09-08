namespace StudySpace.Api.Codex;

public static class CodexImages
{
    public const int MaximumCount = 8;
    public const int MaximumBytes = 8 * 1024 * 1024;
    public const int MaximumEncodedCharacters = ((MaximumBytes + 2) / 3) * 4;

    public static IReadOnlyList<CodexImage> Validate(IReadOnlyList<CodexImage>? images)
    {
        if (images is null || images.Count == 0) return [];
        if (images.Count > MaximumCount) throw Invalid();
        var validated = new List<CodexImage>(images.Count);
        var total = 0;
        foreach (var image in images)
        {
            if (image is null || image.MimeType is not ("image/png" or "image/jpeg" or "image/webp") ||
                string.IsNullOrEmpty(image.Base64) || image.Base64.Length > MaximumEncodedCharacters || image.Base64.Any(char.IsWhiteSpace)) throw Invalid();
            byte[] bytes;
            try { bytes = Convert.FromBase64String(image.Base64); }
            catch (FormatException) { throw Invalid(); }
            total += bytes.Length;
            if (total > MaximumBytes || !Matches(image.MimeType, bytes)) throw Invalid();
            // Canonical base64 makes these inline image bytes, never a remote URL or local path.
            validated.Add(new(image.MimeType, Convert.ToBase64String(bytes)));
        }
        return validated;
    }

    private static bool Matches(string mime, ReadOnlySpan<byte> bytes) => mime switch
    {
        "image/png" => bytes.StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        "image/jpeg" => bytes.StartsWith(new byte[] { 255, 216, 255 }),
        "image/webp" => bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8),
        _ => false
    };

    private static ArgumentException Invalid() => new("Send at most eight inline PNG, JPEG or WebP images, totalling no more than 8 MiB.");
}
