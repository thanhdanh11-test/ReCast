import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { createLocalServer, allowed } from "./local-server.mjs";

async function fixture(t, seeded = false) {
 const dir=fs.mkdtempSync(join(os.tmpdir(),"topeye-access-api-"));
 const staticDir=join(dir,"static"); fs.mkdirSync(staticDir);
 fs.writeFileSync(join(staticDir,"index.html"),"__TOPEYE_TOKEN__");
 const dataset=join(dir,"dataset"); fs.mkdirSync(dataset);
 fs.writeFileSync(join(dataset,"preview.jpg"),Buffer.from([0xff,0xd8,0xff,0xd9]));
 let calls=0, inspection=null;
 const host=createLocalServer({staticDir,userData:join(dir,"user"),catalogSeeds:seeded ? [{root:dataset,name:"Seed"}] : [],bridgeFactory:()=>({busy:false,stop:async()=>{},request:async(method,params)=>{
  calls++;
  if(inspection && method === "inspect_dataset") { inspection.started(); await inspection.gate; }
  if(params.dataset.endsWith("broken")) throw Object.assign(new Error("Missing clouds"),{code:"DATASET_INVALID"});
  return method==="inspect_dataset"?{root:params.dataset,version:"v1.0-mini",scenes:[{scene:"scene-1"}],regions:["Boston"],previewPath:"preview.jpg"}:{ok:true};
 }})});
 const url=`http://127.0.0.1:${await host.listen(0)}`;
 t.after(async()=>{await host.close(); fs.rmSync(dir,{recursive:true,force:true});});
 const headers={"X-Topeye-Token":host.token,"Content-Type":"application/json"};
 const post=(name,body={},extra={})=>fetch(url+"/api/"+name,{method:"POST",headers:{...headers,...extra},body:JSON.stringify(body)});
 const get=(name,extra={})=>fetch(url+"/api/"+name,{headers:{...headers,...extra}});
 const setup=async()=>{const r=await post("auth/setup",{username:"local-owner",password:"only-in-test-passphrase"});assert.equal(r.status,200);return r.headers.get("set-cookie").split(";")[0];};
 return {dir,dataset,host,url,post,get,setup,calls:()=>calls, holdInspection:()=>{
  let resume, started; const ready=new Promise(r=>started=r); const gate=new Promise(r=>resume=r);
  inspection={started,gate}; return {ready,resume};
 }};
}

test("all worker endpoints, catalog and events reject unauthenticated requests before worker runs",async t=>{
 const f=await fixture(t);
 for(const name of Object.keys(allowed))assert.equal((await f.post(name)).status,401,name);
 assert.equal((await f.get("catalog")).status,401);
 assert.equal((await f.get("catalog/preview/"+"a".repeat(24))).status,401);
 assert.equal((await f.get(`events?token=${f.host.token}`)).status,401);
 assert.equal(f.calls(),0);
});
test("setup requires per-run token and same origin; session response has no credential hash",async t=>{
 const f=await fixture(t);
 assert.equal((await f.post("auth/setup",{}, {"X-Topeye-Token":""})).status,403);
 assert.equal((await f.post("auth/setup",{}, {Origin:"https://evil.example"})).status,403);
 const cookie=await f.setup();
 const session=await(await f.get("auth/session",{Cookie:cookie})).json();
 assert.deepEqual(session.value,{configured:true,authenticated:true,username:"local-owner"});
 assert.equal((await f.post("settings",{},{Cookie:cookie})).status,200);
});
test("logout revokes existing session and SSE connection",async t=>{
 const f=await fixture(t); const Cookie=await f.setup();
 const stream=await f.get(`events?token=${f.host.token}`,{Cookie});
 assert.equal(stream.status,200);
 const reader=stream.body.getReader(); await reader.read();
 assert.equal((await f.post("auth/logout",{},{Cookie})).status,200);
 assert.equal((await reader.read()).done,true);
 assert.equal((await f.post("settings",{},{Cookie})).status,401);
});
test("valid imports persist; broken import preserves active dataset; previews cannot escape source",async t=>{
 const f=await fixture(t); const Cookie=await f.setup();
 const imported=await f.post("catalog/add",{path:f.dataset,name:"My map"},{Cookie});
 assert.equal(imported.status,200);
 const entry=(await imported.json()).value;
 assert.equal(entry.sceneCount,1);
 assert.equal((await f.post("catalog/select",{id:entry.id},{Cookie})).status,200);
 const before=fs.readFileSync(join(f.dir,"user/scenario-settings.json"),"utf8");
 const broken=join(f.dir,"broken");fs.mkdirSync(broken);
 assert.equal((await f.post("catalog/add",{path:broken},{Cookie})).status,400);
 assert.equal(fs.readFileSync(join(f.dir,"user/scenario-settings.json"),"utf8"),before);
 const list=(await(await f.get("catalog",{Cookie})).json()).value;
 assert.equal(list.length,1); assert.equal(list[0].name,"My map");
 assert.equal((await f.get("catalog/preview/"+entry.id,{Cookie})).status,200);
 const outside=join(f.dir,"private.jpg");fs.writeFileSync(outside,"private");
 fs.unlinkSync(join(f.dataset,"preview.jpg"));fs.symlinkSync(outside,join(f.dataset,"preview.jpg"));
 assert.equal((await f.get("catalog/preview/"+entry.id,{Cookie})).status,404);
 assert.equal((await f.post("catalog/select",{id:entry.id,path:"/etc"},{Cookie})).status,400);
});


test("logout during inspection prevents subsequent settings/catalog writes",async t=>{
 for(const method of ["chooseDataset","catalog/add"]) {
  const f=await fixture(t); const Cookie=await f.setup(); const held=f.holdInspection();
  const pending=f.post(method,{path:f.dataset},{Cookie}); await held.ready;
  await f.post("auth/logout",{},{Cookie}); held.resume();
  assert.equal((await pending).status,401);
  assert.equal(fs.existsSync(join(f.dir,"user/scenario-settings.json")),false);
  assert.equal(fs.existsSync(join(f.dir,"user/dataset-catalog.json")),false);
 }
});
test("logout during catalog initialization does not return dataset roots",async t=>{
 const f=await fixture(t,true); const Cookie=await f.setup(); const held=f.holdInspection();
 const pending=f.get("catalog",{Cookie}); await held.ready;
 await f.post("auth/logout",{},{Cookie}); held.resume();
 const response=await pending; assert.equal(response.status,401);
 assert.ok(!(await response.text()).includes(f.dataset));
});
test("partial request body completed after logout cannot create a workspace",async t=>{
 const http=await import("node:http");
 const f=await fixture(t); const Cookie=await f.setup(); const target=join(f.dir,"late-workspace");
 const body=JSON.stringify({path:target}); let request;
 const response=new Promise((resolve,reject)=>{
  request=http.request(f.url+"/api/chooseWorkspace",{method:"POST",headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body),"X-Topeye-Token":f.host.token,Cookie}},res=>{res.resume();resolve(res.statusCode);});
  request.on("error",reject);request.write(body.slice(0,-1));
 });
 await new Promise(r=>setTimeout(r,30));
 await f.post("auth/logout",{},{Cookie});request.end(body.slice(-1));
 assert.equal(await response,401);
 assert.equal(fs.existsSync(target),false);
 assert.equal(fs.existsSync(join(f.dir,"user/scenario-settings.json")),false);
});
