import type { ReactNode } from "react";
import { Button, Checkbox, Form, Input } from "@dotnaos/ui-base";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, PencilLine } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PipelineUnit } from "./pipeline-api";
import { descendants, unitHidden, unitKind, unitLabel } from "./learning-structure";
import { DialogShell } from "./DialogShell";
import { StructurePicker } from "./StructurePicker";

export function StructureRow({unit,units,disabled,expanded,onToggle,onChange,onHide,onOpen,onParent,onKind,inlineChildren=false,nestedOpen=false,nestedCount=0,onToggleNested,children,editing=true,selected=false,onSelect}:{
  unit:PipelineUnit;units:PipelineUnit[];disabled:boolean;expanded:boolean;onToggle:()=>void;
  onChange:(patch:Partial<PipelineUnit>)=>void;onHide:(hidden:boolean)=>void;onOpen:()=>void;
  onParent:(id:string|null)=>void;onKind:()=>void;inlineChildren?:boolean;nestedOpen?:boolean;nestedCount?:number;
  onToggleNested?:()=>void;children?:ReactNode;editing?:boolean;selected?:boolean;onSelect?:()=>void;
}) {
  const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging}=useSortable({id:unit.id,disabled:disabled||!editing});
  const childUnits=units.filter(child=>child.parentId===unit.id);
  const hidden=unitHidden(unit,units),kind=unitKind(unit),excluded=descendants(units,unit.id);
  const inheritedHidden = hidden && !unit.hidden;
  const script=units.filter(item=>unitKind(item)==="script");
  const links=(unit.scriptUnitIds??[]).map(id=>script.find(item=>item.id===id)).filter((item):item is PipelineUnit=>!!item);
  const visibilityAction = hidden ? "Einblenden" : "Ausblenden";
  const visibilityTitle = inheritedHidden ? "Zuerst den übergeordneten Eintrag einblenden" : visibilityAction;
  const nestedToggle=inlineChildren&&nestedCount>0;
  const childToggle=!inlineChildren&&childUnits.length>0;
  return <>
    <li ref={setNodeRef} data-unit-id={unit.id} data-kind={kind} data-selected={selected||undefined} data-hidden={hidden||undefined} data-dragging={isDragging||undefined}
      style={{transform:CSS.Transform.toString(transform),transition}}>
      <div className="structure-line">
        {editing ? <>
          <span className="structure-visibility-checkbox" title={visibilityTitle}>
            <Checkbox label={`In Struktur verwenden: ${unitLabel(unit)}`} checked={!hidden} disabled={disabled||inheritedHidden}
              onCheckedChange={checked=>onHide(!checked)}/>
          </span>
          {nestedToggle?<button type="button" className="structure-icon structure-leading structure-nested-toggle" ref={setActivatorNodeRef} {...attributes} {...listeners}
            onClick={onToggleNested} disabled={disabled} aria-expanded={nestedOpen} aria-label={`${unitLabel(unit)} ${nestedOpen?"einklappen":"ausklappen"}`} title={nestedOpen?"Einklappen":"Ausklappen"}>
            <ChevronDown size={16} aria-hidden="true" className={nestedOpen?"structure-chevron-open":undefined}/>
          </button>:childToggle?<button type="button" className="structure-icon structure-leading" ref={setActivatorNodeRef} {...attributes} {...listeners}
            onClick={onOpen} disabled={disabled} aria-label={`${unitLabel(unit)} öffnen`} title="Öffnen"><ChevronRight size={16} aria-hidden="true"/></button>:
          <button type="button" className="structure-handle structure-drag-only" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
            aria-label={`${unitLabel(unit)} verschieben`} title="Ziehen zum Sortieren"><GripVertical size={15} aria-hidden="true"/></button>}
          <div className="structure-name">
            <Input size="sm" fullWidth accessibilityLabel={`Anzeigename: ${unit.title}`} value={unitLabel(unit)}
              onValueChange={value=>onChange({customTitle:value===unit.title?null:value})} disabled={disabled}/>
            {kind==="tasks" && !inlineChildren && <button type="button" className="structure-links" onClick={onToggle} disabled={disabled} title={links.map(unitLabel).join(", ")||"Skript zuordnen"}>
              {links.length?links.map(unitLabel).join(" · "):"Skript zuordnen"}
            </button>}
          </div>
          <button type="button" className="structure-icon structure-more" onClick={onToggle} disabled={disabled} aria-haspopup="dialog" aria-expanded={expanded} aria-label={`Optionen: ${unitLabel(unit)}`}><MoreHorizontal size={18} aria-hidden="true"/></button>
        </> : <>
          {nestedToggle ? <button type="button" className="structure-icon structure-leading structure-nested-toggle" onClick={onToggleNested} aria-expanded={nestedOpen} aria-label={`${unitLabel(unit)} ${nestedOpen?"einklappen":"ausklappen"}`} title={nestedOpen?"Einklappen":"Ausklappen"}>
            <ChevronDown size={16} aria-hidden="true" className={nestedOpen?"structure-chevron-open":undefined}/>
          </button> : <span className="structure-leading structure-leading-spacer"/>}
          <button type="button" className="structure-name-button" onClick={onSelect} title={unitLabel(unit)}>
            {kind==="tasks" && <PencilLine size={14} aria-hidden="true"/>}<span>{unitLabel(unit)}</span>
          </button>
        </>}
      </div>
      {inlineChildren && nestedOpen && children && <div className="structure-inline-children">{children}</div>}
    </li>
    {editing && expanded && <DialogShell title="Eintrag bearbeiten" onClose={onToggle}>
      <div className="structure-options">
        <Form.Field label="Anzeigename"><Input size="sm" fullWidth accessibilityLabel="Anzeigename im Dialog" value={unitLabel(unit)} disabled={disabled}
          onValueChange={value=>onChange({customTitle:value===unit.title?null:value})}/></Form.Field>
        {unit.customTitle!=null && <div className="structure-original">
          <span>{unit.sourceGroupId?"Moodle-Name (unverändert)":"Ursprünglicher Name"}</span>
          <p>{unit.title}</p>
          <Button size="sm" variant="ghost" label="Originalnamen verwenden" disabled={disabled} onPress={()=>onChange({customTitle:null})}/>
        </div>}
        <StructurePicker label="Übergeordneter Eintrag" units={units.filter(item=>unitKind(item)===kind&&!excluded.has(item.id))} selected={unit.parentId?[unit.parentId]:[]} disabled={disabled} onChange={ids=>onParent(ids[0]??null)}/>
        {kind==="tasks" && <StructurePicker label="Skript-Zuordnung" units={script} selected={unit.scriptUnitIds??[]} multiple disabled={disabled} onChange={ids=>onChange({scriptUnitIds:ids})}/>}
        <div className="structure-option-actions">
          <Button size="sm" variant="ghost" label={kind==="script"?"Als Aufgabe klassifizieren":"Als Skript klassifizieren"} onPress={onKind} disabled={disabled}/>
          <Button size="sm" variant="secondary" label="Fertig" onPress={onToggle}/>
        </div>
      </div>
    </DialogShell>}
  </>;
}
