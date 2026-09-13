import { useId, useRef, useState } from "react";
import { Button, Checkbox, Input } from "@dotnaos/ui-base";
import type { PipelineUnit } from "./pipeline-api";
import { unitLabel } from "./learning-structure";

export function StructurePicker({ label, units, selected, multiple = false, emptyLabel = "Oberste Ebene", disabled = false, onChange }: {
  label: string; units: PipelineUnit[]; selected: string[]; multiple?: boolean; emptyLabel?: string;
  disabled?: boolean; onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLDivElement>(null);
  const matches = units.filter(unit => (unitLabel(unit) + " " + unit.title).toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const value = multiple ? selected.length ? `${selected.length} zugeordnet` : "Skript zuordnen" : selected.length ? unitLabel(units.find(unit => unit.id === selected[0]) ?? {id:"",title:"Unbekannt",parentId:null,order:0}) : emptyLabel;
  function close() { setOpen(false); setQuery(""); trigger.current?.querySelector("button")?.focus(); }
  return <div className="structure-picker" onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <span id={`${id}-label`} className="structure-field-label">{label}</span>
    <div ref={trigger} className="structure-picker-trigger">
      <Button size="sm" variant="secondary" label={value} accessibilityLabel={`${label}: ${value}`} title={value}
        iconAfter={open ? "chevron-up" : "chevron-down"} expanded={open} controls={id} disabled={disabled}
        onPress={() => { setOpen(!open); setQuery(""); }} />
    </div>
    {open && <div id={id} className="structure-picker-body" role="group" aria-labelledby={`${id}-label`}>
      {units.length > 5 && <Input size="sm" fullWidth accessibilityLabel={`${label} suchen`} placeholder="Suchen …" value={query} onValueChange={setQuery} disabled={disabled} />}
      <div className="structure-picker-options">
        {!multiple && <button type="button" aria-pressed={!selected.length} disabled={disabled} onClick={() => { onChange([]); close(); }}>{emptyLabel}</button>}
        {matches.map(unit => <div key={unit.id} title={unitLabel(unit)}>
          {multiple ? <Checkbox label={unitLabel(unit)} checked={selected.includes(unit.id)} disabled={disabled}
            onCheckedChange={checked => onChange(checked ? [...selected,unit.id] : selected.filter(id => id !== unit.id))} />
            : <button type="button" aria-pressed={selected.includes(unit.id)} disabled={disabled} onClick={() => { onChange([unit.id]); close(); }}>{unitLabel(unit)}</button>}
        </div>)}
        {!matches.length && <p className="pipeline-muted">Keine passenden Einträge.</p>}
      </div>
    </div>}
  </div>;
}
