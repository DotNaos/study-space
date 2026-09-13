import { Button, Input } from "@dotnaos/ui-base";
import { ChevronRight, Eye, EyeOff, GripVertical, MoreHorizontal } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { PipelineUnit } from "./pipeline-api";
import { descendants, unitHidden, unitKind, unitLabel } from "./learning-structure";
import { StructurePicker } from "./StructurePicker";

export function StructureRow({unit,units,disabled,expanded,onToggle,onChange,onHide,onOpen,onParent,onKind}:{
  unit:PipelineUnit;units:PipelineUnit[];disabled:boolean;expanded:boolean;onToggle:()=>void;
  onChange:(patch:Partial<PipelineUnit>)=>void;onHide:(hidden:boolean)=>void;onOpen:()=>void;
  onParent:(id:string|null)=>void;onKind:()=>void;
}) {
  const {attributes,listeners,setNodeRef,setActivatorNodeRef,transform,transition,isDragging}=useSortable({id:unit.id,disabled});
  const children=units.filter(child=>child.parentId===unit.id);
  const hidden=unitHidden(unit,units),kind=unitKind(unit),excluded=descendants(units,unit.id);
  const script=units.filter(item=>unitKind(item)==="script");
  const links=(unit.scriptUnitIds??[]).map(id=>script.find(item=>item.id===id)).filter((item):item is PipelineUnit=>!!item);
  return <li ref={setNodeRef} data-unit-id={unit.id} data-hidden={hidden||undefined} data-dragging={isDragging||undefined}
    style={{transform:CSS.Transform.toString(transform),transition}}>
    <div className="structure-line">
      <button type="button" className="structure-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled}
        aria-label={`${unitLabel(unit)} verschieben`} title="Ziehen zum Sortieren"><GripVertical size={16}/></button>
      <div className="structure-name">
        <Input size="sm" fullWidth accessibilityLabel={`Anzeigename: ${unit.title}`} value={unitLabel(unit)}
          onValueChange={value=>onChange({customTitle:value===unit.title?null:value})} disabled={disabled}/>
        {kind==="tasks" && <button type="button" className="structure-links" onClick={onToggle} title={links.map(unitLabel).join(", ")||"Skript zuordnen"}>
          {links.length?links.map(unitLabel).join(" · "):"Skript zuordnen"}
        </button>}
      </div>
      {hidden && <EyeOff size={15} aria-label="Ausgeblendet" className="structure-hidden-icon"/>}
      {children.length>0 && <button type="button" className="structure-icon" onClick={onOpen} aria-label={`${unitLabel(unit)} öffnen`} title={`${children.length} Untereinträge`}><span>{children.length}</span><ChevronRight size={16}/></button>}
      <button type="button" className="structure-icon" onClick={onToggle} aria-expanded={expanded} aria-label={`Optionen: ${unitLabel(unit)}`}><MoreHorizontal size={18}/></button>
    </div>
    {expanded && <div className="structure-options">
      <p className="structure-original"><span>{unit.sourceGroupId?"Moodle-Name (unverändert)":"Ursprünglicher Name"}</span>{unit.title}</p>
      {unit.customTitle!=null && <Button size="sm" variant="ghost" label="Originalnamen verwenden" onPress={()=>onChange({customTitle:null})}/>}
      <StructurePicker label="Übergeordneter Eintrag" units={units.filter(item=>unitKind(item)===kind&&!excluded.has(item.id))} selected={unit.parentId?[unit.parentId]:[]} onChange={ids=>onParent(ids[0]??null)}/>
      {kind==="tasks" && <StructurePicker label="Skript-Zuordnung" units={script} selected={unit.scriptUnitIds??[]} multiple onChange={ids=>onChange({scriptUnitIds:ids})}/>}
      <div className="structure-option-actions">
        <Button size="sm" variant="ghost" label={kind==="script"?"Zu Aufgaben verschieben":"Zum Skript verschieben"} onPress={onKind} disabled={disabled}/>
        <button type="button" onClick={()=>onHide(!unit.hidden)} disabled={disabled} className="structure-hide">
          {unit.hidden?<Eye size={16}/>:<EyeOff size={16}/>} {unit.hidden?"Wieder einblenden":"Ausblenden"}
        </button>
      </div>
      <p className="structure-help">Ausblenden ist rückgängig machbar. Quellen und Bearbeitungen bleiben erhalten.</p>
    </div>}
  </li>;
}
