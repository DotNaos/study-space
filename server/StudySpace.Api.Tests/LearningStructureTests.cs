using System.Text.Json;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Materials;
using StudySpace.Api.Pipeline;
namespace StudySpace.Api.Tests;

public sealed class LearningStructureTests
{
    private static readonly PipelineUnit Script = new(new('a',32),"Block 1",null,0,"script");
    private static readonly PipelineUnit Tasks = new(new('b',32),"Aufgabe 1",null,0,"tasks",ScriptUnitIds:[Script.Id]);
    [Fact] public void SeparateListsHaveIndependentOrderAndManyToManyLinks()
    {
        var second=Script with {Id=new('c',32),Order=1};
        PipelineService.ValidateUnits([Script,second,Tasks with {ScriptUnitIds=[Script.Id,second.Id]}]);
        Assert.Throws<ApiFailure>(()=>PipelineService.ValidateUnits([Script,Tasks with {ParentId=Script.Id}]));
        Assert.Throws<ApiFailure>(()=>PipelineService.ValidateUnits([Script,Tasks with {ScriptUnitIds=[Tasks.Id]}]));
        Assert.Throws<ApiFailure>(()=>PipelineService.ValidateUnits([Script with {ScriptUnitIds=[Tasks.Id]},Tasks]));
    }
    [Fact] public void OriginalNameIsReadonlyAndCustomNameSurvivesSourceRename()
    {
        PipelineGroup[] groups=[new(10,"Original Moodle title",0)];
        var unit=Script with {Title=groups[0].Title,SourceGroupId=10,CustomTitle="Short English title"};
        var changed=LearningStructure.Apply(7,[unit],[unit with {Title="Client cannot overwrite Moodle"}],groups).Single();
        Assert.Equal(groups[0].Title,changed.Title);Assert.Equal(unit.CustomTitle,changed.CustomTitle);
        var renamed=LearningStructure.Normalize(7,[changed],[new(10,"New provider title",0)]).Single();
        Assert.Equal("New provider title",renamed.Title);Assert.Equal("Short English title",LearningStructure.DisplayTitle(renamed));
        var reset=LearningStructure.Apply(7,[changed],[changed with {CustomTitle=null}],groups).Single();
        Assert.Equal(groups[0].Title,LearningStructure.DisplayTitle(reset));
    }
    [Fact] public void LegacyCustomTitlesArePreservedWithoutChangingObservedGroups()
    {
        PipelineGroup[] groups=[new(10,"Moodle title",0)];
        var legacy=new PipelineUnit(MaterialStore.Hash("unit:7:10")[..32],"Earlier user label",null,0);
        var projected=LearningStructure.Normalize(7,[legacy],groups).Single();
        Assert.Equal("Moodle title",projected.Title);Assert.Equal("Earlier user label",projected.CustomTitle);
        Assert.Equal(10,projected.SourceGroupId);Assert.Null(legacy.SourceGroupId);
    }
    [Fact] public void MissingEntriesAreRetainedHiddenAndRestorable()
    {
        var child=Script with {Id=new('c',32),ParentId=Script.Id};
        var stored=LearningStructure.Apply(7,[Script,Tasks,child],[Tasks],[]);
        Assert.Equal(3,stored.Length);Assert.True(stored.Single(unit=>unit.Id==Script.Id).Hidden);
        Assert.Equal(Script.Id,stored.Single(unit=>unit.Id==child.Id).ParentId);
        Assert.Contains(Script.Id,stored.Single(unit=>unit.Id==Tasks.Id).ScriptUnitIds!);
        var restored=LearningStructure.Apply(7,stored,stored.Select(unit=>unit with {Hidden=false}).ToArray(),[]);
        Assert.All(restored,unit=>Assert.False(unit.Hidden));
    }
    [Fact] public void HidingParentDoesNotDestroyChildVisibilityState()
    {
        var parent=Script with {Hidden=true};var child=Script with {Id=new('c',32),ParentId=Script.Id,Hidden=false};
        Assert.True(LearningStructure.IsHidden(child,[parent,child]));
        Assert.False(LearningStructure.IsHidden(child,[parent with {Hidden=false},child]));
        Assert.False(child.Hidden);
    }
    [Fact] public void SuggestionsSeparateTaskSubsectionsButApproveNothing()
    {
        PipelineGroup[] groups=[new(10,"Block 1",0),new(20,"Aufgabe 1 – Projekt",1,10)];
        var units=LearningStructure.Suggestions(7,groups);
        Assert.Equal("tasks",units[1].Kind);Assert.Null(units[1].ParentId);Assert.Equal(units[0].Id,Assert.Single(units[1].ScriptUnitIds!));
        Assert.All(units,unit=>Assert.False(unit.Hidden));
        PipelineService.ValidateUnits(units);
    }
    [Theory]
    [InlineData("bad\nlabel")][InlineData(" ")]
    public void InvalidCustomNamesAreRejected(string value) => Assert.Throws<ApiFailure>(()=>PipelineService.ValidateUnits([Script with {CustomTitle=value}]));
    [Fact] public void OldJsonRetainsCompatibleDefaults()
    {
        var unit=JsonSerializer.Deserialize<PipelineUnit>("{\"Id\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"Title\":\"Old\",\"ParentId\":null,\"Order\":0}")!;
        Assert.Equal("script",LearningStructure.Kind(unit));Assert.False(LearningStructure.IsHidden(unit,[unit]));
    }
}
