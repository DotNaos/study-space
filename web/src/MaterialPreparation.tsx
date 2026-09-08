import { Button } from "@dotnaos/ui-base";
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileText,
  Loader2,
} from "lucide-react";
import {
  materialDocumentPath,
  type MaterialEntry,
  type MaterialState,
} from "./material-api";
import { runningJob } from "./learning-api";
import type { SourceSelection } from "./SourceViewer";
import { Loading, Notice } from "./shared";

function statusLabel(entry: MaterialEntry) {
  if (entry.status === "ready")
    return entry.warnings.length ? "Mit Hinweisen erfasst" : "Erfasst";
  return (
    (
      {
        pending: "Wartet",
        downloading: "Wird geladen",
        extracting: "Wird erfasst",
        failed: "Fehlgeschlagen",
        unsupported: "Nicht unterstützt",
        cancelled: "Abgebrochen",
      } as Record<string, string>
    )[entry.status] || "Nicht erfasst"
  );
}
export function MaterialPreparation({
  materials,
  connected,
  onSource,
  expanded = false,
}: {
  materials: MaterialState;
  connected: boolean;
  onSource: (source: SourceSelection) => void;
  expanded?: boolean;
}) {
  const { snapshot, busy, error } = materials;
  const running = runningJob(snapshot?.job);
  const coverage = snapshot?.coverage;
  return (
    <section
      aria-label="Materialabdeckung"
      className="space-y-4 border-b border-border py-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">
            {coverage?.total
              ? `${coverage.ready} von ${coverage.total} Materialien erfasst`
              : "Materialien für deinen Lernbereich"}
          </h2>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {running
              ? "Die Inhalte werden auf deinem Rechner vorbereitet."
              : coverage?.ready
                ? coverage.complete
                  ? "Alle erkannten Materialien sind vollständig erfasst."
                  : "Teilweise erfasst: Nicht lesbare oder fehlende Inhalte werden nicht ergänzt."
                : "Erfasse zuerst die Kursinhalte. Das läuft lokal, ohne Übertragung an OpenAI."}
          </p>
        </div>
        {running ? (
          <Button
            variant="ghost"
            label="Erfassung abbrechen"
            disabled={busy}
            onPress={() => void materials.cancel()}
          />
        ) : (
          <Button
            variant={coverage?.ready ? "ghost" : "secondary"}
            label={
              busy
                ? "Wird gestartet …"
                : coverage?.total
                  ? "Materialien aktualisieren"
                  : "Materialien erfassen"
            }
            disabled={busy || !connected}
            onPress={() => void materials.importMaterials()}
          />
        )}
      </div>
      {!connected && (
        <p className="text-xs text-text-muted">
          Gespeicherte Quellen bleiben verfügbar. Zum Aktualisieren bitte Moodle
          unter Quellen verbinden.
        </p>
      )}
      {running && snapshot?.job && (
        <div role="status" className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={14} className="motion-safe:animate-spin" />
            {snapshot.job.total > 0
              ? `${snapshot.job.completed} von ${snapshot.job.total} Materialien verarbeitet`
              : "Materialien werden gesammelt …"}
          </div>
          {snapshot.job.total > 0 && (
            <progress
              className="h-1 w-full accent-accent"
              aria-label="Materialien verarbeitet"
              value={snapshot.job.completed}
              max={snapshot.job.total}
            />
          )}
        </div>
      )}
      {error && (
        <div className="space-y-2">
          <Notice>{error}</Notice>
          {!snapshot && (
            <Button
              label="Erneut laden"
              variant="ghost"
              onPress={() => void materials.refresh().catch(() => {})}
            />
          )}
        </div>
      )}
      {snapshot?.job?.error && !error && <Notice>{snapshot.job.error}</Notice>}
      {!snapshot && !error && (
        <Loading label="Gespeicherte Materialien werden geprüft …" />
      )}
      {!!snapshot?.materials.length && (
        <details open={expanded || undefined} className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-xs font-medium text-text-muted focus-visible:outline-2 focus-visible:outline-focus-ring">
            <ChevronDown
              size={14}
              className="transition-transform group-open:rotate-180"
            />
            Materialien und Hinweise
            {coverage && !coverage.complete && (
              <span className="text-warning">· Unvollständig</span>
            )}
          </summary>
          <ul className="mt-3 divide-y divide-border/60">
            {snapshot.materials.map((entry) => {
              const path =
                entry.revision &&
                materialDocumentPath(entry.id, entry.revision);
              const canOpen = path && entry.documentUrl === path;
              const content = (
                <>
                  <span className="mt-1 shrink-0 text-text-muted">
                    {entry.status === "ready" && !entry.warnings.length ? (
                      <Check size={15} className="text-success" />
                    ) : ["failed", "unsupported", "cancelled"].includes(
                        entry.status,
                      ) || entry.warnings.length ? (
                      <AlertCircle size={15} className="text-warning" />
                    ) : (
                      <FileText size={15} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm">
                      {entry.name}
                    </span>
                    <span className="mt-0.5 block break-words text-xs leading-5 text-text-muted">
                      {statusLabel(entry)}
                      {entry.reason && ` · ${entry.reason}`}
                    </span>
                    {entry.warnings.map((warning, index) => (
                      <span
                        key={index}
                        className="block break-words text-xs leading-5 text-text-muted"
                      >
                        {warning}
                      </span>
                    ))}
                  </span>
                </>
              );
              return (
                <li key={entry.id}>
                  {canOpen ? (
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 rounded-md px-2 py-3 text-left hover:bg-bg-1 focus-visible:outline-2 focus-visible:outline-focus-ring"
                      onClick={() =>
                        onSource({
                          materialId: entry.id,
                          revision: entry.revision!,
                          name: entry.name,
                        })
                      }
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="flex items-start gap-3 px-2 py-3">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
