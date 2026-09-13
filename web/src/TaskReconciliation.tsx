import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Form,
  Input,
  Select,
  Textarea,
} from "@dotnaos/ui-base";
import { api, message } from "./api";
import { learningPath, type LearningVersion } from "./learning-api";
import { SafeMarkdown } from "./SafeMarkdown";
import { SourceChips, type SourceSelection } from "./SourceViewer";
import { Notice } from "./shared";

export function TaskReconciliation({
  courseId,
  version,
  activeVersionId,
  onCandidate,
  onSource,
}: {
  courseId: number;
  version: LearningVersion;
  activeVersionId: string | null;
  onCandidate: (version: LearningVersion) => void;
  onSource: (source: SourceSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState(version.exercises[0]?.id ?? "");
  const [merge, setMerge] = useState<string[]>([]);
  const [solutions, setSolutions] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const task = version.exercises.find((task) => task.id === id);
  const candidates = useMemo(
    () =>
      version.exercises.filter(
        (item) =>
          item.id !== id &&
          (!query.trim() ||
            (item.title + " " + item.prompt)
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase())),
      ),
    [version, id, query],
  );
  const pending = version.pendingSolutions ?? [];
  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await api<LearningVersion>(
        `${learningPath(courseId)}/versions/${version.id}/tasks/reconcile`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedActiveVersionId: activeVersionId,
            canonicalTaskId: id,
            mergeTaskIds: merge,
            solutionIds: solutions,
            reason,
            actor: "user",
          }),
        },
      );
      onCandidate(next);
      setOpen(false);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <Button
        variant="ghost"
        size="sm"
        label={`Aufgaben und Lösungen abgleichen${pending.length ? ` · ${pending.length} Lösungen offen` : ""}`}
        disabled={!version.exercises.length}
        onPress={() => setOpen(true)}
      />
    );
  return (
    <section
      className="my-4 space-y-4 border-y border-border py-4"
      aria-label="Aufgaben abgleichen"
    >
      <h3 className="text-base font-medium">
        Eine Aufgabe, mehrere Fundstellen
      </h3>
      <p className="text-xs leading-5 text-text-muted">
        Wähle nur tatsächlich identische Aufgaben. Der Abgleich erstellt eine
        neue Kandidatenfassung. Frühere Aufgaben-IDs, Antworten und Versionen
        bleiben erhalten.
      </p>
      <Select
        accessibilityLabel="Beizubehaltende Aufgabe"
        value={id}
        options={version.exercises.map((item) => ({
          value: item.id,
          label: item.title + " · " + item.id.slice(0, 6),
        }))}
        onValueChange={(value) => {
          setId(value);
          setMerge([]);
          setSolutions([]);
        }}
      />
      {task && (
        <>
          <SafeMarkdown>{task.prompt}</SafeMarkdown>
          <SourceChips
            references={task.sources}
            sources={version.sources}
            onOpen={onSource}
          />
        </>
      )}
      <Form.Field label="Weitere Aufgaben suchen">
        <Input
          value={query}
          onValueChange={setQuery}
          placeholder="Titel oder Aufgabentext"
        />
      </Form.Field>
      <div className="max-h-64 space-y-3 overflow-y-auto">
        {candidates.map((item) => (
          <div key={item.id}>
            <Checkbox
              label={`${item.title} · ${item.id.slice(0, 6)}`}
              checked={merge.includes(item.id)}
              onCheckedChange={(checked) =>
                setMerge(
                  checked
                    ? [...merge, item.id]
                    : merge.filter((id) => id !== item.id),
                )
              }
            />
            <details className="ml-6">
              <summary className="text-xs text-text-muted">
                Aufgabenstellung und Quellen
              </summary>
              <SafeMarkdown>{item.prompt}</SafeMarkdown>
              <SourceChips
                references={item.sources}
                sources={version.sources}
                onOpen={onSource}
              />
            </details>
          </div>
        ))}
      </div>
      {!!pending.length && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Musterlösungen zuordnen</h4>
          {pending.map((solution) => (
            <div key={solution.id}>
              <Checkbox
                label={solution.title}
                checked={solutions.includes(solution.id)}
                onCheckedChange={(checked) =>
                  setSolutions(
                    checked
                      ? [...solutions, solution.id]
                      : solutions.filter((id) => id !== solution.id),
                  )
                }
              />
              <details className="ml-6">
                <summary className="text-xs text-text-muted">
                  Aufbereitete Lösung und Original
                </summary>
                <SafeMarkdown>{solution.text}</SafeMarkdown>
                <SourceChips
                  references={solution.sources}
                  sources={version.sources}
                  onOpen={onSource}
                />
              </details>
            </div>
          ))}
        </div>
      )}
      <Form.Field label="Begründung des Abgleichs">
        <Textarea rows={2} fullWidth value={reason} onValueChange={setReason} />
      </Form.Field>
      {error && <Notice>{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button
          label="Abgleich als Kandidat speichern"
          disabled={
            busy || !reason.trim() || (!merge.length && !solutions.length)
          }
          onPress={() => void save()}
        />
        <Button
          variant="ghost"
          label="Abbrechen"
          disabled={busy}
          onPress={() => setOpen(false)}
        />
      </div>
    </section>
  );
}
