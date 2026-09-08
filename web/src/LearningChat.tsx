import { useEffect, useRef, useState } from "react";
import { Assistant, type AssistantProps } from "./ui-ai";
import { message } from "./api";
import type { StudyMessage } from "./learning-api";
import { askLearningQuestion } from "./learning-chat";
import { SafeMarkdown } from "./SafeMarkdown";
import { Notice } from "./shared";

type ChatMessage = AssistantProps["messages"][number];
const displayMessages = (messages: StudyMessage[]): ChatMessage[] =>
  messages.map((item) => ({
    ...item,
    status: "completed",
    label: item.status === "interrupted" ? "Unterbrochen" : undefined,
  }));
export function LearningChat({
  courseId,
  versionId,
  savedMessages,
  connected,
  onFinished,
}: {
  courseId: number;
  versionId: string;
  savedMessages: StudyMessage[];
  connected: boolean;
  onFinished: () => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    displayMessages(savedMessages),
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => {
    if (!running) setMessages(displayMessages(savedMessages));
  }, [savedMessages]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);
  async function submit(value: string) {
    const prompt = value.trim();
    if (!prompt || running || !connected || prompt.length > 4000) return;
    const key = crypto.randomUUID();
    const assistantId = `${key}-answer`;
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((messages) => [
      ...messages,
      { id: key, role: "user", content: prompt, status: "completed" },
      { id: assistantId, role: "assistant", content: "", status: "streaming" },
    ]);
    setInput("");
    setRunning(true);
    setError("");
    let text = "";
    try {
      const response = await askLearningQuestion(
        courseId,
        versionId,
        prompt,
        controller.signal,
        (delta) => {
          text += delta;
          if (mounted.current)
            setMessages((messages) =>
              messages.map((item) =>
                item.id === assistantId ? { ...item, content: text } : item,
              ),
            );
        },
      );
      if (mounted.current)
        setMessages((messages) =>
          messages.map((item) =>
            item.id === assistantId
              ? { ...response, status: "completed" }
              : item,
          ),
        );
    } catch (error) {
      if (mounted.current) {
        setError(
          controller.signal.aborted
            ? "Antwort gestoppt. Bereits empfangener Text bleibt gespeichert."
            : message(error),
        );
        setMessages((messages) =>
          messages.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: text || "Es wurde keine Antwort empfangen.",
                  status: "completed",
                  label: "Unterbrochen",
                }
              : item,
          ),
        );
        if (!text && !controller.signal.aborted) setInput(prompt);
      }
    } finally {
      if (mounted.current) {
        setRunning(false);
        onFinished();
      }
      if (abortRef.current === controller) abortRef.current = undefined;
    }
  }
  return (
    <div className="space-y-3 pt-4">
      <p className="text-xs leading-5 text-text-muted">
        Mit dem Senden werden deine Frage, der Lernbereich und seine Quellen
        über dein verbundenes Codex-Konto an OpenAI übermittelt. Antworten
        verändern dein Lernskript und deine Übungen nicht.
      </p>
      {!connected && (
        <p className="text-sm text-text-muted">
          Verbinde ChatGPT, um Fragen zu stellen. Gespeicherte Antworten bleiben
          lesbar.
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      <Assistant
        title="Fragen zum Lernbereich"
        inputValue={input}
        onInputChange={(value) => setInput(value.slice(0, 4000))}
        messages={messages}
        onSubmit={(value) => void submit(value)}
        onStop={() => abortRef.current?.abort()}
        state={running ? "streaming" : "idle"}
        disabled={!connected}
        placeholder="Was möchtest du besser verstehen?"
        emptyTitle="Eine Frage zu deinem Lernstoff?"
        emptyDescription="Lass dir einen Zusammenhang erklären oder einen Lösungsweg erläutern."
        submitLabel="Frage senden"
        stopLabel="Antwort stoppen"
        renderMessage={(item) => (
          <article
            className={`min-w-0 space-y-1 px-1 py-3 ${item.role === "user" ? "text-text-muted" : ""}`}
          >
            <p className="text-xs font-medium text-text-muted">
              {item.role === "user" ? "Du" : "Study Space"}
              {item.label && ` · ${item.label}`}
            </p>
            {item.content ? (
              <SafeMarkdown>{item.content}</SafeMarkdown>
            ) : (
              <p className="text-sm text-text-muted">
                Antwort wird vorbereitet …
              </p>
            )}
          </article>
        )}
        customize={{
          className: "h-[min(42rem,80dvh)] min-h-[26rem] w-full",
          reason:
            "Keep the course question panel compact with existing course navigation",
        }}
      />
    </div>
  );
}
