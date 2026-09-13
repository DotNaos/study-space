import "./structure-editor.css";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Textarea } from "@dotnaos/ui-base";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { PipelineState, PipelineUnit } from "./pipeline-api";
import { moveKind, moveParent, orderedSiblings, reorderUnits, structureDraft, unitHidden, unitLabel, type UnitKind } from "./learning-structure";
import { StructureRow } from "./StructureRow";

export function PipelineStructure({ state, busy, onSave }: {
  state: PipelineState; busy: boolean; onSave: (units: PipelineUnit[], reason: string) => Promise<void>;
}) {
  const [units,setUnits] = useState(() => structureDraft(state));
  const [kind,setKind] = useState<UnitKind>("script");
  const [parentId,setParentId] = useState<string|null>(null);
  const [showHidden,setShowHidden] = useState(false);
  const [reason,setReason] = useState("");
  const [noteOpen,setNoteOpen] = useState(false);
  const [focusId,setFocusId] = useState<string>();
  const listRef = useRef<HTMLUListElement>(null);
  const noteId = useId();
  const [expanded,setExpanded] = useState<string>();
  const sensors = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const siblings = orderedSiblings(units,kind,parentId);
  const hiddenCount = siblings.filter(unit => unitHidden(unit,units)).length;
  const visible = siblings.filter(unit => showHidden || !unitHidden(unit,units));
  const parent = units.find(unit => unit.id === parentId);
  useEffect(() => {
    if (!focusId) return;
    const input = listRef.current?.querySelector<HTMLInputElement>(`[data-unit-id="${focusId}"] input`);
    input?.focus(); input?.select();
  }, [focusId]);
  function tab(value: UnitKind) { setKind(value);setParentId(null);setExpanded(undefined);setShowHidden(false); }
  function change(id: string, patch: Partial<PipelineUnit>) { setUnits(current => current.map(unit => unit.id===id?{...unit,...patch}:unit)); }
  function dragEnd(event: DragEndEvent) { if(event.over) setUnits(current => reorderUnits(current,String(event.active.id),String(event.over!.id))); }
  function add() {
    const id=crypto.randomUUID().replaceAll("-","");
    setUnits(current => [...current,{id,title:kind==="script"?"Neue Lerneinheit":"Neue Aufgabengruppe",parentId,order:Math.max(-1,...siblings.map(unit=>unit.order))+1,kind,hidden:false,customTitle:null,sourceGroupId:null,scriptUnitIds:[]}]);
    setExpanded(undefined); setShowHidden(false); setFocusId(id);
  }
  return <div className="pipeline-structure">
    <h2>Lernstruktur</h2><p className="pipeline-muted">Eigene Gliederung und Anzeigenamen. Moodle-Quellen bleiben unverändert.</p>
    <div className="structure-toolbar">
      <div className="structure-tabs" role="group" aria-label="Bereich der Lernstruktur">
        <Button size="sm" variant="ghost" label="Skript" pressed={kind==="script"} onPress={()=>tab("script")} />
        <Button size="sm" variant="ghost" label="Aufgaben" pressed={kind==="tasks"} onPress={()=>tab("tasks")} />
      </div>
      {hiddenCount>0 && <Button size="sm" variant="ghost" label={`Ausgeblendete (${hiddenCount})`} pressed={showHidden} onPress={()=>setShowHidden(!showHidden)} />}
    </div>
    {parent && <div className="structure-path"><Button size="sm" variant="ghost" icon="arrow-left" label="Zurück" onPress={()=>{setParentId(parent.parentId);setExpanded(undefined);}} /><span title={unitLabel(parent)}>{unitLabel(parent)}</span></div>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd} accessibility={{screenReaderInstructions:{draggable:"Leertaste zum Aufnehmen, Pfeiltasten zum Verschieben, Leertaste zum Ablegen, Escape zum Abbrechen."}}}>
      <SortableContext items={visible.map(unit=>unit.id)} strategy={verticalListSortingStrategy}>
        <ul ref={listRef} className="structure-list" aria-label={kind==="script"?"Skript-Lerneinheiten":"Aufgabengruppen"}>
          {visible.map(unit => <StructureRow key={unit.id} unit={unit} units={units} disabled={busy} expanded={expanded===unit.id}
            onToggle={()=>setExpanded(expanded===unit.id?undefined:unit.id)} onChange={patch=>change(unit.id,patch)}
            onHide={hidden=>{change(unit.id,{hidden});setExpanded(undefined);}} onOpen={()=>{setParentId(unit.id);setExpanded(undefined);}}
            onParent={parent=>setUnits(current=>moveParent(current,unit.id,parent))}
            onKind={()=>{setUnits(current=>moveKind(current,unit.id,kind==="script"?"tasks":"script"));setExpanded(undefined);}} />)}
        </ul>
      </SortableContext>
    </DndContext>
    {!visible.length && <p className="pipeline-muted">{hiddenCount?"Alle Einträge dieser Ebene sind ausgeblendet.":"Noch keine Einträge in diesem Bereich."}</p>}
    <Button size="sm" variant="ghost" icon="plus" label={kind==="script"?"Lerneinheit hinzufügen":"Aufgabengruppe hinzufügen"} disabled={busy} onPress={add} />
    <footer className="structure-footer">
      <div className="structure-note">
        <Button size="sm" variant="ghost" label={noteOpen ? "Notiz schließen" : reason ? "Notiz bearbeiten" : "Notiz hinzufügen"} icon="pencil-line" expanded={noteOpen} controls={noteId} onPress={()=>setNoteOpen(!noteOpen)}/>
        {noteOpen && <div id={noteId}><Textarea accessibilityLabel="Optionale Begründung" rows={2} fullWidth value={reason} disabled={busy} onValueChange={setReason}/></div>}
      </div>
      <Button size="sm" label={busy?"Wird gespeichert …":"Struktur speichern"} disabled={busy||units.some(unit=>!unitLabel(unit).trim())}
        onPress={()=>void onSave(units,reason.trim()||"Lernstruktur angepasst: Reihenfolge, Zuordnungen, Anzeigenamen und Sichtbarkeit geprüft.")} />
    </footer>
  </div>;
}
