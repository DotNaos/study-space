using Microsoft.AspNetCore.Http;
using StudySpace.Api.Mcp;
namespace StudySpace.Api.Tests;

public sealed class StudyMcpTransportTests
{
    [Theory]
    [InlineData("application/json", null, null)]
    [InlineData("application/json; charset=utf-8", null, null)]
    [InlineData("text/plain", null, 415)]
    [InlineData("application/x-www-form-urlencoded", null, 415)]
    [InlineData("multipart/form-data", null, 415)]
    [InlineData(null, null, 415)]
    [InlineData("application/json", "https://foreign.example.test", 403)]
    [InlineData("text/plain", "https://foreign.example.test", 403)]
    [InlineData("application/json", "null", 403)]
    [InlineData("application/json", "http://localhost", 403)]
    public void OnlyNonBrowserJsonTransportCanReachRpc(string? contentType, string? origin, int? expected)
    {
        var request = new DefaultHttpContext().Request;
        request.Method = "POST"; request.ContentType = contentType;
        if (origin is not null) request.Headers.Origin = origin;
        Assert.Equal(expected, StudyMcpBridge.TransportFailure(request));
    }
}
