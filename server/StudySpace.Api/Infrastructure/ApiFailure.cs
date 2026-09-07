namespace StudySpace.Api.Infrastructure;
public sealed class ApiFailure(string code, string detail, int status = 400) : Exception(detail)
{
    public string Code { get; } = code;
    public int Status { get; } = status;
}
