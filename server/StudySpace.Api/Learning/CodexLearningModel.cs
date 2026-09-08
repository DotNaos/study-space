using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using StudySpace.Api.Codex;
using StudySpace.Api.Infrastructure;
namespace StudySpace.Api.Learning;

public sealed class CodexLearningModel(ICodexRuntime codex) : ILearningModel
{
    public async Task<string> Generate(string prompt, JsonElement schema, CancellationToken ct)
    {
        var text = new StringBuilder();
        string? completed = null;
        await foreach (var delta in codex.GenerateAsync(prompt, schema, ct))
        {
            if (delta.Type == "text") text.Append(delta.Text);
            if (delta.Type == "completed") completed = delta.Text ?? text.ToString();
            if (text.Length > 250000) throw new ApiFailure("learning_output_large", "The generated result exceeded its limit. Your existing learning version is unchanged.", 502);
        }
        return completed ?? throw new ApiFailure("learning_incomplete", "Codex did not finish the result. Your existing learning version is unchanged.", 502);
    }
    public async IAsyncEnumerable<LearningModelDelta> Chat(string prompt, [EnumeratorCancellation] CancellationToken ct)
    {
        var text = new StringBuilder();
        var finished = false;
        await foreach (var delta in codex.GenerateAsync(prompt, null, ct))
        {
            if (delta.Type == "text" && !string.IsNullOrEmpty(delta.Text))
            {
                text.Append(delta.Text);
                if (text.Length > 32000) throw new ApiFailure("chat_output_large", "The answer exceeded its length limit.", 502);
                yield return new(delta.Text);
            }
            if (delta.Type == "completed")
            {
                finished = true;
                var final = delta.Text ?? text.ToString();
                if (final.Length > 32000) throw new ApiFailure("chat_output_large", "The answer exceeded its length limit.", 502);
                yield return new(final, true);
            }
        }
        if (!finished) throw new ApiFailure("chat_incomplete", "Codex did not finish the answer. The partial answer is saved.", 502);
    }
}
