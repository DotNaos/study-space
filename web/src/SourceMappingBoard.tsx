import "./source-mapping.css";
import { useEffect, useMemo, useState } from "react";
import { Button, Icon } from "@dotnaos/ui-base";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BookOpen, Check, CheckCheck, ChevronRight, CircleAlert, Eye, EyeOff, FileText, GripVertical, Link2, MoreHorizontal, Paperclip, PencilLine, RotateCcw } from "lucide-react";
import type { MappingItem, PipelineSourceView, PipelineState, SourceUse } from "./pipeline-api";
import { unitHidden, unitKind, unitLabel } from "./learning-structure";
import { actionable, batchProposalFor, displayMapping, mappingItem, mappingProgress, mappingRoots, mappingSources, mappingTargets, primaryUse, proposalFor } from "./source-mapping";
import { useMappingAutosave } from "./useMappingAutosave";
import { DialogShell } from "./DialogShell";
import { StructurePicker } from "./StructurePicker";

const roleIcon = (role?: string) => role === "task" ? PencilLine : role === "solution" ? CheckCheck : role === "support" ? Paperclip : role === "reference" ? Link2 : FileText;
const roleOptions = [
  {id:"teaching",label:"Skript",Icon:FileText},
  {id:"task",label:"Aufgaben",Icon:PencilLine},
  {id:"solution",label:"Lösung",Icon:CheckCheck},
  {id:"support",label:"Material",Icon:Paperclip},
  {id:"reference",label:"Referenz",Icon:Link2},
] as const;

type Role = typeof roleOptions[number]["id"];

function MappingEditor({item,state,rootId,index,disabled,onMap,onAdvanced,onClose}:{
  item:PipelineSourceView;state:PipelineState;rootId:string;index:number;disabled:boolean;
  onMap:(item:MappingItem)=>void;onAdvanced:()=>void;onClose:()=>void;
}) {
  const existing=primaryUse(item);const proposal=proposalFor(state,item,rootId,index);const proposed=proposal?.uses[0];
  const initialRole=(existing?.role??proposed?.role??(item.source.suggestedRole==="unresolved"?"teaching":item.source.suggestedRole)) as Role;
  const [role,setRole]=useState<Role>(roleOptions.some(option=>option.id===initialRole)?initialRole:"teaching");
  const available=state.units.filter(unit=>!unitHidden(unit,state.units));
  const forRole=(value:Role)=>available.filter(unit=>value==="teaching"?unitKind(unit)==="script":value==="task"||value==="solution"?unitKind(unit)==="tasks":true);
  const targets=forRole(role);
  const fallback=targets.find(unit=>unit.id===rootId)??targets[0];
  const [target,setTarget]=useState(existing?.unitId||proposed?.unitId||fallback?.id||"");
  function changeRole(next:Role){setRole(next);if(next==="reference")setTarget("");else {const valid=forRole(next);if(!valid.some(unit=>unit.id===target))setTarget((valid.find(unit=>unit.id===rootId)??valid[0])?.id??"");}}
  function save(){
    if(role==="solution"){onAdvanced();return;}
    if(role!=="reference"&&!target)return;
    const nextUse:SourceUse={unitId:role==="reference"?"":target,role,firstPage:existing?.firstPage??null,lastPage:existing?.lastPage??null,relatedSourceId:null,order:existing?.order??index};
    const uses=item.decision?.disposition==="use"&&item.decision.uses.length
      ? item.decision.uses.map(use=>use===existing?nextUse:use)
      : [nextUse];
    onMap({sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:"use",uses});onClose();
  }
  return <DialogShell title="Zuordnung" onClose={onClose}>
    <div className="mapping-editor">
      <div className="mapping-editor-source"><Icon.File filename={item.source.name} size={17}/><span>{item.source.name}</span></div>
      <div className="mapping-role-grid">{roleOptions.map(({id,label,Icon})=><button key={id} type="button" data-selected={role===id||undefined} onClick={()=>changeRole(id)} disabled={disabled}><Icon size={18}/><span>{label}</span></button>)}</div>
      {role!=="reference"&&<StructurePicker label="Ziel" units={targets} selected={target?[target]:[]} emptyLabel="Ziel wählen" disabled={disabled} onChange={ids=>setTarget(ids[0]??"")}/>} 
      <div className="mapping-editor-actions">
        <Button size="sm" variant="ghost" label="Details" onPress={onAdvanced}/>
        <Button size="sm" label={role==="solution"?"Relation wählen":"Übernehmen"} disabled={disabled||(role!=="reference"&&role!=="solution"&&!target)} onPress={save}/>
      </div>
    </div>
  </DialogShell>;
}

