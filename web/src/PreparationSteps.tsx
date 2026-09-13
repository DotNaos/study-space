import { Check, ChevronRight, ListTree, Link2, BookOpen } from "lucide-react";

export function PreparationSteps({ step, structured, open, disabled = false, onStructure, onSources, onCreate }: {
  step: "structure" | "sources" | "create"; structured: boolean; open: number; disabled?: boolean;
  onStructure: () => void; onSources: () => void; onCreate: () => void;
}) {
  const steps = [
    { id: "structure", label: "Struktur", Icon: ListTree, done: structured, action: onStructure, locked: false },
    { id: "sources", label: "Quellen", Icon: Link2, done: structured && open === 0, action: onSources, locked: !structured },
    { id: "create", label: "Erstellen", Icon: BookOpen, done: false, action: onCreate, locked: !structured },
  ];
  return <nav className="prepare-steps" aria-label="Aufbereitungsschritte">
    {steps.map(({ id, label, Icon, done, action, locked }, index) => <div key={id}>
      {index > 0 && <ChevronRight size={16} className="prepare-step-arrow" aria-hidden="true"/>}
      <button type="button" aria-current={step === id ? "step" : undefined} data-done={done && step !== id || undefined} disabled={disabled || locked} onClick={action}>
        <span className="prepare-step-icon">{done && step !== id ? <Check size={18}/> : <Icon size={18}/>}</span><span>{label}</span>
        {id === "sources" && open > 0 && <small aria-label={`${open} Einordnungen offen`}>{open}</small>}
      </button>
    </div>)}
  </nav>;
}
