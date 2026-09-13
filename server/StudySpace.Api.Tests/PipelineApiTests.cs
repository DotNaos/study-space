using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using StudySpace.Api.Learning;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

public sealed class PipelineApiTests
{
    private const string Path = "/api/pipeline/courses/7";
    [Fact] public async Task ReadOnlyInventoryDoesNotPersistOrGenerateAndIncludesEmptyAndInlineGroups()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client();
        var state = await client.GetFromJsonAsync<PipelineView>(Path);
        Assert.Equal(4, state!.Groups.Length); Assert.Equal(4, state.Sources.Length); Assert.Equal(0, state.Revision);
        Assert.Equal(0, fixture.ModelData.Calls); Assert.False(state.Persisted);
        Assert.Equal(409, (int)(await client.PostAsJsonAsync("/api/learning/courses/7/generate", new GenerateRequest(WorkflowApiFixture.Id('e'), true, true))).StatusCode);
        Assert.Equal(0, fixture.ModelData.Calls);
    }
    [Fact] public async Task ReviewedGenerationFreezesIntentAndLeavesExistingScriptAndAnswersActive()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client(); await fixture.Seed();
        var plan = await Confirm(client);
        var response = await client.PostAsJsonAsync("/api/learning/courses/7/generate", new GenerateRequest(WorkflowApiFixture.Id('e'), true, true, plan.Revision));
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        await fixture.Process();
        var state = await client.GetFromJsonAsync<LearningState>("/api/learning/courses/7");
        Assert.Equal("completed", state!.Job!.Status); Assert.Equal(WorkflowApiFixture.InitialVersion, state.ActiveVersionId);
        Assert.Equal("Frühere Antwort bleibt erhalten.", state.Drafts[WorkflowApiFixture.DuplicateId]);
        var candidate = await client.GetFromJsonAsync<LearningVersion>($"/api/learning/courses/7/versions/{state.Job.CandidateVersionId}");
        Assert.Equal(plan.Revision, candidate!.PlanRevision); Assert.Single(candidate.Sections); Assert.Equal("mdx", candidate.Sections[0].Format);
        Assert.Equal(WorkflowApiFixture.UnitId, candidate.Sections[0].UnitId); Assert.Single(candidate.Exercises); Assert.Single(candidate.PendingSolutions!);
        Assert.Equal("Bestätigtes Fachkapitel", candidate.Sections[0].Title); Assert.Equal(3, candidate.UseDecisions!.Count(decision => decision.Disposition == "use"));
        Assert.Equal(3, fixture.ModelData.Calls);
    }
    [Fact] public async Task NewAndChangedSourcesReopenReviewButNotTheLearningStructure()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client(); var plan = await Confirm(client);
        fixture.InventoryData.Change = 1;
        var state = await client.GetFromJsonAsync<PipelineView>(Path);
        Assert.Equal("stale", state!.Sources.Single(item => item.Source.Id == WorkflowApiFixture.Id('a')).Status);
        Assert.Equal("reviewed", state.Sources.Single(item => item.Source.Id == WorkflowApiFixture.Id('b')).Status);
        Assert.Equal("pending", state.Sources.Single(item => item.Source.Id == WorkflowApiFixture.Id('9')).Status);
        Assert.Equal(plan.Units, state.Units);
        var stale = await client.PostAsJsonAsync(Path + "/decisions", new PlanDecisionRequest(plan.Revision, WorkflowApiFixture.Id('a'), WorkflowApiFixture.Id('f'), "use", [new(WorkflowApiFixture.UnitId, "teaching")], "Old source"));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        fixture.InventoryData.Offline = true; state = await client.GetFromJsonAsync<PipelineView>(Path);
        Assert.NotNull(state!.Problem); Assert.Contains(state.Sources, item => item.Source.Id == WorkflowApiFixture.Id('a'));
    }
    [Fact] public async Task NewWritesStillRejectForeignOriginsAndStaleActivation()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client(); await fixture.Seed();
        client.DefaultRequestHeaders.Remove("Origin"); client.DefaultRequestHeaders.Add("Origin", "https://other.test");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(Path + "/sync", new PlanSyncRequest(0))).StatusCode);
        client.DefaultRequestHeaders.Remove("Origin"); client.DefaultRequestHeaders.Add("Origin", "http://127.0.0.1:18168");
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/learning/courses/7/activate", new ActivateVersionRequest(WorkflowApiFixture.InitialVersion, null, true))).StatusCode);
    }
    [Fact] public async Task MdxEditAndExportUseRealApiAndDoNotActivateTheCandidate()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client(); await fixture.Seed();
        var content = "# New\n\n<TaskRef id=\"" + WorkflowApiFixture.TaskId + "\" />";
        var response = await client.PutAsJsonAsync($"/api/learning/courses/7/sections/{WorkflowApiFixture.SectionId}", new SectionEditRequest(WorkflowApiFixture.InitialVersion, WorkflowApiFixture.InitialVersion, "New", content, "Add linked task"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var candidate = await response.Content.ReadFromJsonAsync<LearningVersion>();
        var exported = await client.GetAsync($"/api/learning/courses/7/versions/{candidate!.Id}/sections/{WorkflowApiFixture.SectionId}/mdx");
        Assert.Equal(content, await exported.Content.ReadAsStringAsync()); Assert.Contains(".mdx", exported.Content.Headers.ContentDisposition!.ToString());
        Assert.Equal(WorkflowApiFixture.InitialVersion, (await client.GetFromJsonAsync<LearningState>("/api/learning/courses/7"))!.ActiveVersionId);
    }
    public static async Task<PipelineView> Confirm(HttpClient client)
    {
        var response = await client.PutAsJsonAsync(Path + "/structure", new PlanStructureRequest(0, [new(WorkflowApiFixture.UnitId, "Bestätigtes Fachkapitel", null, 0)], "Independent of Moodle folders"));
        response.EnsureSuccessStatusCode(); var plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        foreach (var (id, role) in new[] { ('a', "teaching"), ('b', "task"), ('c', "solution"), ('d', "exclude") })
        {
            response = await client.PostAsJsonAsync(Path + "/decisions", new PlanDecisionRequest(plan.Revision, WorkflowApiFixture.Id(id), WorkflowApiFixture.Id('f'), role == "exclude" ? "exclude" : "use",
                role == "exclude" ? [] : [new(WorkflowApiFixture.UnitId, role, RelatedSourceId: role == "solution" ? WorkflowApiFixture.Id('b') : null)], "Inspected fixture source"));
            response.EnsureSuccessStatusCode(); plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        }
        return plan;
    }
}
