import { expect, test } from "bun:test";
import { ApiError } from "../src/api";
import { StructureAutosave } from "../src/structure-autosave";
import { nextSourceDecision, sourceProgress } from "../src/preparation-flow";
import type { PipelineState, PipelineUnit } from "../src/pipeline-api";

const unit: PipelineUnit = { id:"a".repeat(32), title:"Block 1", parentId:null, order:0, kind:"script", customTitle:null };
const source = (id:string,status="pending") => ({source:{id,present:true},status}) as PipelineState["sources"][number];
const state = (units=[unit], revision=4): PipelineState => ({courseId:7,revision,observedHash:"fixture",persisted:true,problem:null,groups:[],sources:[source("b".repeat(64))],units,suggestedUnits:[unit],history:[],pending:1,blocked:0,unattributedSections:[]});
function storage() { const data=new Map<string,string>();return { getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);} }; }
function deferred<T>() {let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}

test("mounting a source-derived structure never approves it or saves", async()=>{
  let calls=0;const queue=new StructureAutosave(state([],0),async units=>{calls++;return state(units,1);},storage(),100000);
  queue.start();expect(queue.getSnapshot().status).toBe("proposal");await queue.flush();expect(calls).toBe(0);
  expect(await queue.flush(true)).toBe(true);expect(calls).toBe(1);expect(queue.getSnapshot().status).toBe("saved");queue.stop();
});
test("edits during a request are serialized against the next revision without replacing typed text",async()=>{
  const first=deferred<PipelineState>();const calls:{revision:number;units:PipelineUnit[]}[]=[];
  const queue=new StructureAutosave(state(),async(units,revision)=>{calls.push({revision,units});return calls.length===1?first.promise:state(units,revision+1);},storage(),100000);
  queue.update(current=>current.map(u=>({...u,customTitle:"First"})));
  const flushed=queue.flush();queue.update(current=>current.map(u=>({...u,customTitle:"Latest"})));
  expect(calls.length).toBe(1);first.resolve(state(calls[0].units,5));expect(await flushed).toBe(true);
  expect(calls.map(call=>call.revision)).toEqual([4,5]);expect(queue.getSnapshot().units[0].customTitle).toBe("Latest");expect(queue.getSnapshot().status).toBe("saved");queue.stop();
});
test("network failure preserves the complete draft, including on remount",async()=>{
  const saved=storage();const queue=new StructureAutosave(state(),async()=>{throw new TypeError("offline");},saved,100000);
  queue.update(current=>current.map(u=>({...u,hidden:true,customTitle:"My label"})));expect(await queue.flush()).toBe(false);
  expect(queue.getSnapshot().status).toBe("error");queue.stop();
  const recovered=new StructureAutosave(state(),async(units,revision)=>state(units,revision+1),saved,100000);
  expect(recovered.getSnapshot().units[0].hidden).toBe(true);expect(recovered.getSnapshot().status).toBe("pending");await recovered.flush();expect(recovered.getSnapshot().status).toBe("saved");recovered.stop();
});
test("revision conflicts never overwrite another editor or silently accept its revision",async()=>{
  let calls=0;const queue=new StructureAutosave(state(),async()=>{calls++;throw new ApiError(409,"pipeline_conflict","conflict");},storage(),100000);
  queue.update(current=>current.map(u=>({...u,customTitle:"Local"})));expect(await queue.flush()).toBe(false);
  queue.accept(state([{...unit,customTitle:"Remote"}],5));expect(queue.getSnapshot().status).toBe("conflict");expect(queue.getSnapshot().units[0].customTitle).toBe("Local");
  expect(await queue.flush()).toBe(false);expect(calls).toBe(1);
  queue.resolve(state([{...unit,customTitle:"Remote"}],5),false);expect(queue.getSnapshot().units[0].customTitle).toBe("Remote");expect(queue.getSnapshot().status).toBe("saved");queue.stop();
});
test("a response lost after persistence is reconciled by a matching read, not a second overwrite",async()=>{
  let calls=0;const queue=new StructureAutosave(state(),async()=>{calls++;throw new TypeError("response lost");},storage(),100000);
  queue.update(current=>current.map(u=>({...u,customTitle:"Saved remotely"})));await queue.flush();
  queue.accept(state([{...unit,customTitle:"Saved remotely"}],5));expect(queue.getSnapshot().status).toBe("saved");await queue.flush();expect(calls).toBe(1);queue.stop();
});
test("invalid text stays local and disables continuing until corrected",async()=>{
  let calls=0;const queue=new StructureAutosave(state(),async units=>{calls++;return state(units,5);},storage(),100000);
  queue.update(current=>current.map(u=>({...u,customTitle:""})));expect(await queue.flush(true)).toBe(false);expect(calls).toBe(0);expect(queue.getSnapshot().status).toBe("invalid");
  queue.update(current=>current.map(u=>({...u,customTitle:"Corrected"})));expect(await queue.flush()).toBe(true);expect(calls).toBe(1);queue.stop();
});
test("new provider reads only update clean structure; local edits remain recoverable",()=>{
  const saved=storage();const queue=new StructureAutosave(state(),async units=>state(units,5),saved,100000);
  queue.update(current=>current.map(u=>({...u,customTitle:"Local"})));queue.accept(state([{...unit,customTitle:"Remote"}],5));
  expect(queue.getSnapshot().status).toBe("conflict");
  const restored=new StructureAutosave(state([{...unit,customTitle:"Remote"}],5),async units=>state(units,6),saved,100000);
  expect(restored.getSnapshot().status).toBe("conflict");expect(restored.getSnapshot().units[0].customTitle).toBe("Local");queue.stop();restored.stop();
});

