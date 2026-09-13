import { afterEach, expect, test } from "bun:test";
import { MappingAutosave } from "../src/mapping-autosave";
import type { MappingItem, PipelineState } from "../src/pipeline-api";

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});
const unit={id:"a".repeat(32),title:"Block",parentId:null,order:0,kind:"script" as const};
const state=(revision=1):PipelineState=>({courseId:7,revision,observedHash:"x",persisted:true,problem:null,groups:[],sources:[],units:[unit],suggestedUnits:[],history:[],pending:0,blocked:0,unattributedSections:[]});
const item=(id="b",order=0):MappingItem=>({sourceId:id.repeat(64).slice(0,64),sourceVersion:"f".repeat(64),disposition:"use",uses:[{unitId:unit.id,role:"teaching",order}]});
function storage(){const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>void data.set(key,value),removeItem:(key:string)=>void data.delete(key)} as Storage;}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return{promise,resolve};}

function json(value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});}

test("mapping changes are batched under one revision and acknowledged without a manual save",async()=>{
  const calls:any[]=[];let current=state();globalThis.fetch=(async(_input,init)=>{calls.push(JSON.parse(String(init?.body)));current=state(current.revision+1);return json(current);}) as typeof fetch;
  const queue=new MappingAutosave(7,current,next=>{current=next;},storage(),100000);queue.enqueue([item("b"),item("c",1)]);expect(queue.getSnapshot().status).toBe("pending");
  expect(await queue.flush()).toBe(true);expect(calls).toHaveLength(1);expect(calls[0].expectedRevision).toBe(1);expect(calls[0].items).toHaveLength(2);expect(queue.getSnapshot()).toEqual({status:"saved",error:"",dirty:0});queue.stop();
});

test("mapping edits during an in-flight request serialize onto the returned revision",async()=>{
  const first=deferred<Response>();const revisions:number[]=[];let count=0,current=state();
  globalThis.fetch=(async(_input,init)=>{const body=JSON.parse(String(init?.body));revisions.push(body.expectedRevision);count++;if(count===1)return first.promise;current=state(body.expectedRevision+1);return json(current);}) as typeof fetch;
  const queue=new MappingAutosave(7,current,next=>{current=next;},storage(),100000);queue.enqueue([item("b",0)]);const flush=queue.flush();queue.enqueue([item("b",2)]);first.resolve(json(state(2)));expect(await flush).toBe(true);expect(revisions).toEqual([1,2]);expect(queue.getSnapshot().status).toBe("saved");queue.stop();
});

test("conflicts preserve the local mapping draft for explicit reconciliation",async()=>{
  const saved=storage();globalThis.fetch=(async()=>json({code:"pipeline_conflict",detail:"conflict"},409)) as typeof fetch;
  const queue=new MappingAutosave(7,state(),()=>{},saved,100000);queue.enqueue([item("b",3)]);expect(await queue.flush()).toBe(false);expect(queue.getSnapshot().status).toBe("conflict");queue.stop();
  const recovered=new MappingAutosave(7,state(2),()=>{},saved,100000);expect(recovered.getSnapshot().status).toBe("conflict");expect(recovered.getSnapshot().dirty).toBe(1);recovered.stop();
});
