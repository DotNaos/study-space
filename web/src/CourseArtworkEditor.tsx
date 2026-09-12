import { useEffect, useRef, useState } from "react";
import { Button, Form, Icon, Textarea } from "@dotnaos/ui-base";
import { api, message, type Course } from "./api";
import { CourseArtwork } from "./CourseArtwork";
import { DialogShell } from "./DialogShell";
import { Notice, linkClass } from "./shared";
import { artworkGenerationUrl, artworkMimeTypes, courseArtworkPrompt, maxArtworkBytes } from "./course-artwork";

export function CourseArtworkEditor({ course, onChanged, onClose }: {
  course: Course;
  onChanged: (course: Course) => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [generate, setGenerate] = useState(false);
  const [prompt, setPrompt] = useState(() => courseArtworkPrompt(course));
  useEffect(() => {
    if (!selected) { setPreview(undefined); return; }
    const url = URL.createObjectURL(selected);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);

  function choose(file?: File) {
    setError(""); setStatus("");
    if (!file) return;
    if (!artworkMimeTypes.includes(file.type)) { setError("Bitte PNG, JPEG oder WebP auswählen."); return; }
    if (file.size > maxArtworkBytes) { setError("Das Bild darf höchstens 4 MiB groß sein."); return; }
    setSelected(file);
  }
  async function save(reset = false) {
    if (busy || (!reset && !selected)) return;
    setBusy(true); setError(""); setStatus("");
    try {
      const updated = await api<Course>(`/api/providers/moodle/courses/${course.id}/artwork`, reset
        ? { method: "DELETE" }
        : { method: "PUT", headers: { "Content-Type": selected!.type }, body: selected });
      onChanged(updated); setSelected(undefined);
      setStatus(reset ? "Standardbild wiederhergestellt." : "Kursbild gespeichert.");
    } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  }
  return (
    <DialogShell title="Kursbild" onClose={onClose}>
      <div className="space-y-5 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          {preview ? <img src={preview} alt="Vorschau des neuen Kursbilds" className="size-24 shrink-0 rounded-lg object-cover" />
            : <CourseArtwork course={course} eager className="size-24" />}
          <div className="min-w-0">
            <p className="break-words text-sm font-medium leading-5">{course.name}</p>
            <p className="mt-2 text-xs leading-5 text-text-muted">Nur in Study Space. Das Bild in Moodle bleibt unverändert.</p>
          </div>
        </div>
        <input ref={input} type="file" accept={artworkMimeTypes.join(",")} className="sr-only" tabIndex={-1}
          aria-label="Kursbild auswählen" disabled={busy}
          onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ""; }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button icon="image" label="Bild auswählen" disabled={busy} onPress={() => input.current?.click()} />
          {selected && <Button label={busy ? "Speichern …" : "Übernehmen"} variant="primary" disabled={busy} onPress={() => void save()} />}
          {course.hasCustomImage && !selected && (
            <div className="ml-auto">
              <Button
                variant="icon"
                icon="rotate-counter-clockwise"
                accessibilityLabel="Standardbild wiederherstellen"
                title="Standardbild wiederherstellen"
                disabled={busy}
                onPress={() => void save(true)}
              />
            </div>
          )}
        </div>
        <p className="text-xs text-text-muted">PNG, JPEG oder WebP · bis 4 MiB</p>
        {error && <Notice>{error}</Notice>}
        {status && <p role="status" className="text-sm text-text-muted">{status}</p>}
        <div className="border-t border-border/60 pt-3">
          <Button
            size="sm"
            variant="ghost"
            icon="sparkles"
            iconAfter={generate ? "chevron-up" : "chevron-down"}
            label="Mit ChatGPT generieren"
            pressed={generate}
            expanded={generate}
            onPress={() => setGenerate(!generate)}
          />
          {generate && <div className="mt-2 space-y-3">
            <Form.Field label="Bildbeschreibung">
              <Textarea
                id="artwork-prompt"
                value={prompt}
                rows={7}
                fullWidth
                onValueChange={(next) => setPrompt(next.slice(0, 2500))}
              />
            </Form.Field>
            <div className="flex flex-wrap items-center gap-4">
              <a href={artworkGenerationUrl(prompt)} target="_blank" rel="noopener noreferrer" className={`${linkClass} min-h-11`}>
                <Icon name="external-link" size="s" color="accent" /> In ChatGPT öffnen
              </a>
              <Button
                variant="ghost"
                size="sm"
                icon="copy"
                label="Prompt kopieren"
                onPress={() => {
                  if (!navigator.clipboard) { setError("Bitte die Bildbeschreibung markieren und kopieren."); return; }
                  void navigator.clipboard.writeText(prompt).then(() => setStatus("Bildbeschreibung kopiert.")).catch(() => setError("Bitte die Bildbeschreibung markieren und kopieren."));
                }}
              />
            </div>
            <p className="text-xs leading-5 text-text-muted">Die Bildgenerierung läuft in ChatGPT, nicht über Codex oder einen zusätzlichen API-Key. Das fertige Bild anschließend hier auswählen und übernehmen. Falls der Prompt nicht übernommen wird, kannst du ihn kopieren.</p>
          </div>}
        </div>
      </div>
    </DialogShell>
  );
}
