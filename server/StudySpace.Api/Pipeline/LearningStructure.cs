namespace StudySpace.Api.Pipeline;

public static partial class LearningStructure
{
    public static string DisplayTitle(PipelineUnit unit) => unit.CustomTitle ?? unit.Title;
    public static string Kind(PipelineUnit unit) => unit.Kind ?? "script";

    public static bool IsHidden(PipelineUnit unit, PipelineUnit[] units)
    {
        var visited = new HashSet<string>();
        PipelineUnit? current = unit;
        while (current is not null && visited.Add(current.Id))
        {
            if (current.Hidden == true) return true;
            current = units.FirstOrDefault(parent => parent.Id == current.ParentId);
        }
        return false;
    }
}
