using System.Diagnostics;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

public sealed class MaterialExtractor(MaterialStore store, MaterialToolRunner tools) : IMaterialExtractor
{
    public async Task<MaterialExtraction> Extract(MaterialInput input, CancellationToken ct)
    {
        if (input.Bytes.Length > MaterialFormat.MaximumBytes) throw new ApiFailure("material_too_large", "This material exceeds the supported extraction size.", 413);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct); timeout.CancelAfter(TimeSpan.FromMinutes(8));
        var directory = store.TemporaryDirectory();
        try
        {
            var type = MaterialFormat.Detect(input.Bytes, input.Name, input.MimeType);
            var result = type switch
            {
                "application/pdf" => await new MaterialPdfExtractor(tools).Extract(input.Bytes, directory, timeout.Token),
                "image/png" or "image/jpeg" or "image/gif" or "image/webp" => await new MaterialPdfExtractor(tools).Image(input, directory, timeout.Token),
                "application/vnd.openxmlformats-officedocument.presentationml.presentation" => MaterialOfficeExtractor.Presentation(input.Bytes),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => MaterialOfficeExtractor.Document(input.Bytes),
                "text/html" => MaterialHtmlExtractor.Extract(MaterialFormat.Text(input.Bytes)),
                "text/plain" => Plain(input.Bytes),
                _ => throw new ApiFailure("material_unsupported", "This file format does not yet have a local extraction adapter. Its original copy is preserved; open it in Moodle for now.", 415)
            };
            timeout.Token.ThrowIfCancellationRequested();
            if (result.Assets.Length > 300 || result.Assets.Sum(asset => (long)asset.Bytes.Length) > 128 * 1024 * 1024)
                throw new ApiFailure("material_assets_large", "This material produced too many source images to process within the current limit.", 413);
            return result;
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new ApiFailure("material_engine_timeout", "This material exceeded the eight-minute extraction limit. Existing results are preserved.", 504); }
        finally { Directory.Delete(directory, recursive: true); }
    }
    private static MaterialExtraction Plain(byte[] bytes)
    {
        var started = Stopwatch.GetTimestamp(); var text = MaterialFormat.Text(bytes).Trim();
        var blocks = text.Split(["\r\n\r\n", "\n\n"], StringSplitOptions.RemoveEmptyEntries).Select((part, index) =>
            new MaterialBlock($"b-{index + 1:00000}", "paragraph", part.Trim(), index, null, null, null)).ToArray();
        return new(blocks, [], [new("utf8-text", "1", (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds, MaterialStore.Hash(bytes))], [], true);
    }
}
