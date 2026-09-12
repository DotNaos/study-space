import { useEffect, useRef, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { Copy, ExternalLink, ImagePlus, RotateCcw, Sparkles } from "lucide-react";
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
          <ImagePlus size={18} aria-hidden="true" />
          <Button label="Bild auswählen" disabled={busy} onPress={() => input.current?.click()} />
          {selected && <Button label={busy ? "Speichern …" : "Übernehmen"} variant="primary" disabled={busy} onPress={() => void save()} />}
          {course.hasCustomImage && !selected && <button type="button" disabled={busy} onClick={() => void save(true)}
            className="ml-auto flex size-11 items-center justify-center rounded-md text-text-muted hover:bg-bg-1 disabled:opacity-50"
            aria-label="Standardbild wiederherstellen" title="Standardbild wiederherstellen"><RotateCcw size={18} /></button>}
        </div>
        <p className="text-xs text-text-muted">PNG, JPEG oder WebP · bis 4 MiB</p>
        {error && <Notice>{error}</Notice>}
        {status && <p role="status" className="text-sm text-text-muted">{status}</p>}
        <div className="border-t border-border/60 pt-3">
          <button type="button" aria-expanded={generate} onClick={() => setGenerate(!generate)}
            className="flex min-h-11 items-center gap-2 rounded-md text-sm hover:text-accent">
            <Sparkles size={17} aria-hidden="true" /> Mit ChatGPT generieren
          </button>
          {generate && <div className="mt-2 space-y-3">
            <label className="block text-xs text-text-muted" htmlFor="artwork-prompt">Bildbeschreibung</label>
            <textarea id="artwork-prompt" value={prompt} maxLength={2500} onChange={(event) => setPrompt(event.target.value)} rows={7}
              className="w-full resize-y rounded-md border border-border bg-bg-1 p-3 text-base leading-6 outline-focus-ring sm:text-sm" />
            <div className="flex flex-wrap items-center gap-4">
              <a href={artworkGenerationUrl(prompt)} target="_blank" rel="noopener noreferrer" className={`${linkClass} min-h-11`}>
                <ExternalLink size={16} aria-hidden="true" /> In ChatGPT öffnen
              </a>
              <button type="button" className={`${linkClass} min-h-11`} onClick={() => {
                if (!navigator.clipboard) { setError("Bitte die Bildbeschreibung markieren und kopieren."); return; }
                void navigator.clipboard.writeText(prompt).then(() => setStatus("Bildbeschreibung kopiert.")).catch(() => setError("Bitte die Bildbeschreibung markieren und kopieren."));
              }}><Copy size={16} aria-hidden="true" /> Prompt kopieren</button>
            </div>
            <p className="text-xs leading-5 text-text-muted">Die Bildgenerierung läuft in ChatGPT, nicht über Codex oder einen zusätzlichen API-Key. Das fertige Bild anschließend hier auswählen und übernehmen. Falls der Prompt nicht übernommen wird, kannst du ihn kopieren.</p>
          </div>}
        </div>
      </div>
    </DialogShell>
  );
}
