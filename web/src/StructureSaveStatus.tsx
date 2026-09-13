import { Check, Cloud, CloudOff, LoaderCircle, AlertTriangle, RotateCcw } from "lucide-react";
import type { SaveStatus } from "./structure-autosave";

const labels: Record<SaveStatus, string> = {
  proposal: "Vorschlag", saved: "Gespeichert", pending: "Änderungen werden gespeichert",
  saving: "Wird gespeichert", error: "Nicht gespeichert", conflict: "Änderungskonflikt", invalid: "Anzeigename fehlt oder ist zu lang",
};
export function StructureSaveStatus({ status, onRetry, onConflict }: { status: SaveStatus; onRetry: () => void; onConflict: () => void }) {
  const Icon = status === "saved" ? Check : status === "error" ? CloudOff : status === "conflict" || status === "invalid" ? AlertTriangle : status === "proposal" ? Cloud : LoaderCircle;
  return <div className="structure-save-state" data-state={status} role="status" aria-live="polite" title={labels[status]}>
    <Icon size={16} aria-hidden="true" className={status === "saving" || status === "pending" ? "prepare-spin" : undefined} />
    <span>{status === "pending" || status === "saving" ? "Speichert …" : labels[status]}</span>
    {status === "error" && <button type="button" onClick={onRetry} aria-label="Speichern erneut versuchen" title="Erneut versuchen"><RotateCcw size={17}/></button>}
    {status === "conflict" && <button type="button" onClick={onConflict}>Vergleichen</button>}
  </div>;
}
