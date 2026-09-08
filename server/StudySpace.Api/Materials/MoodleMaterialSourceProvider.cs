using System.Text;
using System.Text.Json;
using AngleSharp.Html.Parser;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;
namespace StudySpace.Api.Materials;

public sealed class MoodleMaterialSourceProvider(MoodleService moodle, CredentialStore credentials, MoodleFileService files) : IMaterialSourceProvider
{
    public async Task<MaterialInventory> Inventory(long courseId, CancellationToken ct)
    {
        var credential = await credentials.Read() ?? throw new ApiFailure("moodle_disconnected", "Connect Moodle before importing a course.", 409);
        var scope = Scope(credential);
        var raw = await moodle.AuthorizedContents(credential, courseId, ct, freshEnrollment: true);
        var sections = MoodleCourseContents.Parse(raw, MoodleSite.Parse(credential.SiteUrl), courseId);
        var sources = new List<MaterialSource>();
        var sectionIndex = 0;
        foreach (var rawSection in raw.EnumerateArray())
        {
            var section = sections[sectionIndex++];
            AddText(sources, scope, courseId, section.Id, section.Name, null, section.Name, "section-summary", MoodleJson.Text(rawSection, "summary"));
            if (!rawSection.TryGetProperty("modules", out var modules)) continue;
            var moduleIndex = 0;
            foreach (var rawModule in modules.EnumerateArray())
            {
                var module = section.Modules[moduleIndex++];
                var before = sources.Count;
                AddText(sources, scope, courseId, section.Id, section.Name, module.Id, module.Name, "module-description", MoodleJson.Text(rawModule, "description"));
                if (rawModule.TryGetProperty("contents", out var contents))
                {
                    var resourceIndex = 0;
                    foreach (var rawResource in contents.EnumerateArray())
                    {
                        var resource = module.Resources[resourceIndex++];
                        var path = MoodleJson.Text(rawResource, "filepath") ?? "/";
                        var key = $"module:{module.Id}:content:{resource.Type}:{path}:{resource.Name}";
                        var kind = resource.Type == "file" ? "file" : "reference";
                        var reason = kind == "file" && resource.Id is not null ? null : resource.Type == "url"
                            ? "This linked source has not been retrieved; it may require separate access in Moodle."
                            : "This source does not provide a safely downloadable file through the Moodle connection.";
                        sources.Add(new(MaterialStore.Hash(scope + ":" + courseId + ":" + key), scope, courseId, section.Id, section.Name,
                            module.Id, resource.Name, kind, resource.MimeType, resource.Id, null, reason));
                    }
                }
                if (sources.Count == before)
                    sources.Add(new(MaterialStore.Hash(scope + ":" + courseId + ":module:" + module.Id), scope, courseId, section.Id, section.Name,
                        module.Id, module.Name, "activity", null, null, null,
                        "This Moodle activity has no exported document or text. Open it in Moodle to check its learning content."));
            }
        }
        if (await credentials.Read() != credential) throw Changed();
        // Duplicate filenames in a provider response must never overwrite another source silently.
        if (sources.GroupBy(source => source.Id).Any(group => group.Count() > 1))
            throw new ApiFailure("material_inventory_ambiguous", "Moodle returned duplicate material identities. The previous import is preserved.", 502);
        return new(scope, sources.ToArray());
    }

    public async Task<MaterialInput> Read(MaterialSource source, CancellationToken ct)
    {
        var before = await credentials.Read();
        if (before is null || Scope(before) != source.ProviderScope) throw Changed();
        if (source.InlineText is not null) return new(Encoding.UTF8.GetBytes(source.InlineText), "text/html", source.Name + ".html");
        if (source.ModuleId is null || source.ResourceId is null) throw new ApiFailure("material_unsupported", source.UnavailableReason ?? "This source cannot be imported.", 415);
        var result = await files.Get(source.CourseId, source.ModuleId.Value, source.ResourceId, false, ct);
        if (await credentials.Read() != before) throw Changed();
        return new(result.Bytes, MaterialFormat.Detect(result.Bytes, source.Name, source.MimeType), source.Name);
    }
    private static void AddText(List<MaterialSource> sources, string scope, long courseId, long sectionId, string sectionName,
        long? moduleId, string name, string part, string? html)
    {
        if (string.IsNullOrWhiteSpace(html)) return;
        var document = new HtmlParser().ParseDocument(html);
        foreach (var active in document.QuerySelectorAll("script,style,iframe,object,embed,form")) active.Remove();
        var key = moduleId is null ? $"section:{sectionId}:{part}" : $"module:{moduleId}:{part}";
        var links = document.QuerySelectorAll("a[href],img[src]").ToArray();
        for (var index = 0; index < links.Length; index++)
        {
            var link = links[index];
            var label = MoodleText.Plain(link.TextContent) ?? "";
            if (string.IsNullOrWhiteSpace(label)) label = MoodleText.Plain(link.GetAttribute("alt")) ?? "";
            if (string.IsNullOrWhiteSpace(label)) label = link.LocalName == "img" ? "Embedded image" : "Linked source";
            sources.Add(new(MaterialStore.Hash(scope + ":" + courseId + ":" + key + ":reference:" + index), scope, courseId,
                sectionId, sectionName, moduleId, label, "reference", null, null, null,
                "This embedded source has not been retrieved; open the original Moodle activity to check it."));
        }
        // Provider URLs can contain temporary Moodle access keys. Keep structure and labels only.
        foreach (var element in document.QuerySelectorAll("*"))
            foreach (var attribute in element.Attributes.ToArray())
                if (attribute.Name is not ("alt" or "rowspan" or "colspan")) element.RemoveAttribute(attribute.Name);
        var text = MoodleText.Plain(document.Body?.TextContent);
        if (string.IsNullOrWhiteSpace(text)) return;
        sources.Add(new(MaterialStore.Hash(scope + ":" + courseId + ":" + key), scope, courseId, sectionId, sectionName,
            moduleId, name, "text", "text/html", null, document.Body?.InnerHtml ?? html, null));
    }

    private static string Scope(MoodleCredential credential) => MaterialStore.Hash("moodle:" + credential.SiteUrl + ":" + credential.UserId);
    private static ApiFailure Changed() => new("moodle_connection_changed", "The Moodle connection changed. Start a fresh import for the current account.", 409);
}
