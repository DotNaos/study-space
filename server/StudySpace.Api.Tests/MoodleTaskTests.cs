using System.Text.Json;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Configuration;
using StudySpace.Api.Infrastructure;
using StudySpace.Api.Providers.Moodle;

namespace StudySpace.Api.Tests;

public sealed class MoodleTaskTests : IDisposable
{
    private const string Site = "https://moodle.example.test/learning";
    private readonly string directory = Path.Combine(Path.GetTempPath(), "study-space-tasks-" + Guid.NewGuid());
    private readonly FixtureTransport transport = new();
    private readonly CredentialStore credentials;
    private readonly FixedTimeProvider clock = new(new DateTimeOffset(2026, 9, 11, 12, 0, 0, TimeSpan.Zero));
    private readonly MoodleService service;

    public MoodleTaskTests()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["STUDY_PRIVATE_DIR"] = directory }).Build();
        credentials = new(DataProtectionProvider.Create(new DirectoryInfo(Path.Combine(directory, "keys"))), config);
        service = new(transport, credentials, clock);
    }

    [Fact]
    public async Task AssignmentMetadataBecomesActionableTaskWithoutCredentialUrls()
    {
        await Connect();
        var result = await service.Tasks(null, default);

        Assert.False(result.Partial);
        var task = Assert.Single(result.Tasks);
        Assert.Equal("moodle:7:assign:501", task.Id);
        Assert.Equal(7, task.CourseId);
        Assert.Equal("Biology", task.CourseName);
        Assert.Equal(11, task.SectionId);
        Assert.Equal("Week 1", task.SectionName);
        Assert.Equal(99, task.ModuleId);
        Assert.Equal(501, task.AssignmentId);
        Assert.Equal("Problem set 1", task.Title);
        Assert.Equal("draft", task.Status);
        Assert.Equal("draft", task.SubmissionStatus);
        Assert.Equal("notgraded", task.GradingStatus);
        Assert.True(task.CanSubmit);
        Assert.False(task.Locked);
        Assert.Equal(1789214400, task.DueAt);
        Assert.Equal(2, task.Attachments.Length);
        Assert.Contains(task.Attachments, file => file.Name == "instructions.pdf" && file.MimeType == "application/pdf");
        Assert.Contains(task.Attachments, file => file.Name == "starter.csv" && file.MimeType == "text/csv");
        Assert.DoesNotContain("syntheticSecret", JsonSerializer.Serialize(result));
        Assert.Contains("mod_assign_get_assignments", transport.Calls);
        Assert.Contains("mod_assign_get_submission_status", transport.Calls);
    }

    [Fact]
    public async Task MissingAssignmentWebServiceFallsBackToVisibleAssignModules()
    {
        await Connect();
        transport.RejectAssignments = true;

        var result = await service.Tasks(7, default);

        Assert.True(result.Partial);
        var task = Assert.Single(result.Tasks);
        Assert.Equal("moodle:7:cm:99", task.Id);
        Assert.Null(task.AssignmentId);
        Assert.Null(task.DueAt);
        Assert.Equal("open", task.Status);
        Assert.Contains(result.Warnings, warning => warning.Contains("visible assignment modules", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain("mod_assign_get_submission_status", transport.Calls);
    }

    [Fact]
    public async Task SubmittedAssignmentIsMarkedFinishedAndExtensionMovesDueDate()
    {
        await Connect();
        transport.SubmissionStatus = "submitted";
        transport.ExtensionDueAt = 1789300800;

        var task = Assert.Single((await service.Tasks(7, default)).Tasks);

        Assert.Equal("submitted", task.Status);
        Assert.Equal(1789300800, task.DueAt);
        Assert.Equal(1789120800, task.SubmittedAt);
    }

    [Fact]
    public async Task OtherCourseIsRejectedBeforeAssignmentCalls()
    {
        await Connect();
        var error = await Assert.ThrowsAsync<ApiFailure>(() => service.Tasks(8, default));
        Assert.Equal("course_unavailable", error.Code);
        Assert.DoesNotContain("mod_assign_get_assignments", transport.Calls);
    }

    private async Task Connect() => await credentials.Write(new(Site, "Fixture Moodle", 42, "Synthetic Student", FixtureTransport.Token, clock.GetUtcNow()));

    public void Dispose()
    {
        try { Directory.Delete(directory, true); } catch { }
    }

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class FixtureTransport : IMoodleTransport
    {
        public const string Token = "syntheticMoodleToken00000000000001";
        public List<string> Calls { get; } = [];
        public bool RejectAssignments { get; set; }
        public string SubmissionStatus { get; set; } = "draft";
        public long? ExtensionDueAt { get; set; }

        public Task<JsonElement> Public(Uri site, string method, object args, CancellationToken ct) => throw new NotSupportedException();

        public Task<JsonElement> Authenticated(Uri site, string token, string method, Dictionary<string, string>? args, CancellationToken ct)
        {
            Assert.Equal(Site, site.AbsoluteUri.TrimEnd('/'));
            Assert.Equal(Token, token);
            Calls.Add(method);
            return method switch
            {
                "core_webservice_get_site_info" => Json(new { siteurl = Site, userid = 42, sitename = "Fixture Moodle", fullname = "Synthetic Student" }),
                "core_enrol_get_users_courses" => Json(new[] { new { id = 7, fullname = "Biology", shortname = "BIO", startdate = 1788739200, enddate = 1802559600 } }),
                "mod_assign_get_assignments" => Assignments(args),
                "core_course_get_contents" => Contents(args),
                "mod_assign_get_submission_status" => Submission(args),
                _ => throw new InvalidOperationException($"Unexpected Moodle method: {method}"),
            };
        }

        private Task<JsonElement> Assignments(Dictionary<string, string>? args)
        {
            if (RejectAssignments) throw new ApiFailure("moodle_rejected", "Function unavailable.", 422);
            Assert.Equal("7", args!["courseids[0]"]);
            return Json(new
            {
                courses = new[]
                {
                    new
                    {
                        id = 7,
                        assignments = new[]
                        {
                            new
                            {
                                id = 501,
                                cmid = 99,
                                name = "Problem set 1",
                                intro = "<p>Analyse the sequences.</p>",
                                allowsubmissionsfromdate = 1789034400,
                                duedate = 1789214400,
                                cutoffdate = 1789387200,
                                nosubmissions = 0,
                                introfiles = new[]
                                {
                                    new { filename = "instructions.pdf", mimetype = "application/pdf", filesize = 1234, timemodified = 1789000000, fileurl = Site + "/webservice/pluginfile.php/1/instructions.pdf?token=syntheticSecret" }
                                },
                                activityattachments = Array.Empty<object>(),
                            }
                        }
                    }
                },
                warnings = Array.Empty<object>(),
            });
        }

        private static Task<JsonElement> Contents(Dictionary<string, string>? args)
        {
            Assert.Equal("7", args!["courseid"]);
            return Json(new[]
            {
                new
                {
                    id = 11,
                    name = "Week 1",
                    summary = "Tasks",
                    modules = new[]
                    {
                        new
                        {
                            id = 99,
                            name = "Problem set 1",
                            modname = "assign",
                            url = Site + "/mod/assign/view.php?id=99",
                            description = "Fallback description",
                            contents = new[]
                            {
                                new { type = "file", filename = "starter.csv", mimetype = "text/csv", filesize = 42, timemodified = 1789000100, fileurl = Site + "/pluginfile.php/99/starter.csv?token=syntheticSecret" }
                            }
                        }
                    }
                }
            });
        }

        private Task<JsonElement> Submission(Dictionary<string, string>? args)
        {
            Assert.Equal("501", args!["assignid"]);
            var lastattempt = new Dictionary<string, object?>
            {
                ["submission"] = new { id = 700, userid = 42, status = SubmissionStatus, timemodified = 1789120800 },
                ["cansubmit"] = true,
                ["locked"] = false,
                ["graded"] = false,
                ["gradingstatus"] = "notgraded",
            };
            if (ExtensionDueAt is { } due) lastattempt["extensionduedate"] = due;
            return Json(new { lastattempt, warnings = Array.Empty<object>() });
        }

        private static Task<JsonElement> Json(object value) => Task.FromResult(JsonSerializer.SerializeToElement(value));
    }
}
