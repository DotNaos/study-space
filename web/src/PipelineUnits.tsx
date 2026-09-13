import { Button } from "@dotnaos/ui-base";
import { ChevronRight } from "lucide-react";
import type { PipelineState, PipelineUnit } from "./pipeline-api";
import { unitHidden, unitKind, unitLabel } from "./learning-structure";

export function PipelineUnits({state,unit,onOpen,onEdit}:{state:PipelineState;unit?:PipelineUnit;onOpen:(id:string)=>void;onEdit:()=>void}) {
  const visible=state.units.filter(item=>!unitHidden(item,state.units));
  const children=visible.filter(item=>item.parentId===(unit?.id??null)).sort((a,b)=>a.order-b.order);
  function list(items:PipelineUnit[]) {return <ul className="pipeline-list">{items.map(item=><li key={item.id}>
    <button className="pipeline-row" onClick={()=>onOpen(item.id)} title={item.title}><span><strong>{unitLabel(item)}</strong><small>{state.sources.filter(source=>source.decision?.uses.some(use=>use.unitId===item.id)).length} Quellen zugeordnet</small></span><ChevronRight size={16} aria-hidden="true"/></button>
  </li>)}</ul>;}
  const related=unit ? visible.filter(item=>unitKind(unit)==="tasks"?(unit.scriptUnitIds??[]).includes(item.id):(item.scriptUnitIds??[]).includes(unit.id)) : [];
  return <>
    {unit?list(children):<>{["script","tasks"].map(kind=><section key={kind}><h3>{kind==="script"?"Skript":"Aufgaben"}</h3>{list(children.filter(item=>unitKind(item)===kind))}</section>)}</>}
    {related.length>0 && <section><h3>{unit && unitKind(unit)==="tasks"?"Zugeordnetes Skript":"Zugeordnete Aufgaben"}</h3>{list(related)}</section>}
    {state.units.length>visible.length && <Button size="sm" variant="ghost" label={`${state.units.length-visible.length} ausgeblendete Einträge verwalten`} onPress={onEdit}/>}
  </>;
}