test("deleting a persisted user-created unit is sent as an explicit delete, not an omission",async()=>{
  const custom={...unit,sourceGroupId:null};let deleted:string[]|undefined;
  const queue=new StructureAutosave(state([custom]),async(units,revision,deletedUnitIds)=>{deleted=deletedUnitIds;return state(units,revision+1);},storage(),100000);
  queue.update([]);expect(await queue.flush()).toBe(true);expect(deleted).toEqual([custom.id]);queue.stop();
});

test("guidance moves to the next unconfirmed source without confirming, hiding, or dropping any source",()=>{
  const plan=state();plan.sources=[source("a","reviewed"),source("b","pending"),source("c","stale"),source("d","excluded"),source("e","partial"),{...source("f"),source:{...source("f").source,present:false}}];
  expect(nextSourceDecision(plan)?.source.id).toBe("b");expect(nextSourceDecision(plan,"b")?.source.id).toBe("c");expect(nextSourceDecision(plan,"c")?.source.id).toBe("b");
  expect(sourceProgress(plan)).toEqual({reviewed:3,total:6,open:2});expect(plan.sources.length).toBe(6);
});


test("a late response from a previous editor cannot clear the next editor's newer recovery draft",async()=>{
  const saved=storage(), pending=deferred<PipelineState>();
  const previous=new StructureAutosave(state(),()=>pending.promise,saved,100000);
  previous.update(current=>current.map(unit=>({...unit,customTitle:"Earlier edit"})));
  const write=previous.flush();
  const next=new StructureAutosave(state(),async units=>state(units,5),saved,100000);
  next.start();next.update(current=>current.map(unit=>({...unit,customTitle:"Newer edit"})));
  pending.resolve(state([{...unit,customTitle:"Earlier edit"}],5));await write;
  const recovered=new StructureAutosave(state([{...unit,customTitle:"Earlier edit"}],5),async units=>state(units,6),saved,100000);
  expect(recovered.getSnapshot().units[0].customTitle).toBe("Newer edit");expect(recovered.getSnapshot().status).toBe("conflict");
  next.accept(state([{...unit,customTitle:"Earlier edit"}],5));previous.stop();next.stop();recovered.stop();
});
