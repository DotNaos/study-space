import { useState } from "react";
import { Button, Form, Input, Textarea } from "@dotnaos/ui-base";
import { api, message } from "./api";
import {
  learningPath,
  type LearningSection,
  type LearningVersion,
} from "./learning-api";
import { SafeMarkdown } from "./SafeMarkdown";
import { Notice } from "./shared";

export function SectionEditor({
  courseId,
  version,
  section,
  activeVersionId,
  onCancel,
  onSaved,
}: {
  courseId: number;
  version: LearningVersion;
  section: LearningSection;
  activeVersionId: string | null;
  onCancel: () => void;
  onSaved: (version: LearningVersion) => void;
}) {
  const [content, setContent] = useState(section.markdown);
  const [title, setTitle] = useState(section.title);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await api<LearningVersion>(
        `${learningPath(courseId)}/sections/${section.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            baseVersionId: version.id,
            expectedActiveVersionId: activeVersionId,
            title,
            content,
            reason,
            actor: "user",
          }),
        },
      );
      onSaved(next);
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="my-4 space-y-4 rounded-md border border-border p-4"
      aria-label="Skriptabschnitt bearbeiten"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Lern-MDX bearbeiten</strong>
        <Button
          variant="ghost"
          size="sm"
          label={preview ? "Quelltext" : "Vorschau"}
          onPress={() => setPreview(!preview)}
        />
      </div>
      <Form.Field label="Überschrift">
        <Input value={title} onValueChange={setTitle} />
      </Form.Field>
      {preview ? (
        <SafeMarkdown mdx={{ version }}>{content}</SafeMarkdown>
      ) : (
        <Form.Field label="MDX-Quelltext">
          <Textarea
            rows={16}
            fullWidth
            value={content}
            onValueChange={setContent}
          />
        </Form.Field>
      )}
      <p className="text-xs leading-5 text-text-muted">
        Markdown, Formeln und die registrierten Komponenten Figure und TaskRef.
        Komponenten stehen mit wörtlichen Attributen auf einer eigenen, durch
        Leerzeilen getrennten Zeile. Kein JavaScript oder HTML. Änderungen
        werden als neue Kandidatenfassung gespeichert; die aktive Fassung und
        Antworten bleiben erhalten.
      </p>
      <details className="text-xs text-text-muted">
        <summary>Komponenten einfügen</summary>
        <pre className="mt-2 max-w-full overflow-auto">
          {
            '<TaskRef id="AUFGABEN_ID" />\n\n<Figure materialId="MATERIAL_ID" revision="QUELLREVISION" assetId="ASSET_ID" alt="Beschreibung" />'
          }
        </pre>
      </details>
      <Form.Field label="Änderungsgrund">
        <Textarea rows={2} fullWidth value={reason} onValueChange={setReason} />
      </Form.Field>
      {error && <Notice>{error}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button
          label={busy ? "Wird gespeichert …" : "Als Kandidat speichern"}
          disabled={busy || !reason.trim() || !title.trim()}
          onPress={() => void save()}
        />
        <Button
          variant="ghost"
          label="Abbrechen"
          disabled={busy}
          onPress={onCancel}
        />
      </div>
    </div>
  );
}
