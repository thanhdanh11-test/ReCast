// plan50 Scenario Studio on isolated real datasets: map gate of the scene list, rail, library recovery,
// CARLA / .xosc export end to end (zip contents + esmini on the .xosc + .xodr), nuScenes only, English + light theme.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {createLocalServer} from '../server/local-server.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const python=join(root,'backend/.venv/bin/python');
const engine=join(root,'backend/.tools/esmini/build/EnvironmentSimulator/Libraries/esminiLib/libesminiLib.dylib');
const out=resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const userData=fs.mkdtempSync(join(os.tmpdir(),'topeye-workspace-'));
fs.writeFileSync(join(userData,'scenario-settings.json'),JSON.stringify({workspace:join(userData,'workspace')}));
const host=createLocalServer({userData}),port=await host.listen(0);
const browser=await chromium.launch({channel:process.env.TOPEYE_BROWSER_CHANNEL||'chrome'});
const uiOnly=process.argv.includes('--ui-only');
const report={scenes:[],steps:[],errors:[],exports:{},uiOnly};let page;
const studio=()=>page.getByTestId('scenario-studio');
async function createGuidedPair(){
 await page.waitForFunction(()=>document.querySelector('.studio-create .create-scenario')?.disabled===false,null,{timeout:180000});
 await studio().getByRole('button',{name:'Tạo kịch bản'}).click();
 await studio().getByRole('menuitem',{name:/Tự tạo/}).click();
 // Candidates loaded ⇒ either a guided intent is offered, or every intent says no vehicle fits (no ego follower).
 await page.waitForFunction(()=>[...document.querySelectorAll('.ud-intents button')].some(b=>!b.disabled)||document.querySelectorAll('.ud-intents small').length===4,null,{timeout:180000});
 const guided=await page.locator('.ud-intents button:not([disabled])').count()>0;
 const pilot=page.waitForResponse(r=>r.url().endsWith('/api/importReactive')&&r.request().postDataJSON()?.event?.react===true,{timeout:300000});
 if(guided){
  await page.locator('.ud-intents button:not([disabled])').first().click();
  await page.getByRole('button',{name:'Dùng xe này'}).click();
  await page.getByRole('button',{name:'Xem xe của tôi phản ứng'}).click();
 }else{
  await page.getByRole('button',{name:'Chi tiết',exact:true}).click();
  const select=page.getByRole('combobox',{name:'Xe gây sự kiện'});
  await select.selectOption({index:1});
  await page.getByRole('button',{name:'Tiếp: chọn tình huống'}).click();
  await page.getByRole('button',{name:'Phanh',exact:true}).click();
  await page.getByRole('button',{name:'Chạy baseline và pilot'}).click();
 }
 assert.equal((await pilot).status(),200);
 await page.getByText('Đã lưu baseline và pilot vào lịch sử.').waitFor({timeout:120000});
 await page.locator('.studio-history-list li.active').waitFor({timeout:120000});
 return (await page.locator('.studio-history-list li.active strong').textContent()).trim();
}
async function exportRow(name,format){
 const row=page.locator('.studio-history-list li',{hasText:name}).first();
 await row.getByRole('button',{name:/^Lưu /}).click();
 const save=page.getByRole('dialog',{name:/^Lưu kịch bản/});
 const carlaDisabled=await save.getByRole('option',{name:'Xuất cho CARLA'}).evaluate(o=>o.disabled);
 if(format==='carla'&&carlaDisabled){await save.getByRole('button',{name:'Huỷ'}).click();return {carlaDisabled};}
 await save.getByRole('combobox',{name:'Định dạng xuất'}).selectOption(format);
 await save.getByRole('button',{name:'Xác nhận'}).click();
 await save.waitFor({state:'hidden'});
 return {carlaDisabled};
}
try{
 page=await browser.newPage({viewport:{width:1440,height:900},acceptDownloads:true});page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${port}`);
 await page.getByLabel('Tên đăng nhập',{exact:true}).fill('workspace-owner');await page.getByLabel('Mật khẩu',{exact:true}).fill('workspace-test-password');
 await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
 if(!uiOnly){for(const dataset of ['nuScenes mini']){
  await page.getByRole('button',{name:`Mở ${dataset}`,exact:true}).click();
  await studio().waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="busy-indicator"]'));
  // Direct preflight uses the same production adapter; final UI reload restores a source context afterwards.
  const scenes=await page.evaluate(async()=>{
   const rows=await window.scenarioApp.listScenes(),result=[];
   for(const row of rows){const source=await window.scenarioApp.sourceScene({scene:row.scene});try{await window.scenarioApp.mapContext({source_id:source.id});result.push({scene:row.scene,supported:true});}catch(e){result.push({scene:row.scene,supported:false,error:String(e)});}}
   return result;
  });report.scenes.push(...scenes.map(s=>({dataset,...s})));console.log(`${dataset}: ${scenes.length} scenes classified`);
  // v0.37.1/plan50: the Studio scene list greys out exactly the scenes the real map gate rejects, and never sits on one.
  const expected=scenes.filter(s=>!s.supported).map(s=>s.scene).sort();
  await page.waitForFunction(n=>document.querySelectorAll('.studio-scenes .scene-map-error').length===n,expected.length,{timeout:60000});
  const greyed=(await page.locator('.studio-scenes .scene-map-error strong').allTextContents()).sort();
  assert.deepEqual(greyed,expected);
  await page.waitForFunction(bad=>{const c=document.querySelector('.studio-scenes [aria-current="true"] strong')?.textContent;return !!c&&!bad.includes(c);},expected,{timeout:180000});
  const current=await page.locator('.studio-scenes [aria-current="true"] strong').textContent();
  report.steps.push(`${dataset} scene list greyed ${JSON.stringify(greyed)}; current ${current}`);
  await page.getByRole('button',{name:'Thư viện map',exact:true}).click();
 }
 assert.equal(report.scenes.length,10);assert.equal(report.scenes.filter(s=>s.supported).length,8);
 assert.equal(await page.getByRole('button',{name:'Mở Argoverse 2 Sensor',exact:true}).count(),0); // plan52: nuScenes only
 }
 await page.getByRole('button',{name:'Mở nuScenes mini',exact:true}).click();
 await studio().waitFor();
 await studio().getByRole('button',{name:/^scene-0061/}).click();
 await page.waitForFunction(()=>document.querySelector('.studio-scenes [aria-current="true"] strong')?.textContent==='scene-0061',null,{timeout:180000});
 const rail=page.getByRole('navigation',{name:'Công cụ'});
 assert.deepEqual(await rail.locator('.rail-slot button').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label'))),['Cảnh nguồn','Kịch bản','Đã xuất']);
 let sourceCalls=0;page.on('request',r=>{if(r.url().endsWith('/api/sourceScene'))sourceCalls++;});
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'Cảnh nguồn',exact:true}).click();await page.getByRole('button',{name:'Kịch bản',exact:true}).click();}
 assert.equal(sourceCalls,0);report.steps.push('three route roundtrips reuse source; rail = Cảnh nguồn · Kịch bản · Đã xuất');
 if(!uiOnly){
  // CARLA export of a real reaction pair: queue → Đã xuất 100 % → zip → files → esmini on the packaged .xosc + .xodr.
  const name=await createGuidedPair();
  await exportRow(name,'carla');
  await exportRow(name,'xosc');
  await page.getByRole('button',{name:'Đã xuất',exact:true}).click();
  await page.locator('.studio-exports-table tr[data-status="done"]',{hasText:'CARLA'}).first().waitFor({timeout:120000});
  await page.screenshot({path:join(out,'exports-page.png')});
  const carlaRow=page.locator('.studio-exports-table tr[data-status="done"]',{hasText:'CARLA'}).first();
  const [download]=await Promise.all([page.waitForEvent('download'),carlaRow.getByRole('link',{name:/^Tải về /}).click()]);
  const zip=join(out,download.suggestedFilename());await download.saveAs(zip);
  const unpacked=join(out,'carla-package');fs.rmSync(unpacked,{recursive:true,force:true});
  const check=spawnSync(python,['-c',`
import sys,zipfile,json,os
z=zipfile.ZipFile(sys.argv[1]);z.extractall(sys.argv[2]);names=sorted(z.namelist())
folder=os.path.join(sys.argv[2],os.path.dirname(names[0]))
xosc=[n for n in os.listdir(folder) if n.endswith('.xosc')][0]
from topeye.scenario.esmini_check import run
code,log=run(os.path.join(folder,xosc),sys.argv[3],6.0,sys.argv[2])
road=open(os.path.join(folder,xosc)).read().split('LogicFile filepath="')[1].split('"')[0]
print(json.dumps({'files':names,'esmini_exit':code,'objects':len(log),'logic_file':road,'xodr_present':os.path.isfile(os.path.join(folder,road))}))`,zip,unpacked,engine],{cwd:join(root,'backend'),env:{...process.env,PYTHONPATH:join(root,'backend')}});
  assert.equal(check.status,0,String(check.stderr));
  const carla=JSON.parse(String(check.stdout).trim().split('\n').at(-1));
  for(const part of ['.xosc','_map.xodr','/trajectories.csv','/report.json','/manifest.json'])assert.ok(carla.files.some(f=>f.endsWith(part)),`zip lacks ${part}`);
  assert.equal(carla.esmini_exit,0);assert.equal(carla.xodr_present,true);
  report.exports.carla=carla;
  report.steps.push(`CARLA package ${JSON.stringify(carla.files)}; esmini exit ${carla.esmini_exit} with ${carla.objects} objects`);
  // Delete one finished export: it leaves the page and lands in .trash; the scenario stays.
  const before=await page.locator('.studio-exports-table tbody tr').count();
  page.once('dialog',d=>d.accept());
  await page.locator('.studio-exports-table tr[data-status="done"]',{hasText:'.xosc'}).first().getByRole('button',{name:/^Xoá bản xuất /}).click();
  await page.waitForFunction(n=>document.querySelectorAll('.studio-exports-table tbody tr').length===n-1,before);
  assert.ok(fs.readdirSync(join(userData,'workspace','.trash')).some(n=>n.startsWith('export-')));
  report.steps.push('export deleted into .trash; scenario library untouched');
  await page.getByRole('button',{name:'Kịch bản',exact:true}).click();
 }
 // Library failure stays in the history column with a retry; the rest of the Studio keeps working.
 await page.route('**/api/listImported',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'INTERNAL',message:'injected library failure'})}));
 await studio().getByRole('button',{name:/^scene-0553/}).click();
 await page.locator('.studio-history .studio-inline-error').waitFor({timeout:180000});
 assert.equal(await studio().getByRole('region',{name:'Xem kịch bản'}).count(),1);
 await page.unroute('**/api/listImported');
 // A later refresh (scene load) may already have recovered it; otherwise the in-place retry does.
 const retry=page.locator('.studio-history .studio-inline-error button');
 if(await retry.count())await retry.click({timeout:5000}).catch(()=>{});
 await page.locator('.studio-history .studio-inline-error').waitFor({state:'detached',timeout:60000});
 report.steps.push('library failure is shown in the history column and retried in place');
 await page.getByRole('button',{name:'Cài đặt',exact:true}).click();
 await page.getByRole('radio',{name:'Sáng',exact:true}).click();
 await page.getByRole('button',{name:'Ngôn ngữ',exact:true}).click();
 await page.getByRole('radio',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await studio().getByRole('button',{name:'Create scenario'}).waitFor();
 await studio().getByRole('complementary',{name:'Scenario history'}).waitFor();
 assert.equal(await page.locator('.studio').getAttribute('data-theme'),'light');
 await page.screenshot({path:join(out,'light-en-desktop.png')});
 for(const size of [{width:1050,height:720},{width:390,height:844}]){await page.setViewportSize(size);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(out,`light-en-${size.width}.png`),fullPage:true});}
 report.steps.push('English and light theme in the Studio; no document overflow at1440/1050/390');
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(e){report.failure=String(e);await page?.screenshot({path:join(out,'failure.png'),fullPage:true});throw e;}
finally{fs.writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));await browser.close();await host.close();fs.rmSync(userData,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