export function MappingRow({item,state,rootId,index,disabled,onMap,onExclude,onOpen,compact=false}:{item:PipelineSourceView;state:PipelineState;rootId:string;index:number;disabled:boolean;onMap:(item:MappingItem)=>void;onExclude:(item:PipelineSourceView)=>void;onOpen:(item:PipelineSourceView)=>void;compact?:boolean}){
  const [editing,setEditing]=useState(false);const current=mappingItem(item);const display=displayMapping(state,item,rootId,index);const use=primaryUse(item);const draggable=!!current&&current.disposition==="use"&&!!use?.unitId;
  const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging}=useSortable({id:item.source.id,disabled:disabled||!draggable});
  const MappingIcon=display.kind==="excluded"?EyeOff:display.kind==="open"?CircleAlert:roleIcon("role" in display?display.role:undefined);
  return <>
    <li ref={setNodeRef} data-source-id={item.source.id} data-status={item.status} data-mapping={display.kind} data-compact={compact||undefined} data-dragging={isDragging||undefined} style={{transform:CSS.Transform.toString(transform),transition}}>
      {!compact&&<button ref={setActivatorNodeRef} className="mapping-handle" type="button" disabled={!draggable||disabled} aria-label={`${item.source.name} sortieren`} {...attributes} {...listeners}><GripVertical size={15}/></button>}
      <button ref={compact?setActivatorNodeRef:undefined} className="mapping-source" type="button" onClick={()=>onOpen(item)} title={item.source.name} {...(compact?attributes:{})} {...(compact?listeners:{})}>
        <span className="mapping-source-icon"><Icon.File filename={item.source.name} size={16}/></span><span><strong>{item.source.name}</strong></span>
      </button>
      {!compact&&<><span className="mapping-arrow" aria-hidden="true">→</span>
        <button className="mapping-value" type="button" onClick={()=>setEditing(true)} disabled={disabled} data-role={("role" in display&&display.role)||undefined} title={display.label}>
          <span className="mapping-value-icon"><MappingIcon size={17}/></span><span><strong>{display.label}</strong>{display.kind==="proposal"&&<small>Vorschlag</small>}{item.status==="stale"&&<small>Erneut prüfen</small>}</span>
        </button></>}
      <button className="mapping-eye" type="button" disabled={disabled} onClick={()=>onExclude(item)} aria-label={display.kind==="excluded"?`${item.source.name} wieder zuordnen`:`${item.source.name} ausblenden`} title={display.kind==="excluded"?"Wieder zuordnen":"Ausblenden"}>{display.kind==="excluded"?<Eye size={17}/>:<EyeOff size={17}/>}</button>
      <button className="mapping-more" type="button" onClick={()=>onOpen(item)} aria-label={`${item.source.name} Details`} title="Details"><MoreHorizontal size={18}/></button>
    </li>
    {!compact&&editing&&<MappingEditor item={item} state={state} rootId={rootId} index={index} disabled={disabled} onMap={onMap} onAdvanced={()=>{setEditing(false);onOpen(item);}} onClose={()=>setEditing(false)}/>}
  </>;
}

