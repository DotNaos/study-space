using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.DependencyInjection;
using StudySpace.Api.Learning;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

public sealed class PipelineMappingBoardTests
{
    private const string Path = "/api/pipeline/courses/7";

    [Fact] public async Task HiddenStructureMakesUnreviewedSourcesInheritedHiddenAndUnhideReopensThem()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client();
        var initial = (await client.GetFromJsonAsync<PipelineView>(Path))!;
        var general = initial.SuggestedUnits.Single(unit => unit.SourceGroupId == 10) with { Hidden = true };
        var week = initial.SuggestedUnits.Single(unit => unit.SourceGroupId == 20);
        var response = await client.PutAsJsonAsync(Path + "/structure", new PlanStructureRequest(0, [general, week], "Hide organization"));
        response.EnsureSuccessStatusCode();
        var hidden = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        Assert.Equal("structure-hidden", hidden.Sources.Single(item => item.Source.Id == WorkflowApiFixture.Id('a')).Status);
        Assert.Equal(3, hidden.Pending);

        response = await client.PutAsJsonAsync(Path + "/structure", new PlanStructureRequest(hidden.Revision, [general with { Hidden = false }, week], "Restore"));
        response.EnsureSuccessStatusCode();
        var restored = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        Assert.Equal("pending", restored.Sources.Single(item => item.Source.Id == WorkflowApiFixture.Id('a')).Status);
    }

    [Fact] public async Task ExplicitVisibleMappingOverridesHiddenSourceContainer()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client();
        var initial = (await client.GetFromJsonAsync<PipelineView>(Path))!;
        var general = initial.SuggestedUnits.Single(unit => unit.SourceGroupId == 10) with { Hidden = true };
        var week = initial.SuggestedUnits.Single(unit => unit.SourceGroupId == 20);
        var response = await client.PutAsJsonAsync(Path + "/structure", new PlanStructureRequest(0, [general, week], "Reviewed structure"));
        response.EnsureSuccessStatusCode(); var plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        response = await client.PostAsJsonAsync(Path + "/mapping", new PlanMappingRequest(plan.Revision,
            [new(WorkflowApiFixture.Id('a'), WorkflowApiFixture.Id('f'), "use", [new(week.Id, "teaching", Order: 0)])]));
        response.EnsureSuccessStatusCode(); plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        var source = plan.Sources.Single(item => item.Source.Id == WorkflowApiFixture.Id('a'));
        Assert.Equal("reviewed", source.Status); Assert.Equal(week.Id, source.Decision!.Uses.Single().UnitId);
    }

    [Fact] public async Task BatchMappingIsAtomicCasProtectedAndUsesOneRevision()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client();
        var initial = (await client.GetFromJsonAsync<PipelineView>(Path))!;
        var unit = initial.SuggestedUnits.Single(value => value.SourceGroupId == 20);
        var response = await client.PutAsJsonAsync(Path + "/structure", new PlanStructureRequest(0, [unit], "Week"));
        response.EnsureSuccessStatusCode(); var plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        var beforeRevision = plan.Revision;
        response = await client.PostAsJsonAsync(Path + "/mapping", new PlanMappingRequest(plan.Revision,
            [new(WorkflowApiFixture.Id('b'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "task", Order: 0)]),
             new(WorkflowApiFixture.Id('c'), WorkflowApiFixture.Id('e'), "use", [new(unit.Id, "support", Order: 1)])]));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        plan = (await client.GetFromJsonAsync<PipelineView>(Path))!;
        Assert.Null(plan.Sources.Single(item => item.Source.Id == WorkflowApiFixture.Id('b')).Decision);

        response = await client.PostAsJsonAsync(Path + "/mapping", new PlanMappingRequest(plan.Revision,
            [new(WorkflowApiFixture.Id('b'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "task", Order: 1)]),
             new(WorkflowApiFixture.Id('c'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "support", Order: 2)])]));
        response.EnsureSuccessStatusCode(); plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        Assert.Equal(beforeRevision + 1, plan.Revision);
        Assert.Equal(2, plan.History.Count(item => item.Action == "mapping"));
        Assert.Equal([1,2], plan.Sources.Where(item => item.Source.Id is var id && (id == WorkflowApiFixture.Id('b') || id == WorkflowApiFixture.Id('c')))
            .Select(item => item.Decision!.Uses.Single().Order).Order().ToArray());
        var mappedRevision = plan.Revision; var mappedHistory = plan.History.Length;
        response = await client.PostAsJsonAsync(Path + "/mapping", new PlanMappingRequest(plan.Revision,
            [new(WorkflowApiFixture.Id('b'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "task", Order: 1)]),
             new(WorkflowApiFixture.Id('c'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "support", Order: 2)])]));
        response.EnsureSuccessStatusCode(); plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        Assert.Equal(mappedRevision, plan.Revision); Assert.Equal(mappedHistory, plan.History.Length);
        var stale = await client.PostAsJsonAsync(Path + "/mapping", new PlanMappingRequest(beforeRevision,
            [new(WorkflowApiFixture.Id('b'), WorkflowApiFixture.Id('f'), "exclude", [])]));
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
    }

    [Fact] public async Task ReviewedSourceOrderControlsGenerationWithinAUnit()
    {
        using var fixture = new WorkflowApiFixture(); using var client = fixture.Client();
        var initial = (await client.GetFromJsonAsync<PipelineView>(Path))!;
        var unit = initial.SuggestedUnits.Single(value => value.SourceGroupId == 20);
        var response = await client.PutAsJsonAsync(Path + "/structure", new PlanStructureRequest(0, [unit], "Week"));
        response.EnsureSuccessStatusCode(); var plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        response = await client.PostAsJsonAsync(Path + "/mapping", new PlanMappingRequest(plan.Revision,
            [new(WorkflowApiFixture.Id('a'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "teaching", Order: 20)]),
             new(WorkflowApiFixture.Id('b'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "task", Order: 10)]),
             new(WorkflowApiFixture.Id('c'), WorkflowApiFixture.Id('f'), "use", [new(unit.Id, "support", Order: 0)])]));
        response.EnsureSuccessStatusCode(); plan = (await response.Content.ReadFromJsonAsync<PipelineView>())!;
        var service = fixture.Factory.Services.GetRequiredService<PipelineService>();
        var snapshot = await fixture.CatalogData.GetSnapshot(7);
        var selected = await service.SelectRun(7, plan.Revision, snapshot, true, default);
        Assert.Equal([WorkflowApiFixture.Id('b'), WorkflowApiFixture.Id('a')], selected.Inputs.Select(input => input.MaterialId));
    }
}
