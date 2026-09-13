import "./structure-editor.css";
import { useEffect, useRef, useState } from "react";
import { Button } from "@dotnaos/ui-base";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { PipelineState, PipelineUnit } from "./pipeline-api";
import { moveKind, moveParent, orderedSiblings, reorderUnits, unitHidden, unitLabel, type UnitKind } from "./learning-structure";
import { StructureRow } from "./StructureRow";
import { useStructureAutosave } from "./useStructureAutosave";
import { StructureSaveStatus } from "./StructureSaveStatus";
import type { StructureSave } from "./structure-autosave";
import { readPipeline } from "./pipeline-api";
import { DialogShell } from "./DialogShell";

export function PipelineStructure({ state, busy, onSave, onContinue, onGuard }: {
  state: PipelineState; busy: boolean; onSave: StructureSave;
  onContinue?: (state: PipelineState) => void;
  onGuard?: (guard: (() => Promise<boolean>) | null) => void;
}) {
  const { units, status, error: saveError, queue, retry } = useStructureAutosave(state, onSave, onGuard);
  const setUnits = queue.update;
  const [continuing, setContinuing] = useState(false);
  const [conflict, setConflict] = useState<PipelineState>();
  const [conflictError, setConflictError] = useState("");
  async function compare() {
    try { const remote = await readPipeline(state.courseId); queue.accept(remote); if (queue.getSnapshot().status === "conflict") setConflict(remote); setConflictError(""); }
    catch { setConflictError("Server nicht erreichbar. Dein Entwurf bleibt erhalten."); }
  }
  async function next() {
    setContinuing(true);
    try { if (await queue.flush(true)) onContinue?.(await readPipeline(state.courseId)); }
    catch { setConflictError("Quellen konnten nicht geladen werden. Erneut versuchen."); }
    finally { setContinuing(false); }
  }
  const [kind,setKind] = useState<UnitKind>("script");
  const [parentId,setParentId] = useState<string|null>(null);
  const [showHidden,setShowHidden] = useState(false);
  const [focusId,setFocusId] = useState<string>();
  const listRef = useRef<HTMLUListElement>(null);
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
    <div className="prepare-section-heading"><h2>Lernstruktur</h2><StructureSaveStatus status={status} onRetry={()=>void retry()} onConflict={()=>void compare()} /></div>
    <div className="structure-toolbar">
      <div className="structure-tabs" role="group" aria-label="Bereich der Lernstruktur">
        <Button size="sm" variant="ghost" icon="file-text" label="Skript" pressed={kind==="script"} onPress={()=>tab("script")} />
        <Button size="sm" variant="ghost" icon="pencil-line" label="Aufgaben" pressed={kind==="tasks"} onPress={()=>tab("tasks")} />
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
    {(saveError || conflictError) && <p className="prepare-error" role="alert">{conflictError || (status === "conflict" ? "Anderer Stand vorhanden. Dein Entwurf bleibt erhalten." : saveError)}</p>}
    <footer className="structure-footer prepare-next">
      <span className="prepare-next-count">{state.sources.filter(source => source.status === "pending" || source.status === "stale").length} Quellen offen</span>
      <Button label={continuing ? "Bitte warten …" : state.sources.some(source=>source.source.present && (source.status === "pending" || source.status === "stale")) ? "Quellen zuordnen" : "Zur Erstellung"} iconAfter="arrow-right" disabled={busy || continuing || status === "conflict" || status === "error" || status === "invalid" || !units.some(unit=>!unitHidden(unit,units))} onPress={()=>void next()}/>
    </footer>
    {conflict && <DialogShell title="Struktur vergleichen" onClose={()=>setConflict(undefined)}>
      <div className="structure-options">
        <div className="prepare-conflict-columns">
          <div><h3>Dein Entwurf</h3><ul>{units.map(unit=><li key={unit.id}>{unitLabel(unit)}{unit.hidden ? " · ausgeblendet" : ""}</li>)}</ul></div>
          <div><h3>Gespeicherter Stand</h3><ul>{conflict.units.map(unit=><li key={unit.id}>{unitLabel(unit)}{unit.hidden ? " · ausgeblendet" : ""}</li>)}</ul></div>
        </div>
        <Button variant="secondary" label="Gespeicherten Stand verwenden" onPress={()=>{queue.resolve(conflict,false);setConflict(undefined);}}/>
        <Button label="Meinen Entwurf übernehmen" onPress={()=>{queue.resolve(conflict,true);setConflict(undefined);}}/>
      </div>
    </DialogShell>}
  </div>;
}
