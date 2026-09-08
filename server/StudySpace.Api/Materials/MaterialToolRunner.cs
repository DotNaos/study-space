using System.Diagnostics;
using System.Text;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Materials;

public sealed record MaterialToolResult(string Output, MaterialProvenance Provenance);
public sealed class MaterialToolRunner
{
    private const string Tessdata = "/usr/share/tesseract-ocr/5/tessdata";
    private readonly Dictionary<string, string> versions = new(StringComparer.Ordinal);
    public async Task<MaterialToolResult> Run(string tool, string[] arguments, string workingDirectory, TimeSpan timeout, CancellationToken ct)
    {
        if (tool is not ("pdfinfo" or "pdftotext" or "pdftoppm" or "tesseract")) throw new InvalidOperationException("Unknown material tool.");
        if (!versions.TryGetValue(tool, out var version))
        {
            var probe = await Execute(tool, tool == "tesseract" ? ["--version"] : ["-v"], workingDirectory, TimeSpan.FromSeconds(5), ct);
            version = (probe.Stdout + "\n" + probe.Stderr).Split('\n').FirstOrDefault(line => !string.IsNullOrWhiteSpace(line))?.Trim() ?? "unknown";
            version = version[..Math.Min(version.Length, 180)];
            if (tool == "tesseract")
            {
                foreach (var language in new[] { "eng", "deu" })
                {
                    var model = Path.Combine(Tessdata, language + ".traineddata");
                    if (!File.Exists(model)) throw new ApiFailure("material_ocr_model_missing", "A required pinned OCR language model is unavailable.", 503);
                    version += "; " + language + "=" + MaterialStore.Hash(await File.ReadAllBytesAsync(model, ct));
                }
            }
            versions[tool] = version;
        }
        if (tool == "tesseract") arguments = ["--tessdata-dir", Tessdata, .. arguments];
        var started = Stopwatch.GetTimestamp();
        var result = await Execute(tool, arguments, workingDirectory, timeout, ct);
        return new(result.Stdout, new(tool, versions[tool], (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds,
            MaterialStore.Hash(result.Stdout)));
    }
    private static async Task<(string Stdout, string Stderr)> Execute(string tool, string[] arguments, string directory, TimeSpan timeout, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct); deadline.CancelAfter(timeout);
        var start = new ProcessStartInfo(tool) { WorkingDirectory = directory, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        start.Environment.Clear(); start.Environment["PATH"] = "/usr/local/bin:/usr/bin:/bin"; start.Environment["LANG"] = "C.UTF-8";
        start.Environment["OMP_THREAD_LIMIT"] = "2";
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        using var process = new Process { StartInfo = start };
        try { if (!process.Start()) throw new InvalidOperationException(); }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        { throw new ApiFailure("material_engine_unavailable", "A required local document tool is unavailable. Check the installation's processing tools.", 503); }
        try
        {
            var stdout = ReadBounded(process.StandardOutput, 16 * 1024 * 1024, deadline.Token);
            var stderr = ReadBounded(process.StandardError, 128 * 1024, deadline.Token);
            await Task.WhenAll(stdout, stderr, process.WaitForExitAsync(deadline.Token));
            if (process.ExitCode != 0) throw new ApiFailure("material_engine_failed", "A local document tool could not read this material. Its original source copy is preserved.", 422);
            return (await stdout, await stderr);
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { throw new ApiFailure("material_engine_timeout", "This material exceeded the local processing time limit. Its original source copy is preserved.", 504); }
        finally
        {
            if (!process.HasExited) { process.Kill(entireProcessTree: true); await process.WaitForExitAsync(CancellationToken.None); }
        }
    }
    private static async Task<string> ReadBounded(StreamReader reader, int limit, CancellationToken ct)
    {
        var result = new StringBuilder(); var buffer = new char[8192]; int count;
        while ((count = await reader.ReadAsync(buffer, ct)) > 0)
        {
            if (result.Length + count > limit) throw new ApiFailure("material_engine_output_large", "This material produced more extraction output than the supported limit.", 413);
            result.Append(buffer, 0, count);
        }
        return result.ToString();
    }
}
