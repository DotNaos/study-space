using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
namespace StudySpace.Api.Learning;

public static class LearningImages
{
    public const int MaximumImages = 8;
    public const long MaximumBytes = 8 * 1024 * 1024;
    public static async Task<LearningImage[]> Load(LearningChunk chunk, IMaterialCatalog materials, CancellationToken ct)
    {
        ValidateSources(chunk.Images);
        var result = new List<LearningImage>(); long total = 0;
        foreach (var source in chunk.Images)
        {
            var asset = await materials.GetAsset(source.MaterialId, source.Revision, source.AssetId, ct);
            total += asset.Bytes.LongLength;
            if (total > MaximumBytes || asset.Bytes.LongLength > MaximumBytes) throw TooLarge();
            if (asset.Bytes.LongLength != source.ByteLength || MaterialStore.Hash(asset.Bytes) != source.Sha256)
                throw new ApiFailure("learning_image_damaged", "A prepared source image failed its integrity check. Reimport the material before generating.", 409);
            var mime = MaterialFormat.Detect(asset.Bytes, asset.Name, asset.MimeType);
            if (mime is not ("image/png" or "image/jpeg" or "image/webp") || mime != asset.MimeType)
                throw new ApiFailure("learning_image_unsupported", "A source image is not a supported PNG, JPEG or WebP image. It has not been silently omitted.", 415);
            result.Add(new(mime, Convert.ToBase64String(asset.Bytes)));
        }
        return result.ToArray();
    }
    public static void ValidateSources(IReadOnlyCollection<LearningImageSource> sources, bool enforceGroupLimit = true)
    {
        if (sources.Any(image => image.ByteLength is <= 0 or > MaximumBytes) || enforceGroupLimit &&
            (sources.Count > MaximumImages || sources.Sum(image => image.ByteLength) > MaximumBytes)) throw TooLarge();
    }
    public static ApiFailure TooLarge() => new("learning_images_large", "A source image or chapter exceeds the supported image size. No source images were silently omitted.", 422);
}
