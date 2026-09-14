import "./structure-editor.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@dotnaos/ui-base";
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Focus, ListTree } from "lucide-react";
import type { MappingItem, PipelineSourceView, PipelineState, PipelineUnit } from "./pipeline-api";
import { moveKind, moveParent, reorderUnits, unitHidden, unitKind, unitLabel } from "./learning-structure";
import { StructureRow } from "./StructureRow";
import { useStructureAutosave } from "./useStructureAutosave";
import { StructureSaveStatus } from "./StructureSaveStatus";
import type { StructureSave } from "./structure-autosave";
import { readPipeline } from "./pipeline-api";
import { DialogShell } from "./DialogShell";
import { MappingRow } from "./SourceMappingBoard";
import { batchProposalFor, displayMapping, primaryUse } from "./source-mapping";
import { useMappingAutosave } from "./useMappingAutosave";

function sourceOwner(units: PipelineUnit[], item: PipelineSourceView) {
  const target = primaryUse(item)?.unitId;
  if (target && units.some(unit => unit.id === target)) return target;
  return units.find(unit => unit.sourceGroupId === item.source.sectionId)?.id;
}

function sourceItems(state: PipelineState, units: PipelineUnit[], unit: PipelineUnit) {
  return state.sources.filter(item => sourceOwner(units, item) === unit.id);
}

function orderedSources(state: PipelineState, items: PipelineSourceView[]) {
  return [...items].sort((a,b) => {
    const ao=primaryUse(a)?.order, bo=primaryUse(b)?.order;
    if (ao != null || bo != null) return (ao ?? 1_000_000) - (bo ?? 1_000_000);
    return state.sources.indexOf(a) - state.sources.indexOf(b);
  });
}

type MappingActions = {
  disabled: boolean;
  enqueue: (items: MappingItem[]) => void;
  before: () => Promise<boolean>;
  onOpen: (item: PipelineSourceView, unitId: string) => void;
};

function NestedSources({state,unit,units,actions}:{state:PipelineState;unit:PipelineUnit;units:PipelineUnit[];actions:MappingActions}) {
  const base=useMemo(()=>orderedSources(state,sourceItems(state,units,unit)),[state.revision,unit.id,units]);
  const [order,setOrder]=useState(()=>base.map(item=>item.source.id));
  useEffect(()=>setOrder(base.map(item=>item.source.id)),[base.map(item=>item.source.id).join("|")]);
  const items=order.map(id=>base.find(item=>item.source.id===id)).filter((item):item is PipelineSourceView=>!!item);
  const sensors=useSensors(
    useSensor(MouseSensor,{activationConstraint:{distance:6}}),
    useSensor(TouchSensor,{activationConstraint:{delay:180,tolerance:6}}),
  );
  const proposals=items.map((item,index)=>batchProposalFor(state,item,unit.id,index)).filter((item):item is NonNullable<typeof item>=>!!item);

  async function map(item:MappingItem){ if(await actions.before()) actions.enqueue([item]); }
  async function exclude(item:PipelineSourceView){
    if(!await actions.before()) return;
    const display=displayMapping(state,item,unit.id,items.indexOf(item));
    if(display.kind==="excluded") actions.enqueue([{sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:"clear",uses:[]}]);
    else actions.enqueue([{sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:"exclude",uses:[]}]);
  }
  async function acceptProposals(){
    if(!proposals.length || !await actions.before()) return;
    actions.enqueue(proposals.map(({sourceId,sourceVersion,disposition,uses})=>({sourceId,sourceVersion,disposition,uses})));
  }
  async function dragEnd(event:DragEndEvent){
    if(!event.over || event.active.id===event.over.id || !await actions.before()) return;
    const active=items.find(item=>item.source.id===event.active.id), over=items.find(item=>item.source.id===event.over!.id);
    const au=active&&primaryUse(active), ou=over&&primaryUse(over);
    if(!active||!over||!au?.unitId||au.unitId!==ou?.unitId) return;
    const next=[...order],from=next.indexOf(active.source.id),to=next.indexOf(over.source.id);
    next.splice(to,0,next.splice(from,1)[0]);setOrder(next);
    const same=next.map(id=>base.find(item=>item.source.id===id)).filter((item):item is PipelineSourceView=>!!item&&primaryUse(item)?.unitId===au.unitId&&!!item.decision);
    actions.enqueue(same.map((item,index)=>({sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:item.decision!.disposition,uses:item.decision!.uses.map(use=>use.unitId===au.unitId?{...use,order:index}:use)})));
  }

  if(!items.length) return null;
  const open=items.filter(item=>["pending","stale","partial","not-returned"].includes(item.status)).length;
  return <div className="structure-source-block">
    <div className="structure-source-head"><span>{items.length} Quellen{open?` · ${open} offen`:""}</span>{proposals.length>0&&<Button size="sm" variant="ghost" icon="sparkles" label={`Vorschläge ${proposals.length}`} disabled={actions.disabled} onPress={()=>void acceptProposals()}/>}</div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event=>void dragEnd(event)}>
      <SortableContext items={items.map(item=>item.source.id)} strategy={verticalListSortingStrategy}>
        <ul className="mapping-rows structure-mapping-rows">{items.map((item,index)=><MappingRow key={item.source.id} item={item} state={state} rootId={unit.id} index={index} disabled={actions.disabled} compact
          onMap={value=>void map(value)} onExclude={value=>void exclude(value)} onOpen={value=>actions.onOpen(value,unit.id)}/>)}</ul>
      </SortableContext>
    </DndContext>
  </div>;
}

