import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Exercise the real adapter while replacing authentication and every HTTP request.
const output = await build({
  entryPoints: [new URL("../main/services/google-api.ts", import.meta.url).pathname],
  bundle:true, platform:"node",format:"esm",write:false,logLevel:"silent",
  plugins:[{name:"fake-auth",setup(api){
    api.onResolve({filter:/google-auth\.js$/},() => ({path:"fake-auth",namespace:"fixture"}));
    api.onLoad({filter:/.*/,namespace:"fixture"},() => ({contents:'export class GoogleAuthError extends Error {} export async function getGoogleAccessToken(){return "fixture-token"}',loader:"js"}));
  }}],
});
const adapter = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const json = (body,status=200) => new globalThis.Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
const originalFetch = globalThis.fetch;

test("Tasks paginates task lists and tasks, retaining list identity", async () => {
  const calls=[];
  globalThis.fetch=async (input) => {
    const url=new URL(input);calls.push(url);
    if(url.pathname.endsWith("/@me/lists")) return json(url.searchParams.has("pageToken") ? {items:[{id:"b",title:"B"}]} : {items:[{id:"a",title:"A"}],nextPageToken:"lists-next"});
    if(url.pathname.includes("/lists/a/")) return json(url.searchParams.has("pageToken") ? {items:[{id:"two",title:"Second"}]} : {items:[{id:"shared",title:"First"}],nextPageToken:"tasks-next"});
    if(url.pathname.includes("/lists/b/")) return json({items:[{id:"shared",title:"Separate task"}]});
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  try {
    const result=await adapter.listTasksWithCoverage();
    assert.equal(result.items.length,3);assert.equal(result.coverage.complete,true);
    assert.deepEqual(result.items.filter(x=>x.id==="shared").map(x=>x.listId),["a","b"]);
    assert.ok(calls.some(x=>x.searchParams.get("pageToken")==="lists-next"));
    assert.ok(calls.some(x=>x.searchParams.get("pageToken")==="tasks-next"));
  } finally {globalThis.fetch=originalFetch;}
});

test("Tasks marks capped data partial rather than claiming a complete total",async()=>{
  globalThis.fetch=async(input)=>{
    const url=new URL(input);
    if(url.pathname.endsWith("/@me/lists")) return json({items:[{id:"a",title:"A"}]});
    return json({items:Array.from({length:100},(_,i)=>({id:`${url.searchParams.get("pageToken")??"first"}-${i}`,title:`Fixture ${i}`})),nextPageToken:"more"});
  };
  try {const result=await adapter.listTasksWithCoverage();assert.equal(result.items.length,200);assert.equal(result.coverage.complete,false);assert.equal(result.coverage.reason,"item-cap");}
  finally {globalThis.fetch=originalFetch;}
});

test("Calendar access limited to primary is explicitly incomplete for planning",async()=>{
  globalThis.fetch=async(input)=>new URL(input).pathname.endsWith("/calendarList")?json({error:{message:"fixture permission"}},403):json({items:[]});
  try {const result=await adapter.listEventsBetweenWithCoverage(new Date("2027-01-01"),new Date("2027-01-02"),{});assert.equal(result.coverage.complete,false);}
  finally {globalThis.fetch=originalFetch;}
});

test("A calendar block uses a stable event ID and recovers a confirmed conflict",async()=>{
  const id="12345678-1234-4234-8234-123456789abc";
  const eventId=`da${id.replace(/-/g,"")}`;
  let creates=0;let persisted;
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input);
    if(options.method==="POST") {
      creates++;const body=JSON.parse(options.body);assert.equal(body.id,eventId);
      assert.equal(body.extendedProperties.private.workDashboardAgendaRequestId,id);
      if(persisted)return json({error:{message:"duplicate"}},409);
      persisted={id:eventId,extendedProperties:body.extendedProperties};return json(persisted);
    }
    assert.ok(url.pathname.endsWith(`/${eventId}`));return json(persisted);
  };
  try {
    const input={title:"Fixture",date:"2027-01-01",startTime:"09:00",endTime:"09:30",timeZone:"America/Los_Angeles"};
    assert.deepEqual(await adapter.createAgendaEvent(input,id),{id:eventId});
    assert.deepEqual(await adapter.createAgendaEvent(input,id),{id:eventId});
    assert.equal(creates,2);
    assert.deepEqual(await adapter.findAgendaEvent(id,new Date("2027-01-01")),{id:eventId});
  } finally {globalThis.fetch=originalFetch;}
});
