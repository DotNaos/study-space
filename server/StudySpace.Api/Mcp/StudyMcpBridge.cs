using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using StudySpace.Api.Learning;
using StudySpace.Api.Materials;
using StudySpace.Api.Providers.Moodle;

namespace StudySpace.Api.Mcp;

public static class StudyMcpBridge
{
    private const int MaxRequestBytes = 64 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static async Task RunAsync(string[] args)
    {
        var upstream = UpstreamUrl();
        var builder = WebApplication.CreateSlimBuilder(args);
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = MaxRequestBytes);
        builder.Services.AddSingleton(new StudyMcpTools(new HttpClient
        {
            BaseAddress = upstream,
            Timeout = TimeSpan.FromSeconds(30),
        }));
        var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            await next(context);
        });
        app.MapGet("/health", async (StudyMcpTools tools, CancellationToken ct) =>
            await tools.Ready(ct) ? Results.Ok(new { status = "ready" }) : Results.StatusCode(503));
        app.MapPost("/mcp", Handle);
        await app.RunAsync();
    }

    private static async Task<IResult> Handle(HttpContext context, StudyMcpTools tools, CancellationToken ct)
    {
        JsonDocument request;
        try
        {
            request = await JsonDocument.ParseAsync(context.Request.Body, cancellationToken: ct);
        }
        catch (JsonException)
        {
            return RpcError(null, -32700, "Parse error");
        }
        using (request)
        {
            var root = request.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                return RpcError(null, -32600, "Invalid Request");
            if (!root.TryGetProperty("id", out var id)) return Results.StatusCode(StatusCodes.Status202Accepted);
            if (!root.TryGetProperty("method", out var methodValue) || methodValue.ValueKind != JsonValueKind.String)
                return RpcError(id.Clone(), -32600, "Invalid Request");

            object result;
            switch (methodValue.GetString())
            {
                case "initialize":
                    result = new
                    {
                        protocolVersion = ProtocolVersion(root),
                        capabilities = new { tools = new { listChanged = false } },
                        serverInfo = new { name = "study-space", version = Environment.GetEnvironmentVariable("STUDY_VERSION") ?? "development" },
                    };
                    break;
                case "ping":
                    result = new { };
                    break;
                case "tools/list":
                    result = new { tools = StudyMcpTools.ToolDefinitions };
                    break;
                case "tools/call":
                    try
                    {
                        var parameters = root.TryGetProperty("params", out var paramsValue) ? paramsValue.Clone() : default;
                        result = await tools.Call(parameters, ct);
                    }
                    catch (StudyMcpException error)
                    {
                        result = ToolError(error.Message);
                    }
                    catch (HttpRequestException)
                    {
                        result = ToolError("Study Space is unavailable. Check the installed application and try again.");
                    }
                    catch (TaskCanceledException) when (!ct.IsCancellationRequested)
                    {
                        result = ToolError("Study Space did not answer in time.");
                    }
                    break;
                default:
                    return RpcError(id.Clone(), -32601, "Method not found");
            }
            return Results.Json(new { jsonrpc = "2.0", id = id.Clone(), result }, JsonOptions);
        }
    }

    private static IResult RpcError(JsonElement? id, int code, string message) =>
        Results.Json(new { jsonrpc = "2.0", id, error = new { code, message } }, JsonOptions);

    private static string ProtocolVersion(JsonElement root) =>
        root.TryGetProperty("params", out var parameters) && parameters.ValueKind == JsonValueKind.Object &&
        parameters.TryGetProperty("protocolVersion", out var version) && version.ValueKind == JsonValueKind.String &&
        !string.IsNullOrWhiteSpace(version.GetString())
            ? version.GetString()!
            : "2025-06-18";

    private static object ToolError(string message) => new
    {
        isError = true,
        content = new[] { new { type = "text", text = message } },
    };

    private static Uri UpstreamUrl()
    {
        var raw = Environment.GetEnvironmentVariable("STUDY_MCP_UPSTREAM_URL") ?? "http://app:8080";
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri) || uri.Scheme != Uri.UriSchemeHttp || uri.UserInfo.Length > 0 ||
            uri.Query.Length > 0 || uri.Fragment.Length > 0 || uri.AbsolutePath != "/" || !AllowedHost(uri.Host))
            throw new InvalidOperationException("STUDY_MCP_UPSTREAM_URL must be a local/container HTTP Study Space address.");
        return uri;
    }

    private static bool AllowedHost(string host) => host is "app" or "localhost" ||
        IPAddress.TryParse(host, out var address) && IPAddress.IsLoopback(address);
}