function MappingOverview({state,onOpenRoot,onOpenSource,onCreate}:{state:PipelineState;onOpenRoot:(id:string)=>void;onOpenSource:(item:PipelineSourceView)=>void;onCreate:()=>void}){
  const roots=mappingRoots(state);const covered=new Set(roots.flatMap(root=>mappingSources(state,root.id).map(item=>item.source.id)));
  const uncovered=state.sources.filter(item=>actionable(item)&&item.status!=="structure-hidden"&&!covered.has(item.source.id));
  return <section className="mapping-board mapping-overview" aria-label="Quellenzuordnung">
    <header className="mapping-board-head"><div><Link2 size={18}/><strong>Quellen</strong></div><span>{state.pending} offen</span></header>
    <ul className="mapping-root-list">{roots.map(root=>{const progress=mappingProgress(state,root.id);const tasks=mappingTargets(state,root.id).filter(unit=>unit.kind==="tasks").length;return <li key={root.id}>
      <button type="button" onClick={()=>onOpenRoot(root.id)}><span className="mapping-root-icon"><BookOpen size={18}/></span><span className="mapping-root-main"><strong>{unitLabel(root)}</strong><span className="mapping-progress"><i style={{width:`${progress.total?Math.round(progress.done/progress.total*100):100}%`}}/></span></span>{tasks>0&&<small>{tasks} Aufgaben</small>}<span className={progress.open?"mapping-count open":"mapping-count"}>{progress.open||<Check size={15}/>}</span><ChevronRight size={17}/></button>
    </li>})}</ul>
    {uncovered.length>0&&<div className="mapping-uncovered"><CircleAlert size={16}/><button type="button" onClick={()=>onOpenSource(uncovered[0])}>{uncovered.length} ohne Bereich</button></div>}
    {state.pending===0&&<div className="mapping-next"><Button label="Erstellen" iconAfter="arrow-right" onPress={onCreate}/></div>}
  </section>;
}

