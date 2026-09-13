import { expect, test } from "bun:test";
import { batchProposalFor, mappingProgress, mappingRoots, mappingSources, proposalFor } from "../src/source-mapping";
import type { PipelineSourceView, PipelineState, PipelineUnit } from "../src/pipeline-api";

const script:PipelineUnit={id:"a".repeat(32),title:"Block 1",parentId:null,order:0,kind:"script",hidden:false,sourceGroupId:10,scriptUnitIds:[]};
const task:PipelineUnit={id:"b".repeat(32),title:"Aufgabe 1",parentId:null,order:0,kind:"tasks",hidden:false,sourceGroupId:20,scriptUnitIds:[script.id]};
const hidden:PipelineUnit={id:"c".repeat(32),title:"Vorlage",parentId:null,order:1,kind:"script",hidden:true,sourceGroupId:30,scriptUnitIds:[]};
function source(id:string,sectionId:number,suggestedRole:string,text="",status="pending"):PipelineSourceView{return {source:{id:id.repeat(64).slice(0,64),sectionId,moduleId:null,name:`Quelle ${id}`,kind:"file",mimeType:null,sourceVersion:"f".repeat(64),materialRevision:null,acquisition:"not-imported",problem:null,warnings:[],text,studyUrl:null,present:true,suggestedRole},status,decision:null,sectionIds:[],exerciseIds:[]};}
function state():PipelineState{return {courseId:7,revision:1,observedHash:"x",persisted:true,problem:null,groups:[{id:10,title:"Block 1",order:0,parentId:null},{id:20,title:"Aufgabe 1",order:1,parentId:10},{id:30,title:"Vorlage",order:2,parentId:null}],sources:[source("1",10,"teaching"),source("2",20,"teaching"),source("3",10,"reference"),source("4",10,"teaching","________________________"),source("5",10,"unresolved"),source("6",30,"teaching","","structure-hidden")],units:[script,task,hidden],suggestedUnits:[],history:[],pending:5,blocked:0,unattributedSections:[]};}

test("mapping roots drill into linked task source groups while hidden structure stays outside the workload",()=>{
  const value=state();expect(mappingRoots(value).map(unit=>unit.id)).toEqual([script.id]);
  expect(mappingSources(value,script.id).map(item=>item.source.sectionId)).toEqual([10,20,10,10,10]);
  expect(mappingProgress(value,script.id)).toEqual({total:5,open:5,done:0});
});

test("safe proposals use reviewed containment without inventing ambiguous or solution relationships",()=>{
  const value=state();
  const teaching=proposalFor(value,value.sources[0],script.id,0)!;expect(teaching.uses[0]).toMatchObject({unitId:script.id,role:"teaching",order:0});
  const taskFile=proposalFor(value,value.sources[1],script.id,1)!;expect(taskFile.uses[0]).toMatchObject({unitId:task.id,role:"task"});
  const reference=proposalFor(value,value.sources[2],script.id,2)!;expect(reference.uses[0]).toMatchObject({unitId:"",role:"reference"});
  expect(proposalFor(value,value.sources[3],script.id,3)?.disposition).toBe("exclude");
  expect(proposalFor(value,value.sources[4],script.id,4)).toBeUndefined();
  const solution={...value.sources[0],source:{...value.sources[0].source,suggestedRole:"solution"}};expect(proposalFor(value,solution,script.id,0)).toBeUndefined();
});

test("reviewed and inherited-hidden sources no longer inflate mapping progress",()=>{
  const value=state();value.sources[0]={...value.sources[0],status:"reviewed",decision:{sourceId:value.sources[0].source.id,sourceVersion:"f".repeat(64),disposition:"use",uses:[{unitId:script.id,role:"teaching",order:0}],reason:"x",actor:"user",decidedAt:"2026-01-01"}};
  value.sources[3]={...value.sources[3],status:"excluded",decision:{sourceId:value.sources[3].source.id,sourceVersion:"f".repeat(64),disposition:"exclude",uses:[],reason:"x",actor:"user",decidedAt:"2026-01-01"}};
  expect(mappingProgress(value,script.id)).toEqual({total:5,open:3,done:2});
});

test("an explicit cross-container decision appears under its reviewed target",()=>{
  const value=state();const source=value.sources[5];source.status="reviewed";source.decision={sourceId:source.source.id,sourceVersion:source.source.sourceVersion,disposition:"use",uses:[{unitId:script.id,role:"teaching",order:7}],reason:"Moved intentionally",actor:"user",decidedAt:"2026-01-01"};
  expect(mappingSources(value,script.id).some(item=>item.source.id===source.source.id)).toBe(true);
});


test("batch proposals exclude metadata-only activities and task headings outside task groups",()=>{
  const value=state();const activity={...value.sources[1],source:{...value.sources[1].source,kind:"activity",suggestedRole:"task"}};expect(batchProposalFor(value,activity,script.id,1)).toBeUndefined();
  const heading={...value.sources[1],source:{...value.sources[1].source,kind:"text",suggestedRole:"task",sectionId:10}};expect(batchProposalFor(value,heading,script.id,1)).toBeUndefined();
  expect(batchProposalFor(value,value.sources[1],script.id,1)).toBeDefined();
});
