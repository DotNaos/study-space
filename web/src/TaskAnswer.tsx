import { useState } from "react";
import { Button, Checkbox, Form, Select, Textarea } from "@dotnaos/ui-base";
import { api, message } from "./api";
import { learningPath, type SourceRef } from "./learning-api";
import { SafeMarkdown } from "./SafeMarkdown";
import { Loading, Notice } from "./shared";

type Attempt = {
  id: string;
  versionId: string;
  exerciseId: string;
  revision: number;
  answer: string;
  status: "draft" | "submitted";
  updatedAt: string;
  submittedAt: string | null;
};
type Feedback = {
  id: string;
  attemptId: string;
  attemptRevision: number;
  answerHash: string;
  reviewer: string;
  outcome: string;
  comment: string;
  sources: SourceRef[];
  createdAt: string;
};
type State = { attempts: Attempt[]; feedback: Feedback[] };
const outcomes: Record<string, string> = {
  correct: "Richtig",
  "partly-correct": "Teilweise richtig",
  "needs-work": "Überarbeiten",
  uncertain: "Nicht sicher beurteilbar",
};

export function TaskAnswer({
  courseId,
  versionId,
  exerciseId,
  legacyAnswer,
  aliases = [],
  aliasDrafts = [],
}: {
  courseId: number;
  versionId: string;
  exerciseId: string;
  legacyAnswer: string;
  aliases?: string[];
  aliasDrafts?: { id: string; answer: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>();
  const [selected, setSelected] = useState<string>();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const base = learningPath(courseId);
  const attempts =
    state?.attempts.filter(
      (attempt) =>
        attempt.exerciseId === exerciseId && attempt.versionId === versionId,
    ) ?? [];
  const historical =
    state?.attempts.filter(
      (attempt) =>
        (attempt.exerciseId === exerciseId ||
          aliases.includes(attempt.exerciseId)) &&
        attempt.versionId !== versionId,
    ) ?? [];
  const attempt = attempts.find((attempt) => attempt.id === selected);
  const feedback =
    state?.feedback.filter((feedback) => feedback.attemptId === selected) ?? [];
  async function load() {
    setOpen(true);
    setError("");
    setBusy(true);
    try {
      const value = await api<State>(`${base}/attempts`);
      setState(value);
      const recent = value.attempts
        .filter(
          (attempt) =>
            attempt.exerciseId === exerciseId &&
            attempt.versionId === versionId,
        )
        .at(-1);
      setSelected(recent?.id);
      setAnswer(recent?.answer ?? "");
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const value = await api<Attempt>(`${base}/attempts`, {
      method: "POST",
      body: JSON.stringify({
        versionId,
        exerciseId,
        attemptId: attempt?.id ?? null,
        expectedRevision: attempt?.revision ?? 0,
        answer,
      }),
    });
    setState((state) => ({
      attempts: [
        ...(state?.attempts ?? []).filter((item) => item.id !== value.id),
        value,
      ],
      feedback: state?.feedback ?? [],
    }));
    setSelected(value.id);
    return value;
  }
  async function action(kind: "save" | "submit" | "review") {
    setBusy(true);
    setError("");
    try {
      if (kind === "review") {
        if (!attempt || attempt.status !== "submitted" || !consent) return;
        const result = await api<Feedback>(
          `${base}/attempts/${attempt.id}/review`,
          {
            method: "POST",
            signal: AbortSignal.timeout(250000),
            body: JSON.stringify({
              attemptRevision: attempt.revision,
              consentToCodex: true,
            }),
          },
        );
        setState((state) => ({
          attempts: state?.attempts ?? [],
          feedback: [...(state?.feedback ?? []), result],
        }));
      } else {
        const saved = await save();
        if (kind === "submit") {
          const result = await api<Attempt>(
            `${base}/attempts/${saved.id}/submit`,
            {
              method: "POST",
              body: JSON.stringify({ expectedRevision: saved.revision }),
            },
          );
          setState((state) => ({
            attempts: (state?.attempts ?? []).map((item) =>
              item.id === result.id ? result : item,
            ),
            feedback: state?.feedback ?? [],
          }));
        }
      }
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <div className="mt-4">
        <Button
          size="sm"
          variant="secondary"
          icon="pencil-line"
          label="Aufgabe bearbeiten"
          onPress={() => void load()}
        />
        {legacyAnswer && (
          <span className="ml-3 text-xs text-text-muted">
            Frühere Antwort vorhanden
          </span>
        )}
      </div>
    );
  return (
    <div
      className="my-5 space-y-4 border-l-2 border-border pl-4"
      aria-label="Aufgabenbearbeitung"
    >
      {busy && (
        <Loading
          label={
            attempt?.status === "submitted"
              ? "Antwort wird geprüft …"
              : "Bearbeitung wird gespeichert …"
          }
        />
      )}
      {error && (
        <>
          <Notice>{error}</Notice>
          <Button
            variant="ghost"
            label="Bearbeitungen neu laden"
            onPress={() => void load()}
          />
        </>
      )}
      {attempts.length > 0 && (
        <Select
          accessibilityLabel="Bearbeitungsversuch"
          value={selected ?? "new"}
          size="sm"
          options={[
            { value: "new", label: "Neuer Versuch" },
            ...attempts.map((item, index) => ({
              value: item.id,
              label: `Versuch ${index + 1} · ${item.status === "draft" ? "Entwurf" : "Abgegeben"}`,
            })),
          ]}
          onValueChange={(value) => {
            setSelected(value === "new" ? undefined : value);
            setAnswer(attempts.find((item) => item.id === value)?.answer ?? "");
            setConsent(false);
          }}
        />
      )}
      {attempt?.status === "submitted" ? (
        <>
          <p className="text-xs text-text-muted">
            Abgegeben in Study Space ·{" "}
            {new Date(attempt.submittedAt!).toLocaleString("de-CH")} · Versuch{" "}
            {attempt.id.slice(0, 8)}
          </p>
          <SafeMarkdown>{attempt.answer}</SafeMarkdown>
        </>
      ) : (
        <>
          <Form.Field label="Deine Antwort">
            <Textarea
              rows={5}
              fullWidth
              value={answer}
              onValueChange={(value) => setAnswer(value.slice(0, 12000))}
            />
          </Form.Field>
          {legacyAnswer && !attempt && !answer && (
            <Button
              variant="ghost"
              size="sm"
              label="Frühere Antwort in diesen Versuch übernehmen"
              onPress={() => setAnswer(legacyAnswer)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              label="Entwurf speichern"
              disabled={busy || !state}
              onPress={() => void action("save")}
            />
            <Button
              size="sm"
              label="Zur Korrektur abgeben"
              disabled={busy || !answer.trim() || !state}
              onPress={() => void action("submit")}
            />
          </div>
        </>
      )}
      {attempt?.status === "submitted" && (
        <>
          <Checkbox
            label="Antwort und zugehörige Quellen für diese Korrektur an Codex übermitteln"
            checked={consent}
            onCheckedChange={setConsent}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              label="Mit Codex prüfen"
              disabled={busy || !consent}
              onPress={() => void action("review")}
            />
            <Button
              size="sm"
              variant="ghost"
              label="Neuer Versuch"
              onPress={() => {
                setSelected(undefined);
                setAnswer("");
                setConsent(false);
              }}
            />
            <Button
              size="sm"
              variant="ghost"
              label="Rückmeldungen aktualisieren"
              onPress={() => void load()}
            />
          </div>
          {feedback.map((item) => (
            <section key={item.id} className="border-t border-border pt-3">
              <h4 className="text-sm font-medium">
                {outcomes[item.outcome]} · {item.reviewer}
              </h4>
              <SafeMarkdown>{item.comment}</SafeMarkdown>
            </section>
          ))}
          {!feedback.length && (
            <p className="text-xs text-text-muted">
              Noch keine Rückmeldung. Ein freigeschalteter Agent kann diesen
              abgegebenen Versuch lesen und seine Korrektur dazu speichern.
            </p>
          )}
        </>
      )}
      {aliasDrafts.length > 0 && (
        <details>
          <summary className="text-xs text-text-muted">
            Frühere Antworten zusammengeführter Aufgaben
          </summary>
          {aliasDrafts.map((draft) => (
            <section key={draft.id} className="my-3">
              <p className="text-xs text-text-muted">
                Ursprüngliche Aufgaben-ID {draft.id.slice(0, 8)}
              </p>
              <SafeMarkdown>{draft.answer}</SafeMarkdown>
            </section>
          ))}
        </details>
      )}
      {historical.length > 0 && (
        <details>
          <summary className="text-xs text-text-muted">
            {historical.length} Bearbeitungen früherer Aufgabenfassungen
          </summary>
          {historical.map((item) => (
            <section key={item.id} className="my-3 border-t border-border pt-3">
              <p className="text-xs text-text-muted">
                Fassung {item.versionId.slice(0, 8)} ·{" "}
                {new Date(item.updatedAt).toLocaleString("de-CH")}
              </p>
              <SafeMarkdown>{item.answer}</SafeMarkdown>
              {state?.feedback
                .filter((feedback) => feedback.attemptId === item.id)
                .map((feedback) => (
                  <div key={feedback.id}>
                    <strong>
                      {outcomes[feedback.outcome]} · {feedback.reviewer}
                    </strong>
                    <SafeMarkdown>{feedback.comment}</SafeMarkdown>
                  </div>
                ))}
            </section>
          ))}
        </details>
      )}
      <p className="text-xs text-text-muted">
        Keine Moodle-Abgabe und keine offizielle Bewertung. Abgegebene Antworten
        bleiben unverändert.
      </p>
    </div>
  );
}
