import { useState } from "react";
import { Checkbox, Input } from "@dotnaos/ui-base";
import type { PipelineUnit } from "./pipeline-api";
import { unitLabel } from "./learning-structure";

export function StructurePicker({ label, units, selected, multiple = false, emptyLabel = "Oberste Ebene", onChange }: {
  label: string; units: PipelineUnit[]; selected: string[]; multiple?: boolean; emptyLabel?: string;
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = units.filter(unit => (unitLabel(unit) + " " + unit.title).toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  return <details className="structure-picker">
    <summary>{label}<span>{multiple ? `${selected.length} zugeordnet` : selected.length ? unitLabel(units.find(unit => unit.id === selected[0]) ?? {id:"",title:"Unbekannt",parentId:null,order:0}) : emptyLabel}</span></summary>
    <div className="structure-picker-body">
      <Input size="sm" fullWidth accessibilityLabel={`${label} suchen`} placeholder="Suchen …" value={query} onValueChange={setQuery} />
      <div className="structure-picker-options" aria-label={label}>
        {!multiple && <button type="button" aria-pressed={!selected.length} onClick={() => onChange([])}>{emptyLabel}</button>}
        {matches.map(unit => <div key={unit.id} title={unitLabel(unit)}>
          {multiple ? <Checkbox label={unitLabel(unit)} checked={selected.includes(unit.id)} onCheckedChange={checked => onChange(checked ? [...selected,unit.id] : selected.filter(id => id !== unit.id))} />
            : <button type="button" aria-pressed={selected.includes(unit.id)} onClick={() => onChange([unit.id])}>{unitLabel(unit)}</button>}
        </div>)}
        {!matches.length && <p className="pipeline-muted">Keine passenden Einträge.</p>}
      </div>
    </div>
  </details>;
}
