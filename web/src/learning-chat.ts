import { ApiError } from "./api";
import { learningPath, type StudyMessage } from "./learning-api";

export async function readLearningEvents(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<StudyMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let completed: StudyMessage | undefined;
  function consume(event: string) {
    const lines = event.split("\n");
    const type = lines
      .find((line) => line.startsWith("event:"))
      ?.slice(6)
      .trim();
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    const value = JSON.parse(data);
    if (type === "error")
      throw new Error(
        typeof value.message === "string"
          ? value.message
          : "Die Antwort wurde unterbrochen.",
      );
    if (type === "delta" && typeof value.text === "string") onDelta(value.text);
    if (
      type === "completed" &&
      value.message?.role === "assistant" &&
      typeof value.message.content === "string" &&
      typeof value.message.id === "string"
    )
      completed = value.message;
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      total += value?.length ?? 0;
      if (total > 2 * 1024 * 1024)
        throw new Error(
          "Die Antwort ist zu lang. Bitte stelle eine gezieltere Frage.",
        );
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!completed)
      throw new Error(
        "Die Antwort wurde unterbrochen. Bereits empfangener Text bleibt erhalten.",
      );
    return completed;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function askLearningQuestion(
  courseId: number,
  versionId: string,
  input: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
) {
  const response = await fetch(`${learningPath(courseId)}/chat`, {
    method: "POST",
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId, message: input, consentToCodex: true }),
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      problem?.code,
      problem?.detail ||
        problem?.message ||
        "Die Frage konnte nicht gesendet werden.",
    );
  }
  if (
    !response.body ||
    !response.headers.get("Content-Type")?.startsWith("text/event-stream")
  )
    throw new Error("Die Antwort konnte nicht geöffnet werden.");
  return readLearningEvents(response.body, onDelta);
}
