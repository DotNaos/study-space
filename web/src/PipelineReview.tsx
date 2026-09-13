import { useState } from "react";
import { Button, Form, Input, Select, Textarea } from "@dotnaos/ui-base";
import { FileText, PencilLine, CheckCheck, Paperclip, Library, EyeOff, Check, ChevronDown, Rows3 } from "lucide-react";
import { StructurePicker } from "./StructurePicker";
import { unitHidden, unitKind, unitLabel } from "./learning-structure";
import type { PipelineSourceView, PipelineState, SourceUse } from "./pipeline-api";
import { roleLabels, statusLabels } from "./pipeline-api";

const roles = [
  {id:"teaching", label:"Skript", Icon:FileText}, {id:"task", label:"Aufgaben", Icon:PencilLine},
  {id:"solution", label:"Lösung", Icon:CheckCheck}, {id:"support", label:"Material", Icon:Paperclip},
  {id:"reference", label:"Referenz", Icon:Library},
];
export function PipelineReview({ state, item, busy, onSave, continueAfterSave = false }: {
  state: PipelineState; item: PipelineSourceView; busy: boolean; continueAfterSave?: boolean;
  onSave: (body: { disposition: string; uses: SourceUse[]; reason: string }) => Promise<void>;
}) {
  const [exclude, setExclude] = useState(item.decision?.disposition === "exclude");
  const [uses, setUses] = useState<SourceUse[]>(item.decision?.uses.length ? item.decision.uses : [{
    unitId:"",role:item.source.suggestedRole === "unresolved" ? "reference" : item.source.suggestedRole,
  }]);
  const [reason, setReason] = useState(item.decision?.reason ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [ranges, setRanges] = useState<number[]>(uses.flatMap((use,index)=>use.firstPage != null ? [index] : []));
  function update(index:number,patch:Partial<SourceUse>) {setUses(current=>current.map((use,i)=>i===index?{...use,...patch}:use));}
  const complete = exclude ? !!reason.trim() : uses.every(use=>
    (!["teaching","task","solution"].includes(use.role) || !!use.unitId) &&
    (use.role !== "solution" || !!use.relatedSourceId) &&
    ((use.firstPage == null && use.lastPage == null) || !!use.firstPage && !!use.lastPage && use.firstPage>0 && use.lastPage>=use.firstPage));
  const decisionReason = reason.trim() || "Manuell bestätigt: " + uses.map(use=>[roleLabels[use.role], state.units.find(unit=>unit.id===use.unitId)].map(value=>typeof value === "object" && value ? unitLabel(value) : value).filter(Boolean).join(" → ")).join("; ");
  return <div className="pipeline-review prepare-review">
    <div className="prepare-review-heading"><h3>Zuordnung</h3><span data-state={item.status} title={statusLabels[item.status]}>{item.decision ? statusLabels[item.status] : "Vorschlag"}</span></div>
    {!exclude && uses.map((use,index)=><div className="pipeline-use" key={index}>
      <div className="prepare-roles" role="group" aria-label={`Verwendung ${index+1}`}>
        {roles.map(({id,label,Icon})=><button type="button" key={id} disabled={busy} aria-pressed={use.role===id}
          onClick={()=>update(index,{role:id,unitId:"",relatedSourceId:id === "solution" ? use.relatedSourceId : null})}><Icon size={19} aria-hidden="true"/><span>{label}</span></button>)}
      </div>
      <StructurePicker label={use.role === "teaching" ? "Skript" : use.role === "task" || use.role === "solution" ? "Aufgabengruppe" : "Zuordnung"}
        emptyLabel="Ziel auswählen" selected={use.unitId ? [use.unitId] : []} disabled={busy}
        units={state.units.filter(unit=>unit.id===use.unitId || !unitHidden(unit,state.units) && (use.role === "teaching" ? unitKind(unit)==="script" : use.role === "task" || use.role === "solution" ? unitKind(unit)==="tasks" : true))}
        onChange={ids=>update(index,{unitId:ids[0]??""})}/>
      {use.role === "solution" && <Select accessibilityLabel="Zugehörige Aufgabenquelle" value={use.relatedSourceId??""} size="sm" disabled={busy}
        options={[{value:"",label:"Aufgabenquelle auswählen"},...state.sources.filter(candidate=>candidate.source.id!==item.source.id && candidate.source.present).map(candidate=>({value:candidate.source.id,label:candidate.source.name}))]}
        onValueChange={relatedSourceId=>update(index,{relatedSourceId})}/>}
      <button type="button" className="prepare-secondary" aria-expanded={ranges.includes(index)} disabled={busy}
        onClick={()=>setRanges(current=>current.includes(index)?current.filter(i=>i!==index):[...current,index])}><Rows3 size={16}/><span>{use.firstPage ? `Seiten ${use.firstPage}–${use.lastPage??"…"}` : "Seiten eingrenzen"}</span><ChevronDown size={14}/></button>
      {ranges.includes(index) && <div className="pipeline-range-fields">
        <Form.Field label="Von"><Input type="number" value={String(use.firstPage??"")} disabled={busy} onValueChange={value=>update(index,{firstPage:value?Number(value):null})}/></Form.Field>
        <Form.Field label="Bis"><Input type="number" value={String(use.lastPage??"")} disabled={busy} onValueChange={value=>update(index,{lastPage:value?Number(value):null})}/></Form.Field>
      </div>}
      {uses.length>1 && <Button size="sm" variant="ghost" label="Zuordnung entfernen" disabled={busy} onPress={()=>setUses(current=>current.filter((_,i)=>i!==index))}/>}
    </div>)}
    <div className="prepare-review-tools">
      {!exclude && <Button size="sm" variant="ghost" icon="plus" label="Weitere Zuordnung" disabled={busy} onPress={()=>setUses(current=>[...current,{unitId:"",role:"reference"}])}/>}
      <button type="button" className="prepare-secondary" aria-pressed={exclude} disabled={busy} onClick={()=>setExclude(!exclude)}><EyeOff size={17}/><span>{exclude?"Ausgelassen":"Auslassen"}</span></button>
    </div>
    {exclude || noteOpen ? <Form.Field label={exclude ? "Grund fürs Auslassen" : "Notiz"}><Textarea rows={2} fullWidth value={reason} disabled={busy} onValueChange={setReason}/></Form.Field>
      : <Button size="sm" variant="ghost" icon="pencil-line" label="Notiz" disabled={busy} onPress={()=>setNoteOpen(true)}/>}
    <div className="prepare-review-confirm">
      <Button label={busy?"Wird übernommen …":continueAfterSave?"Bestätigen & weiter":"Bestätigen"} icon="check" iconAfter={continueAfterSave?"arrow-right":undefined}
        disabled={busy || !complete || !item.source.present || !!state.problem}
        onPress={()=>void onSave({disposition:exclude?"exclude":"use",uses:exclude?[]:uses,reason:decisionReason})}/>
    </div>
    {item.decision && <span className="prepare-review-audit" title={new Date(item.decision.decidedAt).toLocaleString("de-CH")}><Check size={13}/>{item.decision.actor}</span>}
  </div>;
}
export { PipelineStructure } from "./PipelineStructure";
