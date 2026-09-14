import { BookOpen, ListTree } from "lucide-react";

export function PreparationSteps({ open, disabled = false, onStructure, onCreate }: {
  open: number; disabled?: boolean; onStructure: () => void; onCreate: () => void;
}) {
  return <nav className="prepare-tabs" aria-label="Aufbereitung">
    <button type="button" aria-current="page" disabled={disabled} onClick={onStructure}>
      <ListTree size={18} aria-hidden="true"/><span>Struktur</span>{open>0&&<small aria-label={`${open} Quellen offen`}>{open}</small>}
    </button>
    <button type="button" disabled={disabled} onClick={onCreate}>
      <BookOpen size={18} aria-hidden="true"/><span>Inhalt</span>
    </button>
  </nav>;
}