function MappingDetail({courseId,state,rootId,onState,onOpenRoot,onOverview,onOpenSource,onCreate}:{courseId:number;state:PipelineState;rootId:string;onState:(state:PipelineState)=>void;onOpenRoot:(id:string)=>void;onOverview:()=>void;onOpenSource:(item:PipelineSourceView)=>void;onCreate:()=>void}){
  const autosave=useMappingAutosave(courseId,state,onState);const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}));
  const root=state.units.find(unit=>unit.id===rootId);const base=mappingSources(state,rootId).filter(item=>item.status!=="structure-hidden");
  const initial=useMemo(()=>[...base].sort((a,b)=>{const ao=primaryUse(a)?.order,bo=primaryUse(b)?.order;if(ao!=null||bo!=null)return(ao??1_000_000)-(bo??1_000_000);return state.sources.indexOf(a)-state.sources.indexOf(b);}).map(item=>item.source.id),[rootId,state.revision]);
  const [order,setOrder]=useState(initial);useEffect(()=>setOrder(initial),[initial.join("|")]);
  const items=order.map(id=>base.find(item=>item.source.id===id)).filter((item):item is PipelineSourceView=>!!item);
  const safeProposals=items.map((item,index)=>batchProposalFor(state,item,rootId,index)).filter((proposal):proposal is NonNullable<typeof proposal>=>!!proposal);
  function map(item:MappingItem){autosave.enqueue([item]);}
  function exclude(item:PipelineSourceView){const display=displayMapping(state,item,rootId,items.indexOf(item));if(display.kind==="excluded") map({sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:"clear",uses:[]});else map({sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:"exclude",uses:[]});}
  function dragEnd(event:DragEndEvent){if(!event.over||event.active.id===event.over.id)return;const active=items.find(item=>item.source.id===event.active.id),over=items.find(item=>item.source.id===event.over!.id);const au=active&&primaryUse(active),ou=over&&primaryUse(over);if(!active||!over||!au?.unitId||au.unitId!==ou?.unitId)return;const next=[...order],from=next.indexOf(active.source.id),to=next.indexOf(over.source.id);next.splice(to,0,next.splice(from,1)[0]);setOrder(next);const same=next.map(id=>base.find(item=>item.source.id===id)).filter((item):item is PipelineSourceView=>!!item&&primaryUse(item)?.unitId===au.unitId&&!!item.decision);autosave.enqueue(same.map((item,index)=>({sourceId:item.source.id,sourceVersion:item.source.sourceVersion,disposition:item.decision!.disposition,uses:item.decision!.uses.map(use=>use.unitId===au.unitId?{...use,order:index}:use)})));}
  const progress=mappingProgress(state,rootId);const nextRoot=mappingRoots(state).find(candidate=>candidate.id!==rootId&&mappingProgress(state,candidate.id).open>0);const finish=()=>nextRoot?onOpenRoot(nextRoot.id):state.pending===0?onCreate():onOverview();
  return <section className="mapping-board" aria-label={`Zuordnung ${root?unitLabel(root):""}`}>
    <header className="mapping-board-head"><div><Button variant="icon" size="sm" icon="arrow-left" accessibilityLabel="Zur Quellenübersicht" onPress={onOverview}/><BookOpen size={18}/><strong>{root?unitLabel(root):"Zuordnung"}</strong></div><div className="mapping-head-actions">
      <span className="mapping-save" data-status={autosave.snapshot.status}>{autosave.snapshot.status==="saving"?"◌":autosave.snapshot.status==="saved"?<Check size={15}/>:autosave.snapshot.status==="conflict"?"!":"•"}</span>
      {safeProposals.length>0&&<Button size="sm" variant="secondary" icon="sparkles" label={`Vorschläge ${safeProposals.length}`} disabled={autosave.snapshot.status==="conflict"} onPress={()=>autosave.enqueue(safeProposals.map(({sourceId,sourceVersion,disposition,uses})=>({sourceId,sourceVersion,disposition,uses})))}/>} 
    </div></header>
    <div className="mapping-board-progress"><span>{progress.done}/{progress.total}</span><i><b style={{width:`${progress.total?Math.round(progress.done/progress.total*100):100}%`}}/></i></div>
    {autosave.snapshot.status==="error"&&<button className="mapping-retry" type="button" onClick={autosave.retry}><RotateCcw size={15}/> Wiederholen</button>}
    {autosave.snapshot.status==="conflict"&&<div className="mapping-conflict"><CircleAlert size={16}/><span>Geändert</span><Button size="sm" variant="ghost" label="Neu laden" onPress={()=>location.reload()}/></div>}
    <div className="mapping-columns" aria-hidden="true"><span>Quelle</span><span>Ziel</span></div>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={items.map(item=>item.source.id)} strategy={verticalListSortingStrategy}><ul className="mapping-rows">{items.map((item,index)=><MappingRow key={item.source.id} item={item} state={state} rootId={rootId} index={index} disabled={autosave.snapshot.status==="conflict"} onMap={map} onExclude={exclude} onOpen={onOpenSource}/>)}</ul></SortableContext></DndContext>
    {!items.length&&<div className="mapping-empty"><Check size={18}/></div>}
    {progress.open===0&&autosave.snapshot.status==="saved"&&<div className="mapping-next"><Button label={nextRoot?"Nächster Bereich":state.pending===0?"Erstellen":"Übersicht"} iconAfter="arrow-right" onPress={finish}/></div>}
  </section>;
}

export function SourceMappingBoard(props:{courseId:number;state:PipelineState;rootId?:string;onState:(state:PipelineState)=>void;onOpenRoot:(id:string)=>void;onOverview:()=>void;onOpenSource:(item:PipelineSourceView)=>void;onCreate:()=>void}){
  return props.rootId ? <MappingDetail courseId={props.courseId} state={props.state} rootId={props.rootId} onState={props.onState} onOpenRoot={props.onOpenRoot} onOverview={props.onOverview} onOpenSource={props.onOpenSource} onCreate={props.onCreate}/>
    : <MappingOverview state={props.state} onOpenRoot={props.onOpenRoot} onOpenSource={props.onOpenSource} onCreate={props.onCreate}/>;
}