function linkedTaskOwner(units:PipelineUnit[],task:PipelineUnit){
  const scripts=units.filter(unit=>unitKind(unit)==="script"&&!unitHidden(unit,units)).sort((a,b)=>a.order-b.order);
  return scripts.find(script=>(task.scriptUnitIds??[]).includes(script.id))?.id;
}

export function PipelineStructure({ state, busy, onSave, onState, onOpenSource, onFocus, onContent, onGuard }: {
  state: PipelineState; busy: boolean; onSave: StructureSave; onState:(state:PipelineState)=>void;
  onOpenSource:(item:PipelineSourceView,unitId:string)=>void; onFocus:()=>void; onContent:()=>void;
  onGuard?: (guard: (() => Promise<boolean>) | null) => void;
}) {
  const { units, status, error: saveError, queue, retry } = useStructureAutosave(state, onSave);
  const mappings=useMappingAutosave(state.courseId,state,onState);
  const setUnits=queue.update;
  const [conflict,setConflict]=useState<PipelineState>();
  const [conflictError,setConflictError]=useState("");
  const [showHidden,setShowHidden]=useState(false);
  const [expanded,setExpanded]=useState<string>();
  const [openUnits,setOpenUnits]=useState<Set<string>>(()=>{const initial=state.units.length?state.units:state.suggestedUnits;return new Set(initial.filter(unit=>unitKind(unit)==="script"&&!unitHidden(unit,initial)).slice(0,1).map(unit=>unit.id));});
  const [focusId,setFocusId]=useState<string>();
  const listRef=useRef<HTMLDivElement>(null);
  const structureSensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const mappingBusy=["pending","saving"].includes(mappings.snapshot.status);
  const structureBusy=["pending","saving"].includes(status);
  const mappingBlocked=mappings.snapshot.status==="conflict"||mappings.snapshot.status==="error"||status==="conflict"||status==="error"||status==="invalid";

  useEffect(()=>{if(!focusId)return;const input=listRef.current?.querySelector<HTMLInputElement>(`[data-unit-id="${focusId}"] input`);input?.focus();input?.select();},[focusId]);
  async function syncStructure(){
    if(mappingBlocked)return false;
    if(!await queue.flush(true))return false;
    const remote=await readPipeline(state.courseId);mappings.accept(remote);onState(remote);return true;
  }
  async function flushAll(){if(!await syncStructure())return false;return mappings.flush();}
  useEffect(()=>{onGuard?.(flushAll);return()=>onGuard?.(null);},[onGuard,queue,mappings]);
  async function compare(){try{const remote=await readPipeline(state.courseId);queue.accept(remote);mappings.accept(remote);if(queue.getSnapshot().status==="conflict")setConflict(remote);setConflictError("");}catch{setConflictError("Server nicht erreichbar. Dein Entwurf bleibt erhalten.");}}
  async function beforeMapping(){return syncStructure();}
  async function openContent(){if(await flushAll())onContent();}
  function change(id:string,patch:Partial<PipelineUnit>){setUnits(current=>current.map(unit=>unit.id===id?{...unit,...patch}:unit));}
  function add(kind:"script"|"tasks"){
    const siblings=units.filter(unit=>unitKind(unit)===kind&&unit.parentId===null);
    const id=crypto.randomUUID().replaceAll("-","");
    setUnits(current=>[...current,{id,title:kind==="script"?"Neue Lerneinheit":"Neue Aufgabengruppe",parentId:null,order:Math.max(-1,...siblings.map(unit=>unit.order))+1,kind,hidden:false,customTitle:null,sourceGroupId:null,scriptUnitIds:[]}]);
    setFocusId(id);
  }
  function toggleOpen(id:string){setOpenUnits(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function reorder(event:DragEndEvent){if(event.over)setUnits(current=>reorderUnits(current,String(event.active.id),String(event.over!.id)));}

  const roots=units.filter(unit=>unit.parentId===null&&unitKind(unit)==="script"&&(showHidden||!unitHidden(unit,units))).sort((a,b)=>a.order-b.order);
  const standaloneTasks=units.filter(unit=>unit.parentId===null&&unitKind(unit)==="tasks"&&!linkedTaskOwner(units,unit)&&(showHidden||!unitHidden(unit,units))).sort((a,b)=>a.order-b.order);
  const hiddenCount=units.filter(unit=>unitHidden(unit,units)).length;
  const disabled=busy||mappingBusy;
  const actions:MappingActions={disabled:busy||structureBusy||mappingBlocked,enqueue:mappings.enqueue,before:beforeMapping,onOpen:onOpenSource};

  function row(unit:PipelineUnit,children?:ReactNode){
    const sources=sourceItems(state,units,unit);const childUnits=units.filter(item=>item.parentId===unit.id&&(showHidden||!unitHidden(item,units)));
    const taskChildren=unitKind(unit)==="script"?units.filter(item=>unitKind(item)==="tasks"&&linkedTaskOwner(units,item)===unit.id&&(showHidden||!unitHidden(item,units))):[];
    const nestedCount=sources.length+childUnits.length+taskChildren.length;
    return <StructureRow key={unit.id} unit={unit} units={units} disabled={disabled} expanded={expanded===unit.id} onToggle={()=>setExpanded(expanded===unit.id?undefined:unit.id)}
      onChange={patch=>change(unit.id,patch)} onHide={hidden=>change(unit.id,{hidden})} onOpen={()=>{}} onParent={parent=>setUnits(current=>moveParent(current,unit.id,parent))}
      onKind={()=>setUnits(current=>moveKind(current,unit.id,unitKind(unit)==="script"?"tasks":"script"))} inlineChildren nestedOpen={openUnits.has(unit.id)} nestedCount={nestedCount} onToggleNested={()=>toggleOpen(unit.id)}>
      {children}
    </StructureRow>;
  }
  function level(items:PipelineUnit[],key:string){
    if(!items.length)return null;
    return <DndContext key={key} sensors={structureSensors} collisionDetection={closestCenter} onDragEnd={reorder}><SortableContext items={items.map(unit=>unit.id)} strategy={verticalListSortingStrategy}><ul className="structure-list structure-tree-level">{items.map(unit=>{
      const sources=<NestedSources state={state} unit={unit} units={units} actions={actions}/>;
      const childScripts=units.filter(item=>item.parentId===unit.id&&unitKind(item)===unitKind(unit)&&(showHidden||!unitHidden(item,units))).sort((a,b)=>a.order-b.order);
      const tasks=unitKind(unit)==="script"?units.filter(item=>unitKind(item)==="tasks"&&linkedTaskOwner(units,item)===unit.id&&(showHidden||!unitHidden(item,units))).sort((a,b)=>a.order-b.order):[];
      const nested=<>{sources}{childScripts.length?level(childScripts,`${unit.id}-children`):null}{tasks.length?<div className="structure-task-branch"><div className="structure-branch-label">Aufgaben</div>{level(tasks,`${unit.id}-tasks`)}</div>:null}</>;
      return row(unit,nested);
    })}</ul></SortableContext></DndContext>;
  }

  return <div className="pipeline-structure pipeline-structure-nested">
    <div className="prepare-section-heading"><h2>Struktur</h2><div className="structure-heading-actions"><StructureSaveStatus status={mappingBusy?"saving":mappings.snapshot.status==="saved"?status:mappings.snapshot.status} onRetry={()=>{void retry();mappings.retry();}} onConflict={()=>void compare()}/></div></div>
    <div className="structure-toolbar"><div className="structure-view-tabs" role="group" aria-label="Strukturansicht"><button type="button" data-active><ListTree size={16}/><span>Verschachtelt</span></button><button type="button" onClick={onFocus}><Focus size={16}/><span>Fokus</span></button></div>{hiddenCount>0&&<Button size="sm" variant="ghost" label={`Ausgeblendete (${hiddenCount})`} pressed={showHidden} onPress={()=>setShowHidden(!showHidden)}/>}</div>
    <div ref={listRef}>{level(roots,"script-roots")}{standaloneTasks.length?<div className="structure-standalone-tasks"><div className="structure-branch-label">Aufgaben</div>{level(standaloneTasks,"standalone-tasks")}</div>:null}</div>
    {!roots.length&&!standaloneTasks.length&&<p className="pipeline-muted">Noch keine sichtbare Struktur.</p>}
    <div className="structure-add-actions"><Button size="sm" variant="ghost" icon="plus" label="Lerneinheit" disabled={disabled} onPress={()=>add("script")}/><Button size="sm" variant="ghost" icon="plus" label="Aufgabe" disabled={disabled} onPress={()=>add("tasks")}/></div>
    {(saveError||conflictError||mappings.snapshot.error)&&<p className="prepare-error" role="alert">{conflictError||saveError||mappings.snapshot.error}</p>}
    <footer className="structure-footer prepare-next"><span className="prepare-next-count">{state.pending?`${state.pending} Quellen offen`:"Struktur vollständig"}</span><Button label="Inhalt" iconAfter="arrow-right" disabled={busy||mappingBlocked||!units.some(unit=>!unitHidden(unit,units))} onPress={()=>void openContent()}/></footer>
    {conflict&&<DialogShell title="Struktur vergleichen" onClose={()=>setConflict(undefined)}><div className="structure-options"><div className="prepare-conflict-columns"><div><h3>Dein Entwurf</h3><ul>{units.map(unit=><li key={unit.id}>{unitLabel(unit)}{unit.hidden?" · ausgeblendet":""}</li>)}</ul></div><div><h3>Gespeicherter Stand</h3><ul>{conflict.units.map(unit=><li key={unit.id}>{unitLabel(unit)}{unit.hidden?" · ausgeblendet":""}</li>)}</ul></div></div><Button variant="secondary" label="Gespeicherten Stand verwenden" onPress={()=>{queue.resolve(conflict,false);mappings.resolve(conflict,false);setConflict(undefined);}}/><Button label="Meinen Entwurf übernehmen" onPress={()=>{queue.resolve(conflict,true);mappings.resolve(conflict,true);setConflict(undefined);}}/></div></DialogShell>}
  </div>;
}
