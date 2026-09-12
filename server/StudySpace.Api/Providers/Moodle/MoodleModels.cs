namespace StudySpace.Api.Providers.Moodle;
public sealed record Discovery(string SiteUrl, string SiteName, string LoginMode, string[] Methods, string[] Warnings);
public sealed record MoodleCredential(string SiteUrl, string SiteName, long UserId, string DisplayName, string Token, DateTimeOffset LastVerifiedAt);
public sealed record MoodleState(string Status, string? SiteUrl = null, string? SiteName = null, string? DisplayName = null, DateTimeOffset? LastVerifiedAt = null);
public sealed record Course(long Id, string Name, string ShortName, string Summary, string? ImageUrl = null, long? StartDate = null, long? EndDate = null, string? ImageVersion = null, bool HasCustomImage = false)
{
    [System.Text.Json.Serialization.JsonPropertyName("study_url")]
    public string? StudyUrl { get; init; }
}
public sealed record SiteRequest(string SiteUrl);
public sealed record LoginRequest(string SiteUrl, string Method);
public sealed record CompleteRequest(string? QrCode = null, string? CallbackUrl = null);
public sealed record LoginView(string Id, string Status, string Method, DateTimeOffset ExpiresAt, string? LaunchUrl, string[] Instructions);
public sealed record LoginStatus(string Id, string Status, DateTimeOffset ExpiresAt, string? Message = null);
