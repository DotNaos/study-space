import { useEffect, useRef, useState } from "react";
import { Button, Form, Textarea } from "@dotnaos/ui-base";
import { api, message } from "./api";
import { learningPath, type LearningState } from "./learning-api";
import { Notice } from "./shared";

export function ExerciseAnswer({
  courseId,
  exerciseId,
  answer,
  onSaved,
}: {
  courseId: number;
  exerciseId: string;
  answer: string;
  onSaved: (answer: string) => void;
}) {
  const [value, setValue] = useState(answer);
  const [saved, setSaved] = useState(answer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(value);
  const savedRef = useRef(saved);
  const saving = useRef(false);
  latest.current = value;
  savedRef.current = saved;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save() {
    if (saving.current || latest.current === savedRef.current) return;
    saving.current = true;
    if (mounted.current) {
      setBusy(true);
      setError("");
    }
    try {
      while (latest.current !== savedRef.current) {
        const next = latest.current;
        await api<LearningState>(
          `${learningPath(courseId)}/drafts/${encodeURIComponent(exerciseId)}`,
          {
            method: "PUT",
            body: JSON.stringify({ answer: next }),
            keepalive: true,
          },
        );
        savedRef.current = next;
        onSaved(next);
        if (mounted.current) setSaved(next);
      }
    } catch (error) {
      if (mounted.current) setError(message(error));
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (value === saved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [value, saved]);
  return (
    <div className="mt-5 space-y-2">
      <div onBlur={() => void save()}>
        <Form.Field label="Deine Antwort">
          <Textarea
            id={`answer-${exerciseId}`}
            value={value}
            rows={4}
            fullWidth
            onValueChange={(next) => setValue(next.slice(0, 12000))}
            placeholder="Notiere deinen Lösungsweg …"
          />
        </Form.Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span role="status" className="text-xs text-text-muted">
          {busy
            ? "Wird gespeichert …"
            : value !== saved
              ? "Noch nicht gespeichert"
              : value
                ? "Antwort gespeichert"
                : "Deine Antwort wird beim Verlassen des Feldes gespeichert."}
        </span>
        <Button
          variant="ghost"
          label="Antwort speichern"
          disabled={busy || value === saved}
          onPress={() => void save()}
        />
      </div>
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
