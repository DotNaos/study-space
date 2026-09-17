import "./structure-editor.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Icon } from "@dotnaos/ui-base";
import { closestCenter, DndContext, KeyboardSensor, MouseSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { BookOpen, Focus, ListTree } from "lucide-react";
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
  if (item.currentPlacementId && units.some(unit => unit.id === item.currentPlacementId)) return item.currentPlacementId;
  const target = primaryUse(item)?.unitId;
  if (target && units.some(unit => unit.id === target)) return target;
  if (item.defaultPlacementId && units.some(unit => unit.id === item.defaultPlacementId)) return item.defaultPlacementId;
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


function EmbeddedSources({state,unit,units,selectedSourceId,onOpen}:{state:PipelineState;unit:PipelineUnit;units:PipelineUnit[];selectedSourceId?:string;onOpen:(item:PipelineSourceView,unitId:string)=>void}) {
  const items=orderedSources(state,sourceItems(state,units,unit)).filter(item=>item.source.present&&!item.hidden&&item.decision?.disposition!=="exclude");
  if(!items.length)return null;
  return <ul className="structure-source-links" aria-label={`Quellen in ${unitLabel(unit)}`}>{items.map(item=>
    <li key={item.source.id} data-selected={item.source.id===selectedSourceId||undefined}>
      <button type="button" onClick={()=>onOpen(item,unit.id)} title={item.source.name}>
        <Icon.File filename={item.source.name} size={14}/><span>{item.source.name}</span>
        {["stale","partial","not-returned"].includes(item.status)&&<small>{item.status==="stale"?"prüfen":item.status==="partial"?"teilweise":"fehlt"}</small>}
      </button>
    </li>)}
  </ul>;
}

export function EmbeddedSourceVisibility({state,unit,units,draft,disabled,onToggle}:{state:PipelineState;unit:PipelineUnit;units:PipelineUnit[];draft:Record<string,boolean>;disabled:boolean;onToggle:(id:string)=>void}) {
  const items=orderedSources(state,sourceItems(state,units,unit)).filter(item=>item.source.present);
  if(!items.length)return null;
  const inheritedHidden=unitHidden(unit,units);
  return <ul className="structure-source-visibility-list" aria-label={`Quellen-Sichtbarkeit in ${unitLabel(unit)}`}>{items.map(item=>{
    const hidden=draft[item.source.id]??(!!item.hidden||item.decision?.disposition==="exclude");
    const title=inheritedHidden?"Zuerst den übergeordneten Struktur-Eintrag einblenden":hidden?"Einblenden":"Ausblenden";
    return <li key={item.source.id} data-hidden={hidden||undefined}>
      <button type="button" className="structure-source-visibility-row" disabled={disabled||inheritedHidden} onClick={()=>onToggle(item.source.id)} title={title}>
        <Icon.File filename={item.source.name} size={14}/><span>{item.source.name}</span>
      </button>
      <span className="structure-source-visibility-checkbox" title={title}>
        <Checkbox label={`Quelle verwenden: ${item.source.name}`} checked={!hidden} disabled={disabled||inheritedHidden} onCheckedChange={()=>onToggle(item.source.id)}/>
      </span>
    </li>;
  })}</ul>;
}

type MappingActions = {
  disabled: boolean;
  enqueue: (items: MappingItem[]) => void;
  before: () => Promise<boolean>;
  onOpen: (item: PipelineSourceView, unitId: string) => void;
};

function NestedSources({state,unit,units,actions,showHidden,selectedSourceId}:{state:PipelineState;unit:PipelineUnit;units:PipelineUnit[];actions:MappingActions;showHidden:boolean;selectedSourceId?:string}) {
  const all=useMemo(()=>orderedSources(state,sourceItems(state,units,unit)),[state.revision,unit.id,units]);
  const base=useMemo(()=>showHidden?all:all.filter(item=>item.decision?.disposition!=="exclude"),[all,showHidden]);
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
    <div className="structure-source-head"><span>{all.length} Quellen{open?` · ${open} offen`:""}</span>{proposals.length>0&&<Button size="sm" variant="ghost" icon="sparkles" label={`Vorschläge ${proposals.length}`} disabled={actions.disabled} onPress={()=>void acceptProposals()}/>}</div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={event=>void dragEnd(event)}>
      <SortableContext items={items.map(item=>item.source.id)} strategy={verticalListSortingStrategy}>
        <ul className="mapping-rows structure-mapping-rows">{items.map((item,index)=><MappingRow key={item.source.id} item={item} state={state} rootId={unit.id} index={index} disabled={actions.disabled} compact selected={item.source.id===selectedSourceId}
          onMap={value=>void map(value)} onExclude={value=>void exclude(value)} onOpen={value=>actions.onOpen(value,unit.id)}/>)}</ul>
      </SortableContext>
    </DndContext>
  </div>;
}

function linkedTaskOwner(units:PipelineUnit[],task:PipelineUnit,includeHidden=false){
  const scripts=units.filter(unit=>unitKind(unit)==="script"&&(includeHidden||!unitHidden(unit,units))).sort((a,b)=>a.order-b.order);
  return scripts.find(script=>(task.scriptUnitIds??[]).includes(script.id))?.id;
}

export function PipelineStructure({ state, busy, onSave, onState, onOpenSource, onFocus, onContent, onGuard, embedded=false, editing=true, allSelected=false, selectedUnitId, selectedSourceId, onSelectAll, onSelectUnit }: {
  state: PipelineState; busy: boolean; onSave: StructureSave; onState:(state:PipelineState)=>void;
  onOpenSource:(item:PipelineSourceView,unitId:string)=>void; onFocus:()=>void; onContent?:()=>void;
  onGuard?: (guard: (() => Promise<boolean>) | null) => void;
  embedded?:boolean;editing?:boolean;allSelected?:boolean;selectedUnitId?:string;selectedSourceId?:string;
  onSelectAll?:()=>void;onSelectUnit?:(unit:PipelineUnit)=>void;
}) {
  const { units, status, error: saveError, queue, retry } = useStructureAutosave(state, onSave);
  const mappings=useMappingAutosave(state.courseId,state,onState);
  const setUnits=queue.update;
  const [conflict,setConflict]=useState<PipelineState>();
  const [conflictError,setConflictError]=useState("");
  const [showHidden,setShowHidden]=useState(false);
  const [visibilityMode,setVisibilityMode]=useState(false);
  const [visibilityDraft,setVisibilityDraft]=useState<Record<string,boolean>>({});
  const [sourceVisibilityDraft,setSourceVisibilityDraft]=useState<Record<string,boolean>>({});
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
    if(mappingBlocked)return null;
    if(!await queue.flush(true))return null;
    const remote=await readPipeline(state.courseId);mappings.accept(remote);onState(remote);return remote;
  }
  async function flushAll(){if(!await syncStructure())return false;return mappings.flush();}
  useEffect(()=>{onGuard?.(flushAll);return()=>onGuard?.(null);},[onGuard,queue,mappings]);
  async function compare(){try{const remote=await readPipeline(state.courseId);queue.accept(remote);mappings.accept(remote);if(queue.getSnapshot().status==="conflict")setConflict(remote);setConflictError("");}catch{setConflictError("Server nicht erreichbar. Dein Entwurf bleibt erhalten.");}}
  async function beforeMapping(){return !!await syncStructure();}
  async function setAllIncluded(included:boolean){
    if(disabled||mappingBlocked)return;
    setUnits(current=>current.map(unit=>({...unit,hidden:!included})));
    const remote=await syncStructure();
    if(!remote)return;
    const changes:MappingItem[]=[];
    for(const item of remote.sources.filter(item=>item.source.present&&!!sourceOwner(remote.units,item))){
      const excluded=item.decision?.disposition==="exclude";
      if(included&&excluded)changes.push({sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:"clear",uses:[]});
      else if(!included&&!excluded)changes.push({sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:"exclude",uses:[]});
    }
    if(changes.length){mappings.enqueue(changes);await mappings.flush();}
  }
  async function openContent(){if(await flushAll())onContent?.();}
  function change(id:string,patch:Partial<PipelineUnit>){setUnits(current=>current.map(unit=>unit.id===id?{...unit,...patch}:unit));}
  function removeUnit(id:string){
    setUnits(current=>current.filter(unit=>unit.id!==id).map(unit=>({...unit,scriptUnitIds:(unit.scriptUnitIds??[]).filter(link=>link!==id)})));
    if(selectedUnitId===id) onSelectAll?.();
    setExpanded(current=>current===id?undefined:current);
  }
  function startVisibility(){
    setVisibilityDraft(Object.fromEntries(units.map(unit=>[unit.id,!!unit.hidden])));
    setSourceVisibilityDraft(Object.fromEntries(state.sources.filter(item=>item.source.present).map(item=>[item.source.id,!!item.hidden||item.decision?.disposition==="exclude"])));
    setVisibilityMode(true);
  }
  function cancelVisibility(){setVisibilityDraft({});setSourceVisibilityDraft({});setVisibilityMode(false);}
  function toggleVisibility(id:string){setVisibilityDraft(current=>({...current,[id]:!(current[id]??false)}));}
  function toggleSourceVisibility(id:string){setSourceVisibilityDraft(current=>({...current,[id]:!(current[id]??false)}));}
  async function applyVisibility(){
    const next=visibilityDraft;
    const sourceNext=sourceVisibilityDraft;
    setUnits(current=>current.map(unit=>({...unit,hidden:next[unit.id]??!!unit.hidden})));
    const remote=await syncStructure();
    if(!remote)return;
    const changes=remote.sources.filter(item=>item.source.present).flatMap(item=>{
      const currentHidden=!!item.hidden||item.decision?.disposition==="exclude";
      const desiredHidden=sourceNext[item.source.id]??currentHidden;
      if(desiredHidden===currentHidden)return [];
      return [{sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:desiredHidden?"exclude":"clear",uses:[]} as MappingItem];
    });
    if(changes.length){mappings.enqueue(changes);if(!await mappings.flush())return;}
    setVisibilityMode(false);setVisibilityDraft({});setSourceVisibilityDraft({});
  }
  function add(kind:"script"|"tasks"){
    const siblings=units.filter(unit=>unitKind(unit)===kind&&unit.parentId===null);
    const id=crypto.randomUUID().replaceAll("-","");
    setUnits(current=>[...current,{id,title:kind==="script"?"Neue Lerneinheit":"Neue Aufgabengruppe",parentId:null,order:Math.max(-1,...siblings.map(unit=>unit.order))+1,kind,hidden:false,customTitle:null,sourceGroupId:null,scriptUnitIds:[]}]);
    setFocusId(id);
  }
  function toggleOpen(id:string){setOpenUnits(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  function reorder(event:DragEndEvent){if(event.over)setUnits(current=>reorderUnits(current,String(event.active.id),String(event.over!.id)));}

  const displayUnits=visibilityMode?units.map(unit=>({...unit,hidden:visibilityDraft[unit.id]??!!unit.hidden})):units;
  const roots=displayUnits.filter(unit=>unit.parentId===null&&unitKind(unit)==="script"&&(visibilityMode||showHidden||!unitHidden(unit,displayUnits))).sort((a,b)=>a.order-b.order);
  const standaloneTasks=displayUnits.filter(unit=>unit.parentId===null&&unitKind(unit)==="tasks"&&!linkedTaskOwner(displayUnits,unit,visibilityMode)&&(visibilityMode||showHidden||!unitHidden(unit,displayUnits))).sort((a,b)=>a.order-b.order);
  const hiddenUnitCount=displayUnits.filter(unit=>unitHidden(unit,displayUnits)).length;
  const ownedSources=state.sources.filter(item=>!!sourceOwner(units,item));
  const excludedSourceCount=ownedSources.filter(item=>item.decision?.disposition==="exclude").length;
  const hiddenCount=hiddenUnitCount+excludedSourceCount;
  const canCheckAll=hiddenCount>0;
  const canUncheckAll=units.some(unit=>!unitHidden(unit,units))||ownedSources.some(item=>item.decision?.disposition!=="exclude");
  const disabled=busy||mappingBusy||!editing;
  const visibilityChanges=visibilityMode
    ? units.filter(unit=>(visibilityDraft[unit.id]??!!unit.hidden)!==!!unit.hidden).length
      + state.sources.filter(item=>item.source.present&&!!sourceOwner(displayUnits,item)).filter(item=>{
        const hidden=!!item.hidden||item.decision?.disposition==="exclude";
        return (sourceVisibilityDraft[item.source.id]??hidden)!==hidden;
      }).length
    : 0;
  const actions:MappingActions={disabled:busy||structureBusy||mappingBlocked||!editing,enqueue:mappings.enqueue,before:beforeMapping,onOpen:onOpenSource};

  function row(unit:PipelineUnit,children?:ReactNode){
    const visibilitySources=sourceItems(state,displayUnits,unit).filter(item=>item.source.present);
    const sourceCount=visibilitySources.filter(item=>!item.hidden&&item.decision?.disposition!=="exclude").length;
    const sources=embedded?[]:sourceItems(state,displayUnits,unit).filter(item=>showHidden||item.decision?.disposition!=="exclude");
    const childUnits=displayUnits.filter(item=>item.parentId===unit.id&&(visibilityMode||showHidden||!unitHidden(item,displayUnits)));
    const directChildren=units.filter(item=>item.parentId===unit.id);
    const assignedSources=state.sources.filter(item=>item.currentPlacementId===unit.id||item.defaultPlacementId===unit.id||primaryUse(item)?.unitId===unit.id);
    const taskChildren=unitKind(unit)==="script"?displayUnits.filter(item=>unitKind(item)==="tasks"&&linkedTaskOwner(displayUnits,item,visibilityMode)===unit.id&&(visibilityMode||showHidden||!unitHidden(item,displayUnits))):[];
    const nestedCount=(embedded?(visibilityMode?visibilitySources.length:sourceCount):sources.length)+childUnits.length+taskChildren.length;
    const deletable=unit.sourceGroupId==null;
    const deleteDisabledReason=!deletable?undefined:directChildren.length?"Verschiebe oder lösche zuerst die untergeordneten Einträge.":assignedSources.length?"Verschiebe oder blende zuerst die zugeordneten Quellen aus.":undefined;
    return <StructureRow key={unit.id} unit={unit} units={displayUnits} disabled={disabled} expanded={expanded===unit.id} onToggle={()=>setExpanded(expanded===unit.id?undefined:unit.id)}
      onChange={patch=>change(unit.id,patch)} onHide={hidden=>change(unit.id,{hidden})} onOpen={()=>{}} onParent={parent=>setUnits(current=>moveParent(current,unit.id,parent))}
      onKind={()=>setUnits(current=>moveKind(current,unit.id,unitKind(unit)==="script"?"tasks":"script"))} inlineChildren nestedOpen={openUnits.has(unit.id)} nestedCount={nestedCount} onToggleNested={()=>toggleOpen(unit.id)}
      editing={editing} selected={selectedUnitId===unit.id} onSelect={()=>onSelectUnit?.(unit)} visibilityMode={visibilityMode} onVisibilityToggle={()=>toggleVisibility(unit.id)} inlineVisibility={!embedded} sourceCount={sourceCount}
      onDelete={deletable?()=>removeUnit(unit.id):undefined} deleteDisabledReason={deleteDisabledReason}>
      {children}
    </StructureRow>;
  }
  function level(items:PipelineUnit[],key:string){
    if(!items.length)return null;
    return <DndContext key={key} sensors={structureSensors} collisionDetection={closestCenter} onDragEnd={reorder}><SortableContext items={items.map(unit=>unit.id)} strategy={verticalListSortingStrategy}><ul className="structure-list structure-tree-level">{items.map(unit=>{
      const sources=embedded ? visibilityMode
        ? <EmbeddedSourceVisibility state={state} unit={unit} units={displayUnits} draft={sourceVisibilityDraft} disabled={disabled} onToggle={toggleSourceVisibility}/>
        : <EmbeddedSources state={state} unit={unit} units={displayUnits} selectedSourceId={selectedSourceId} onOpen={onOpenSource}/>
        : <NestedSources state={state} unit={unit} units={displayUnits} actions={actions} showHidden={showHidden} selectedSourceId={selectedSourceId}/>;
      const childScripts=displayUnits.filter(item=>item.parentId===unit.id&&unitKind(item)===unitKind(unit)&&(visibilityMode||showHidden||!unitHidden(item,displayUnits))).sort((a,b)=>a.order-b.order);
      const tasks=unitKind(unit)==="script"?displayUnits.filter(item=>unitKind(item)==="tasks"&&linkedTaskOwner(displayUnits,item,visibilityMode)===unit.id&&(visibilityMode||showHidden||!unitHidden(item,displayUnits))).sort((a,b)=>a.order-b.order):[];
      const taskBranch = tasks.length ? embedded ? level(tasks,`${unit.id}-tasks`) : <div className="structure-task-branch"><div className="structure-branch-label">Aufgaben</div>{level(tasks,`${unit.id}-tasks`)}</div> : null;
      const nested=<>{sources}{childScripts.length?level(childScripts,`${unit.id}-children`):null}{taskBranch}</>;
      return row(unit,nested);
    })}</ul></SortableContext></DndContext>;
  }

  return <div className="pipeline-structure pipeline-structure-nested" data-embedded={embedded||undefined} data-editing={editing||undefined}>
    <div className="prepare-section-heading"><h2>Struktur</h2><div className="structure-heading-actions"><StructureSaveStatus status={mappingBusy?"saving":mappings.snapshot.status==="saved"?status:mappings.snapshot.status} onRetry={()=>{void retry();mappings.retry();}} onConflict={()=>void compare()}/></div></div>
    {embedded && <button type="button" className="structure-all-button" data-selected={allSelected||undefined} onClick={onSelectAll}><BookOpen size={15}/><span>Gesamtes Skript</span></button>}
    {editing && embedded ? <div className="structure-embedded-toolbar"><button type="button" className="structure-visibility-mode" aria-pressed={visibilityMode} onClick={()=>visibilityMode?cancelVisibility():startVisibility()}>Sichtbarkeit</button></div> : editing && <div className="structure-toolbar"><div className="structure-view-tabs" role="group" aria-label="Strukturansicht"><button type="button" data-active><ListTree size={16}/><span>Verschachtelt</span></button><button type="button" onClick={onFocus}><Focus size={16}/><span>Fokus</span></button></div><div className="structure-toolbar-actions"><Button size="sm" variant="ghost" label="Alle auswählen" disabled={disabled||!canCheckAll} onPress={()=>void setAllIncluded(true)}/><Button size="sm" variant="ghost" label="Alle abwählen" disabled={disabled||!canUncheckAll} onPress={()=>void setAllIncluded(false)}/><button type="button" className="structure-hidden-toggle" role="switch" aria-checked={showHidden} onClick={()=>setShowHidden(value=>!value)}><span className="structure-hidden-switch" aria-hidden="true"><span/></span><span>Ausgeblendete anzeigen{hiddenCount?` (${hiddenCount})`:""}</span></button></div></div>}
    <div ref={listRef}>{level(roots,"script-roots")}{standaloneTasks.length ? embedded ? level(standaloneTasks,"standalone-tasks") : <div className="structure-standalone-tasks"><div className="structure-branch-label">Aufgaben</div>{level(standaloneTasks,"standalone-tasks")}</div> : null}</div>
    {!roots.length&&!standaloneTasks.length&&<p className="pipeline-muted">Noch keine sichtbare Struktur.</p>}
    {editing && !visibilityMode && <div className="structure-add-actions"><Button size="sm" variant="ghost" icon="plus" label="Lerneinheit" disabled={disabled} onPress={()=>add("script")}/><Button size="sm" variant="ghost" icon="plus" label="Aufgabe" disabled={disabled} onPress={()=>add("tasks")}/></div>}
    {embedded && visibilityMode && <div className="structure-visibility-footer"><Button size="sm" variant="ghost" label="Abbrechen" onPress={cancelVisibility}/><Button size="sm" label={visibilityChanges===1?"1 Änderung übernehmen":`${visibilityChanges} Änderungen übernehmen`} disabled={visibilityChanges===0||disabled} onPress={()=>void applyVisibility()}/></div>}
    {(saveError||conflictError||mappings.snapshot.error)&&<p className="prepare-error" role="alert">{conflictError||saveError||mappings.snapshot.error}</p>}
    {!embedded && <footer className="structure-footer prepare-next"><span className="prepare-next-count">{state.pending?`${state.pending} Quellen offen`:"Struktur vollständig"}</span><Button label="Inhalt" iconAfter="arrow-right" disabled={busy||mappingBlocked||!units.some(unit=>!unitHidden(unit,units))} onPress={()=>void openContent()}/></footer>}
    {conflict&&<DialogShell title="Struktur vergleichen" onClose={()=>setConflict(undefined)}><div className="structure-options"><div className="prepare-conflict-columns"><div><h3>Dein Entwurf</h3><ul>{units.map(unit=><li key={unit.id}>{unitLabel(unit)}{unit.hidden?" · ausgeblendet":""}</li>)}</ul></div><div><h3>Gespeicherter Stand</h3><ul>{conflict.units.map(unit=><li key={unit.id}>{unitLabel(unit)}{unit.hidden?" · ausgeblendet":""}</li>)}</ul></div></div><Button variant="secondary" label="Gespeicherten Stand verwenden" onPress={()=>{queue.resolve(conflict,false);mappings.resolve(conflict,false);setConflict(undefined);}}/><Button label="Meinen Entwurf übernehmen" onPress={()=>{queue.resolve(conflict,true);mappings.resolve(conflict,true);setConflict(undefined);}}/></div></DialogShell>}
  </div>;
}
