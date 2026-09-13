using System.Net;
using System.Net.Http.Json;
using StudySpace.Api.Learning;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

public sealed class StructureEditorApiTests
{
    private const string Path="/api/pipeline/courses/7";
    [Fact] public async Task LabelsVisibilityAndLinksPersistWithoutChangingSourcesOrLearnerWork()
    {
        using var fixture=new WorkflowApiFixture();using var client=fixture.Client();await fixture.Seed();
        var initial=(await client.GetFromJsonAsync<PipelineView>(Path))!;
        var script=initial.SuggestedUnits[0] with {CustomTitle="Introduction",Kind="script"};
        var tasks=initial.SuggestedUnits[1] with {Kind="tasks",ParentId=null,ScriptUnitIds=[script.Id]};
        var response=await client.PutAsJsonAsync(Path+"/structure",new PlanStructureRequest(0,[script,tasks],"Separate script and tasks"));response.EnsureSuccessStatusCode();
        var saved=(await response.Content.ReadFromJsonAsync<PipelineView>())!;
        Assert.Equal("Introduction",saved.Units[0].CustomTitle);Assert.Equal(initial.Groups,saved.Groups);
        response=await client.PutAsJsonAsync(Path+"/structure",new PlanStructureRequest(saved.Revision,[tasks],"Hide without deleting"));response.EnsureSuccessStatusCode();
        saved=(await response.Content.ReadFromJsonAsync<PipelineView>())!;
        Assert.Equal(2,saved.Units.Length);Assert.True(saved.Units.Single(unit=>unit.Id==script.Id).Hidden);
        Assert.Equal(script.Id,Assert.Single(saved.Units.Single(unit=>unit.Id==tasks.Id).ScriptUnitIds!));
        response=await client.PutAsJsonAsync(Path+"/structure",new PlanStructureRequest(saved.Revision,saved.Units.Select(unit=>unit with {Hidden=false}).ToArray(),"Restore"));response.EnsureSuccessStatusCode();
        var restored=(await client.GetFromJsonAsync<PipelineView>(Path))!;Assert.All(restored.Units,unit=>Assert.False(unit.Hidden));
        Assert.Equal(initial.Sources.Select(item=>item.Source),restored.Sources.Select(item=>item.Source));
        Assert.Equal(HttpStatusCode.Conflict,(await client.PutAsJsonAsync(Path+"/structure",new PlanStructureRequest(0,[script],"Stale client"))).StatusCode);
        var learning=(await client.GetFromJsonAsync<LearningState>("/api/learning/courses/7"))!;
        Assert.Equal(WorkflowApiFixture.InitialVersion,learning.ActiveVersionId);Assert.Single(learning.Versions);
        Assert.Equal("Frühere Antwort bleibt erhalten.",learning.Drafts[WorkflowApiFixture.DuplicateId]);Assert.Equal(0,fixture.ModelData.Calls);
    }
    [Fact] public async Task HiddenUnitsDoNotGenerateOrDiscardReviewedSourceUse()
    {
        using var fixture=new WorkflowApiFixture();using var client=fixture.Client();await fixture.Seed();
        var plan=await PipelineApiTests.Confirm(client);
        var response=await client.PutAsJsonAsync(Path+"/structure",new PlanStructureRequest(plan.Revision,plan.Units.Select(unit=>unit with {Hidden=true}).ToArray(),"Hide this learning unit"));response.EnsureSuccessStatusCode();
        plan=(await response.Content.ReadFromJsonAsync<PipelineView>())!;
        Assert.Equal(3,plan.Sources.Count(item=>item.Decision?.Disposition=="use"));
        response=await client.PostAsJsonAsync("/api/learning/courses/7/generate",new GenerateRequest(WorkflowApiFixture.Id('e'),true,true,plan.Revision));
        Assert.Equal(HttpStatusCode.Conflict,response.StatusCode);Assert.Contains("pipeline_no_inputs",await response.Content.ReadAsStringAsync());Assert.Equal(0,fixture.ModelData.Calls);
    }
}