public sealed class StudyMcpTools(HttpClient client)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int DefaultItems = 20;
    private const int MaxItems = 50;
    private const int DefaultChars = 12_000;
    private const int MaxChars = 30_000;
    private const int MaxPdfBytes = 1024 * 1024;

    public static readonly object[] ToolDefinitions =
    [
        Tool("study_status", "Read Study Space application and Moodle connection status. Use this to check whether the canonical study source is available.", new
        {
            type = "object", additionalProperties = false, properties = new { }
        }),
        Tool("study_courses", "List the user's currently enrolled Moodle courses through Study Space. Returns course IDs and canonical study_url links into Study Space.", new
        {
            type = "object", additionalProperties = false,
            properties = new { offset = Integer(0, 10_000), max_items = Integer(1, 200) }
        }),
        Tool("study_course", "Read one course's sections, activities and resource metadata. Includes canonical study_url links to activities and selected resources; never exposes Moodle credentials.", new
        {
            type = "object", additionalProperties = false,
            properties = new
            {
                course_id = Integer(1, long.MaxValue),
                section_id = new { type = "integer", minimum = 1 },
                offset = Integer(0, 10_000),
                max_items = Integer(1, MaxItems),
            },
            required = new[] { "course_id" }
        }),
        Tool("study_learning", "Read saved Study Space learning content for a course: script sections, exercises, source references and optionally saved answer drafts/solutions. Without a specific section/exercise it returns a bounded index.", new
        {
            type = "object", additionalProperties = false,
            properties = new
            {
                course_id = Integer(1, long.MaxValue),
                version_id = String(1, 128),
                section_id = String(1, 256),
                exercise_id = String(1, 256),
                include_solutions = new { type = "boolean" },
                include_drafts = new { type = "boolean" },
                offset = Integer(0, 10_000),
                max_items = Integer(1, MaxItems),
                max_chars = Integer(500, MaxChars),
            },
            required = new[] { "course_id" }
        }),
        Tool("study_materials", "Read the prepared-material snapshot and coverage for a course. Use this to see which source files were imported, extracted, unsupported or failed.", new
        {
            type = "object", additionalProperties = false,
            properties = new
            {
                course_id = Integer(1, long.MaxValue),
                offset = Integer(0, 10_000),
                max_items = Integer(1, MaxItems),
            },
            required = new[] { "course_id" }
        }),
        Tool("study_source", "Read bounded extracted blocks from one prepared source document. Filter by exact block, page/slide, or a text query; source provenance and warnings stay attached.", new
        {
            type = "object", additionalProperties = false,
            properties = new
            {
                material_id = String(1, 512),
                revision = String(1, 256),
                block_id = String(1, 256),
                query = String(1, 500),
                page = Integer(1, 100_000),
                slide = Integer(1, 100_000),
                offset = Integer(0, 100_000),
                max_items = Integer(1, MaxItems),
                max_chars = Integer(500, MaxChars),
            },
            required = new[] { "material_id", "revision" }
        }),
        Tool("study_file", "Return one preserved original PDF as a bounded MCP embedded resource so ChatGPT can consume the actual document instead of only extracted text. This compatibility probe is PDF-only and limited to 1 MiB.", new
        {
            type = "object", additionalProperties = false,
            properties = new
            {
                material_id = String(1, 512),
                revision = String(1, 256),
            },
            required = new[] { "material_id", "revision" }
        }),
        Tool("study_tasks", "List Moodle assignments as actionable Study tasks with deadlines, submission state, attachments and related prepared materials. Use this for questions about what is due, overdue, submitted, or coming up. Open the returned study_url in Study Space.", new
        {
            type = "object", additionalProperties = false,
            properties = new
            {
                course_id = Integer(1, long.MaxValue),
                status = new { @enum = new[] { "open", "upcoming", "overdue", "draft", "closed", "submitted", "graded" } },
                query = String(1, 500),
                due_after = String(1, 64),
                due_before = String(1, 64),
                include_finished = new { type = "boolean" },
                offset = Integer(0, 10_000),
                max_items = Integer(1, MaxItems),
            }
        }),
        Tool("study_search", "Search the active saved script, exercises and prepared source text for a course. Use this first for broad study questions, then open exact learning/source items returned by the search.", new
        {
            type = "object", additionalProperties = false,
            properties = new
            {
                course_id = Integer(1, long.MaxValue),
                query = String(2, 500),
                include_solutions = new { type = "boolean" },
                max_results = Integer(1, 30),
            },
            required = new[] { "course_id", "query" }
        }),
    ];

    public async Task<bool> Ready(CancellationToken ct)
    {
        using var response = await client.GetAsync("/health/ready", ct);
        return response.IsSuccessStatusCode;
    }

    public async Task<object> Call(JsonElement parameters, CancellationToken ct)
    {
        if (parameters.ValueKind != JsonValueKind.Object || !parameters.TryGetProperty("name", out var nameValue) || nameValue.ValueKind != JsonValueKind.String)
            throw new StudyMcpException("Tool name is required.");
        var name = nameValue.GetString()!;
        var arguments = parameters.TryGetProperty("arguments", out var args) && args.ValueKind == JsonValueKind.Object ? args.Clone() : EmptyObject();
        if (name == "study_source" && arguments.TryGetProperty("block_id", out var blockId) && blockId.ValueKind == JsonValueKind.String &&
            string.Equals(blockId.GetString(), "original", StringComparison.Ordinal))
            return await File(arguments, ct);
        if (name == "study_file") return await File(arguments, ct);
        object value = name switch
        {
            "study_status" => await Status(ct),
            "study_courses" => await Courses(arguments, ct),
            "study_course" => await Course(arguments, ct),
            "study_learning" => await Learning(arguments, ct),
            "study_materials" => await Materials(arguments, ct),
            "study_tasks" => await Tasks(arguments, ct),
            "study_source" => await Source(arguments, ct),
            "study_search" => await Search(arguments, ct),
            _ => throw new StudyMcpException($"Unknown tool: {name}"),
        };
        return ToolResult(value);
    }

    private async Task<object> Status(CancellationToken ct)
    {
        var app = await Get<JsonElement>("/api/status", ct);
        var moodle = await Get<JsonElement>("/api/providers/moodle", ct);
        return new { app, moodle };
    }

    private async Task<object> Courses(JsonElement args, CancellationToken ct)
    {
        var courses = await Get<Course[]>("/api/providers/moodle/courses", ct);
        var offset = Int(args, "offset", 0, 0, 10_000);
        var count = Int(args, "max_items", 100, 1, 200);
        return new
        {
            total = courses.Length,
            offset,
            courses = courses.Skip(offset).Take(count).Select(course => new
            {
                course.Id,
                course.Name,
                course.ShortName,
                study_url = course.StudyUrl,
                summary = Clip(course.Summary, 800),
                course.StartDate,
                course.EndDate,
            }).ToArray(),
        };
    }

    private async Task<object> Course(JsonElement args, CancellationToken ct)
    {
        var courseId = Long(args, "course_id", 1, long.MaxValue);
        var sections = await Get<CourseSection[]>($"/api/providers/moodle/courses/{courseId}/contents", ct);
        var sectionId = OptionalLong(args, "section_id", 1, long.MaxValue);
        var selected = sectionId is null ? sections.AsEnumerable() : sections.Where(section => section.Id == sectionId);
        if (sectionId is not null && !selected.Any()) throw new StudyMcpException("The requested course section is not available.");
        var offset = Int(args, "offset", 0, 0, 10_000);
        var max = Int(args, "max_items", DefaultItems, 1, MaxItems);
        var page = selected.Skip(offset).Take(max).Select(section => new
        {
            section.Id,
            section.Name,
            summary = Clip(section.Summary, 1_500),
            modules = section.Modules.Take(100).Select(module => new
            {
                module.Id,
                module.Name,
                module.Type,
                study_url = module.StudyUrl,
                description = Clip(module.Description, 1_000),
                resources = module.Resources.Take(100).Select(resource => new
                {
                    resource.Id,
                    resource.Type,
                    resource.Name,
                    resource.MimeType,
                    resource.Size,
                    resource.ModifiedAt,
                    resource.PreviewKind,
                    study_url = resource.StudyUrl,
                }).ToArray(),
            }).ToArray(),
        }).ToArray();
        return new { courseId, total = selected.Count(), offset, sections = page };
    }

    private async Task<object> Learning(JsonElement args, CancellationToken ct)
    {
        var courseId = Long(args, "course_id", 1, long.MaxValue);
        var state = await Get<LearningState>($"/api/learning/courses/{courseId}", ct);
        var versionId = OptionalString(args, "version_id", 128);
        LearningVersion? version;
        if (versionId is not null)
            version = await Get<LearningVersion>($"/api/learning/courses/{courseId}/versions/{Uri.EscapeDataString(versionId)}", ct);
        else version = state.ActiveVersion;
        if (version is null)
            return new { courseId, state.ActiveVersionId, versions = state.Versions, state.Job, message = "No active saved learning version is available." };

        var sectionId = OptionalString(args, "section_id", 256);
        var exerciseId = OptionalString(args, "exercise_id", 256);
        if (sectionId is not null && exerciseId is not null) throw new StudyMcpException("Choose either section_id or exercise_id, not both.");
        var maxChars = Int(args, "max_chars", DefaultChars, 500, MaxChars);
        var includeSolutions = Bool(args, "include_solutions", false);
        var includeDrafts = Bool(args, "include_drafts", false);
        if (sectionId is not null)
        {
            var section = version.Sections.SingleOrDefault(item => item.Id == sectionId) ?? throw new StudyMcpException("The requested learning section is not available in this version.");
            return new
            {
                courseId,
                version = Summary(version),
                section = new { section.Id, section.Title, markdown = Clip(section.Markdown, maxChars), section.Sources },
                truncated = section.Markdown.Length > maxChars,
            };
        }
        if (exerciseId is not null)
        {
            var exercise = version.Exercises.SingleOrDefault(item => item.Id == exerciseId) ?? throw new StudyMcpException("The requested exercise is not available in this version.");
            state.Drafts.TryGetValue(exercise.Id, out var draft);
            return new
            {
                courseId,
                version = Summary(version),
                exercise = new
                {
                    exercise.Id,
                    exercise.Title,
                    prompt = Clip(exercise.Prompt, maxChars),
                    hint = Clip(exercise.Hint, maxChars),
                    solution = includeSolutions ? Clip(exercise.Solution, maxChars) : null,
                    exercise.Origin,
                    exercise.Sources,
                    draft = includeDrafts ? draft : null,
                },
            };
        }

        var offset = Int(args, "offset", 0, 0, 10_000);
        var max = Int(args, "max_items", DefaultItems, 1, MaxItems);
        var index = Enumerable.Concat(
            version.Sections.Select(section => (kind: "section", id: section.Id, title: section.Title, preview: Clip(section.Markdown, 500), origin: (string?)null, sources: section.Sources)),
            version.Exercises.Select(exercise => (kind: "exercise", id: exercise.Id, title: exercise.Title, preview: Clip(exercise.Prompt, 800), origin: (string?)exercise.Origin, sources: exercise.Sources)))
            .Skip(offset).Take(max).ToArray();
        return new
        {
            courseId,
            activeVersionId = state.ActiveVersionId,
            version = Summary(version),
            state.Job,
            state.ReadingSectionId,
            totalItems = version.Sections.Length + version.Exercises.Length,
            offset,
            items = index,
            drafts = includeDrafts ? state.Drafts.Where(pair => index.Any(item => item.kind == "exercise" && item.id == pair.Key)).ToDictionary(pair => pair.Key, pair => pair.Value) : null,
        };
    }

    private async Task<object> Materials(JsonElement args, CancellationToken ct)
    {
        var courseId = Long(args, "course_id", 1, long.MaxValue);
        var snapshot = await Get<MaterialSnapshot>($"/api/materials/courses/{courseId}", ct);
        var offset = Int(args, "offset", 0, 0, 10_000);
        var max = Int(args, "max_items", DefaultItems, 1, MaxItems);
        return new
        {
            snapshot.CourseId,
            snapshot.SnapshotId,
            snapshot.Status,
            snapshot.Coverage,
            snapshot.Job,
            snapshot.UpdatedAt,
            totalMaterials = snapshot.Materials.Length,
            offset,
            materials = snapshot.Materials.Skip(offset).Take(max).Select(item => new
            {
                item.Id,
                item.Revision,
                item.Name,
                item.Kind,
                item.MimeType,
                item.SectionId,
                item.SectionName,
                item.ModuleId,
                study_url = item.StudyUrl,
                item.Status,
                item.Reason,
                item.Warnings,
            }).ToArray(),
        };
    }

    private async Task<object> Tasks(JsonElement args, CancellationToken ct)
    {
        var courseId = OptionalLong(args, "course_id", 1, long.MaxValue);
        var path = "/api/providers/moodle/tasks" + (courseId is null ? "" : $"?courseId={courseId.Value}");
        var taskList = await Get<MoodleTaskList>(path, ct);
        IEnumerable<MoodleTask> tasks = taskList.Tasks;

        var query = OptionalString(args, "query", 500);
        if (query is not null)
            tasks = tasks.Where(task => task.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                task.CourseName.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                task.SectionName.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                task.Description.Contains(query, StringComparison.OrdinalIgnoreCase));

        var status = OptionalString(args, "status", 32);
        var allowedStatuses = new HashSet<string>(["open", "upcoming", "overdue", "draft", "closed", "submitted", "graded"], StringComparer.OrdinalIgnoreCase);
        if (status is not null && !allowedStatuses.Contains(status)) throw new StudyMcpException("status must be open, upcoming, overdue, draft, closed, submitted, or graded.");
        if (status is not null) tasks = tasks.Where(task => string.Equals(task.Status, status, StringComparison.OrdinalIgnoreCase));

        var includeFinished = Bool(args, "include_finished", false);
        if (!includeFinished && status is null)
            tasks = tasks.Where(task => task.Status is not ("submitted" or "graded"));

        var dueAfter = OptionalDate(args, "due_after");
        var dueBefore = OptionalDate(args, "due_before");
        if (dueAfter is not null && dueBefore is not null && dueAfter > dueBefore)
            throw new StudyMcpException("due_after must be before due_before.");
        if (dueAfter is not null) tasks = tasks.Where(task => task.DueAt is { } due && due >= dueAfter.Value);
        if (dueBefore is not null) tasks = tasks.Where(task => task.DueAt is { } due && due <= dueBefore.Value);

        tasks = tasks.OrderBy(task => TaskPriority(task.Status)).ThenBy(task => task.DueAt ?? long.MaxValue)
            .ThenBy(task => task.CourseName, StringComparer.OrdinalIgnoreCase).ThenBy(task => task.Title, StringComparer.OrdinalIgnoreCase);
        var total = tasks.Count();
        var offset = Int(args, "offset", 0, 0, 10_000);
        var max = Int(args, "max_items", DefaultItems, 1, MaxItems);
        var page = tasks.Skip(offset).Take(max).ToArray();
        var materialCache = new Dictionary<long, MaterialSnapshot>();
        var output = new List<object>();
        foreach (var task in page)
        {
            if (!materialCache.TryGetValue(task.CourseId, out var snapshot))
            {
                snapshot = await Get<MaterialSnapshot>($"/api/materials/courses/{task.CourseId}", ct);
                materialCache[task.CourseId] = snapshot;
            }
            var relatedMaterials = snapshot.Materials.Where(item => item.Status == "ready" && item.Revision is not null &&
                    task.SectionId > 0 && item.SectionId == task.SectionId)
                .Take(12).Select(item => new
                {
                    material_id = item.Id,
                    revision = item.Revision,
                    item.Name,
                    mime_type = item.MimeType,
                    module_id = item.ModuleId,
                    study_url = item.StudyUrl,
                }).ToArray();
            output.Add(new
            {
                task.Id,
                task.CourseId,
                task.CourseName,
                task.SectionId,
                task.SectionName,
                task.ModuleId,
                study_url = task.StudyUrl,
                task.AssignmentId,
                task.Title,
                description = Clip(task.Description, 3_000),
                task.Status,
                task.SubmissionStatus,
                task.GradingStatus,
                task.CanSubmit,
                task.Locked,
                opensAt = task.OpensAt,
                opensAtUtc = Timestamp(task.OpensAt),
                dueAt = task.DueAt,
                dueAtUtc = Timestamp(task.DueAt),
                cutoffAt = task.CutoffAt,
                cutoffAtUtc = Timestamp(task.CutoffAt),
                submittedAt = task.SubmittedAt,
                submittedAtUtc = Timestamp(task.SubmittedAt),
                task.Attachments,
                relatedMaterials,
                task.Warnings,
            });
        }
        return new
        {
            total,
            offset,
            partial = taskList.Partial,
            warnings = taskList.Warnings,
            tasks = output.ToArray(),
        };
    }

    private static int TaskPriority(string status) => status switch
    {
        "overdue" => 0,
        "draft" => 1,
        "open" => 2,
        "upcoming" => 3,
        "closed" => 4,
        "submitted" => 5,
        "graded" => 6,
        _ => 7,
    };

    private static string? Timestamp(long? value) => value is { } unix ? DateTimeOffset.FromUnixTimeSeconds(unix).ToString("O") : null;

    private async Task<object> Source(JsonElement args, CancellationToken ct)
    {
        var materialId = RequiredString(args, "material_id", 512);
        var revision = RequiredString(args, "revision", 256);
        var document = await Get<MaterialDocument>($"/api/materials/{Uri.EscapeDataString(materialId)}/revisions/{Uri.EscapeDataString(revision)}", ct);
        IEnumerable<MaterialBlock> blocks = document.Blocks.OrderBy(block => block.Order);
        var blockId = OptionalString(args, "block_id", 256);
        var query = OptionalString(args, "query", 500);
        var page = OptionalInt(args, "page", 1, 100_000);
        var slide = OptionalInt(args, "slide", 1, 100_000);
        var filters = new[] { blockId is not null, query is not null, page is not null, slide is not null }.Count(value => value);
        if (filters > 1) throw new StudyMcpException("Choose only one source filter: block_id, query, page, or slide.");
        if (blockId is not null) blocks = blocks.Where(block => block.Id == blockId);
        else if (query is not null) blocks = blocks.Where(block => block.Text.Contains(query, StringComparison.OrdinalIgnoreCase));
        else if (page is not null) blocks = blocks.Where(block => block.Page == page);
        else if (slide is not null) blocks = blocks.Where(block => block.Slide == slide);
        var offset = Int(args, "offset", 0, 0, 100_000);
        var max = Int(args, "max_items", DefaultItems, 1, MaxItems);
        var maxChars = Int(args, "max_chars", DefaultChars, 500, MaxChars);
        var selected = blocks.Skip(offset).Take(max).ToArray();
        var remaining = maxChars;
        var output = selected.Select(block =>
        {
            var text = remaining <= 0 ? "" : Clip(block.Text, Math.Min(remaining, 6_000));
            remaining -= text.Length;
            return new { block.Id, block.Kind, text, block.Order, block.Page, block.Slide, block.AssetId, block.Bounds, block.Cells };
        }).ToArray();
        return new
        {
            document.MaterialId,
            document.Revision,
            document.Name,
            document.MimeType,
            document.Complete,
            document.Warnings,
            document.Provenance,
            totalBlocks = blocks.Count(),
            offset,
            blocks = output,
            truncated = selected.Any(block => block.Text.Length > 6_000) || selected.Sum(block => block.Text.Length) > maxChars,
        };
    }

    private async Task<object> File(JsonElement args, CancellationToken ct)
    {
        var materialId = RequiredString(args, "material_id", 512);
        var revision = RequiredString(args, "revision", 256);
        var materialPath = $"/api/materials/{Uri.EscapeDataString(materialId)}/revisions/{Uri.EscapeDataString(revision)}";
        var document = await Get<MaterialDocument>(materialPath, ct);
        var original = document.Assets.SingleOrDefault(asset => asset.Id == "original")
            ?? throw new StudyMcpException("The preserved original file is not available for this material revision.");
        if (!string.Equals(original.MimeType, "application/pdf", StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(document.MimeType, "application/pdf", StringComparison.OrdinalIgnoreCase))
            throw new StudyMcpException("study_file currently supports preserved PDF originals only.");
        if (original.ByteLength > MaxPdfBytes)
            throw new StudyMcpException($"The original PDF is larger than the {MaxPdfBytes}-byte compatibility-probe limit.");

        using var response = await client.GetAsync(materialPath + "/assets/original", HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new StudyMcpException(await FailureMessage(response, ct));
        if (response.Content.Headers.ContentLength is > MaxPdfBytes)
            throw new StudyMcpException($"The original PDF is larger than the {MaxPdfBytes}-byte compatibility-probe limit.");
        var responseMime = response.Content.Headers.ContentType?.MediaType;
        if (!string.Equals(responseMime, "application/pdf", StringComparison.OrdinalIgnoreCase))
            throw new StudyMcpException("The preserved original did not return application/pdf.");

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream(Math.Min(MaxPdfBytes, checked((int)Math.Max(0, original.ByteLength))));
        var chunk = new byte[64 * 1024];
        while (true)
        {
            var read = await stream.ReadAsync(chunk, ct);
            if (read == 0) break;
            if (buffer.Length + read > MaxPdfBytes)
                throw new StudyMcpException($"The original PDF is larger than the {MaxPdfBytes}-byte compatibility-probe limit.");
            await buffer.WriteAsync(chunk.AsMemory(0, read), ct);
        }

        var bytes = buffer.ToArray();
        var uri = $"study://materials/{Uri.EscapeDataString(materialId)}/revisions/{Uri.EscapeDataString(revision)}/original";
        return new
        {
            content = new object[]
            {
                new { type = "text", text = $"Original PDF: {document.Name} ({bytes.Length} bytes)." },
                new
                {
                    type = "resource",
                    resource = new
                    {
                        uri,
                        mimeType = "application/pdf",
                        blob = bytes,
                    },
                },
            },
        };
    }

    private async Task<object> Search(JsonElement args, CancellationToken ct)
    {
        var courseId = Long(args, "course_id", 1, long.MaxValue);
        var query = RequiredString(args, "query", 500).Trim();
        if (query.Length < 2) throw new StudyMcpException("query must contain at least 2 characters.");
        var max = Int(args, "max_results", 10, 1, 30);
        var includeSolutions = Bool(args, "include_solutions", false);
        var results = new List<SearchHit>();
        var state = await Get<LearningState>($"/api/learning/courses/{courseId}", ct);
        if (state.ActiveVersion is { } version)
        {
            foreach (var section in version.Sections)
                AddHit(results, query, "section", section.Id, section.Title, section.Markdown, null, null, section.Sources);
            foreach (var exercise in version.Exercises)
                AddHit(results, query, "exercise", exercise.Id, exercise.Title,
                    includeSolutions ? $"{exercise.Prompt}\n{exercise.Hint}\n{exercise.Solution}" : $"{exercise.Prompt}\n{exercise.Hint}", null, null, exercise.Sources);
        }
        var snapshot = await Get<MaterialSnapshot>($"/api/materials/courses/{courseId}", ct);
        foreach (var material in snapshot.Materials.Where(item => item.Status == "ready" && item.Revision is not null).Take(128))
        {
            var document = await Get<MaterialDocument>($"/api/materials/{Uri.EscapeDataString(material.Id)}/revisions/{Uri.EscapeDataString(material.Revision!)}", ct);
            foreach (var block in document.Blocks)
                AddHit(results, query, "source", block.Id, material.Name, block.Text, material.Id, material.Revision, null, block.Page, block.Slide);
        }
        return new
        {
            courseId,
            query,
            results = results.OrderByDescending(hit => hit.Score).ThenBy(hit => hit.Title, StringComparer.OrdinalIgnoreCase).Take(max)
                .Select(hit => new
                {
                    hit.Kind,
                    hit.Id,
                    hit.Title,
                    hit.Excerpt,
                    hit.MaterialId,
                    hit.Revision,
                    hit.Page,
                    hit.Slide,
                    hit.Sources,
                    study_url = hit.MaterialId is null ? null : snapshot.Materials.FirstOrDefault(item => item.Id == hit.MaterialId)?.StudyUrl,
                }).ToArray(),
        };
    }

    private async Task<T> Get<T>(string path, CancellationToken ct)
    {
        using var response = await client.GetAsync(path, ct);
        if (!response.IsSuccessStatusCode)
        {
            var message = await FailureMessage(response, ct);
            throw new StudyMcpException(message);
        }
        var value = await response.Content.ReadFromJsonAsync<T>(JsonOptions, ct);
        return value ?? throw new StudyMcpException("Study Space returned an empty response.");
    }

    private static async Task<string> FailureMessage(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var problem = await response.Content.ReadFromJsonAsync<JsonElement>(JsonOptions, ct);
            if (problem.ValueKind == JsonValueKind.Object && problem.TryGetProperty("detail", out var detail) && detail.ValueKind == JsonValueKind.String)
                return detail.GetString()!;
        }
        catch (JsonException) { }
        return $"Study Space returned HTTP {(int)response.StatusCode}.";
    }

    private static object ToolResult(object value)
    {
        var structured = JsonSerializer.SerializeToElement(value, JsonOptions);
        var text = JsonSerializer.Serialize(structured, JsonOptions);
        return new
        {
            content = new[] { new { type = "text", text } },
            structuredContent = structured,
        };
    }

    private static object Summary(LearningVersion version) => new
    {
        version.Id,
        version.CreatedAt,
        version.SnapshotId,
        version.Title,
        version.Partial,
        version.Warnings,
        sectionCount = version.Sections.Length,
        exerciseCount = version.Exercises.Length,
        version.Sources,
    };

    private static void AddHit(List<SearchHit> results, string query, string kind, string id, string title, string text,
        string? materialId, string? revision, SourceRef[]? sources, int? page = null, int? slide = null)
    {
        var score = Score(text, title, query);
        if (score <= 0) return;
        results.Add(new(kind, id, title, Excerpt(text, query), score, materialId, revision, page, slide, sources));
    }

    private static int Score(string text, string title, string query)
    {
        var score = 0;
        if (title.Contains(query, StringComparison.OrdinalIgnoreCase)) score += 20;
        if (text.Contains(query, StringComparison.OrdinalIgnoreCase)) score += 12;
        foreach (var term in Terms(query))
        {
            if (title.Contains(term, StringComparison.OrdinalIgnoreCase)) score += 4;
            if (text.Contains(term, StringComparison.OrdinalIgnoreCase)) score += 2;
        }
        return score;
    }

    private static string Excerpt(string text, string query)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var index = text.IndexOf(query, StringComparison.OrdinalIgnoreCase);
        if (index < 0)
        {
            foreach (var term in Terms(query))
            {
                index = text.IndexOf(term, StringComparison.OrdinalIgnoreCase);
                if (index >= 0) break;
            }
        }
        if (index < 0) return Clip(text, 700);
        var start = Math.Max(0, index - 250);
        var length = Math.Min(text.Length - start, 900);
        var excerpt = text.Substring(start, length).Trim();
        return (start > 0 ? "…" : "") + excerpt + (start + length < text.Length ? "…" : "");
    }

    private static IEnumerable<string> Terms(string query) => query.Split([' ', '\t', '\r', '\n', ',', '.', ':', ';', '(', ')', '[', ']'], StringSplitOptions.RemoveEmptyEntries)
        .Select(term => term.Trim()).Where(term => term.Length >= 3).Distinct(StringComparer.OrdinalIgnoreCase).Take(12);

    private static object Tool(string name, string description, object inputSchema) => new
    {
        name,
        description,
        annotations = new { readOnlyHint = true, destructiveHint = false, openWorldHint = false },
        inputSchema,
    };

    private static object Integer(long minimum, long maximum) => new { type = "integer", minimum, maximum };
    private static object String(int minimum, int maximum) => new { type = "string", minLength = minimum, maxLength = maximum };
    private static string Clip(string? value, int max) => string.IsNullOrEmpty(value) || value.Length <= max ? value ?? "" : value[..max] + "…";
    private static JsonElement EmptyObject() => JsonSerializer.SerializeToElement(new { });
    private static bool Bool(JsonElement args, string name, bool fallback)
    {
        if (!args.TryGetProperty(name, out var value)) return fallback;
        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            throw new StudyMcpException($"{name} must be a boolean.");
        return value.GetBoolean();
    }
    private static int Int(JsonElement args, string name, int fallback, int min, int max)
    {
        if (!args.TryGetProperty(name, out var value)) return fallback;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt32(out var number) || number < min || number > max)
            throw new StudyMcpException($"{name} must be an integer between {min} and {max}.");
        return number;
    }
    private static int? OptionalInt(JsonElement args, string name, int min, int max) => args.TryGetProperty(name, out _) ? Int(args, name, min, min, max) : null;
    private static long? OptionalDate(JsonElement args, string name)
    {
        var value = OptionalString(args, name, 64);
        if (value is null) return null;
        if (!DateTimeOffset.TryParse(value, System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AllowWhiteSpaces | System.Globalization.DateTimeStyles.AssumeUniversal, out var parsed))
            throw new StudyMcpException($"{name} must be an ISO-8601 date/time.");
        return parsed.ToUnixTimeSeconds();
    }
    private static long Long(JsonElement args, string name, long min, long max)
    {
        if (!args.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out var number) || number < min || number > max)
            throw new StudyMcpException($"{name} must be an integer between {min} and {max}.");
        return number;
    }
    private static long? OptionalLong(JsonElement args, string name, long min, long max) => args.TryGetProperty(name, out _) ? Long(args, name, min, max) : null;
    private static string RequiredString(JsonElement args, string name, int max)
    {
        var value = OptionalString(args, name, max);
        return string.IsNullOrWhiteSpace(value) ? throw new StudyMcpException($"{name} is required.") : value;
    }
    private static string? OptionalString(JsonElement args, string name, int max)
    {
        if (!args.TryGetProperty(name, out var value)) return null;
        if (value.ValueKind != JsonValueKind.String) throw new StudyMcpException($"{name} must be a string.");
        var text = value.GetString() ?? "";
        if (text.Length == 0 || text.Length > max) throw new StudyMcpException($"{name} must contain 1 to {max} characters.");
        return text;
    }

    private sealed record SearchHit(string Kind, string Id, string Title, string Excerpt, int Score, string? MaterialId,
        string? Revision, int? Page, int? Slide, SourceRef[]? Sources);
}

public sealed class StudyMcpException(string message) : Exception(message);
