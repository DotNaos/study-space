import { BookOpen, ListTree } from "lucide-react";

export function PreparationSteps({ tab, open, disabled = false, onStructure, onContent }: {
  tab: "structure" | "content";
  open: number;
  disabled?: boolean;
  onStructure: () => void;
  onContent: () => void;
}) {
  return <nav className="prepare-tabs" aria-label="Aufbereitung">
    <button type="button" aria-current={tab === "structure" ? "page" : undefined} disabled={disabled} onClick={onStructure}>
      <ListTree size={18} aria-hidden="true"/><span>Struktur</span>{open>0&&<small aria-label={`${open} Quellen offen`}>{open}</small>}
    </button>
    <button type="button" aria-current={tab === "content" ? "page" : undefined} disabled={disabled} onClick={onContent}>
      <BookOpen size={18} aria-hidden="true"/><span>Inhalt</span>
    </button>
  </nav>;
}
