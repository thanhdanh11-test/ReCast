// Shared-workspace recovery, settings and 20-scene classification on isolated real datasets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {createLocalServer} from '../server/local-server.mjs';
const out=resolve(process.argv[2]);fs.mkdirSync(out,{recursive:true});
const userData=fs.mkdtempSync(join(os.tmpdir(),'topeye-workspace-'));
fs.writeFileSync(join(userData,'scenario-settings.json'),JSON.stringify({workspace:join(userData,'workspace')}));
const host=createLocalServer({userData}),port=await host.listen(0);
const browser=await chromium.launch({channel:process.env.TOPEYE_BROWSER_CHANNEL||'chrome'});
const uiOnly=process.argv.includes('--ui-only');
const report={scenes:[],steps:[],errors:[],uiOnly};let page;
try{
 page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(`http://127.0.0.1:${port}`);
 await page.getByLabel('Tên đăng nhập',{exact:true}).fill('workspace-owner');await page.getByLabel('Mật khẩu',{exact:true}).fill('workspace-test-password');
 await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
 if(!uiOnly){for(const dataset of ['nuScenes mini','Argoverse 2 Sensor']){
  await page.getByRole('button',{name:`Mở ${dataset}`,exact:true}).click();
  await page.getByRole('combobox',{name:'Cảnh đang chọn'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-testid="busy-indicator"]'));
  // Direct preflight uses the same production adapter; final UI reload restores a source context afterwards.
  const scenes=await page.evaluate(async()=>{
   const rows=await window.scenarioApp.listScenes(),result=[];
   for(const row of rows){const source=await window.scenarioApp.sourceScene({scene:row.scene});try{await window.scenarioApp.mapContext({source_id:source.id});result.push({scene:row.scene,supported:true});}catch(e){result.push({scene:row.scene,supported:false,error:String(e)});}}
   return result;
  });report.scenes.push(...scenes.map(s=>({dataset,...s})));console.log(`${dataset}: ${scenes.length} scenes classified`);
  // v0.37.1: the scene picker greys out exactly the scenes the real map gate rejects.
  const picker=page.getByRole('combobox',{name:'Cảnh đang chọn'});
  const expected=scenes.filter(s=>!s.supported).map(s=>s.scene).sort();
  await page.waitForFunction(n=>document.querySelectorAll('select[aria-label="Cảnh đang chọn"] option:disabled').length===n,expected.length);
  const greyed=(await picker.locator('option:disabled').evaluateAll(o=>o.map(x=>x.value))).sort();
  assert.deepEqual(greyed,expected);report.steps.push(`${dataset} picker greyed ${JSON.stringify(greyed)}`);
  await page.getByRole('button',{name:'Thư viện map',exact:true}).click();
 }
 assert.equal(report.scenes.length,20);assert.equal(report.scenes.filter(s=>s.supported).length,18);}
 await page.getByRole('button',{name:'Mở nuScenes mini',exact:true}).click();
 await page.getByRole('combobox',{name:'Cảnh đang chọn'}).selectOption('scene-0061');
 await page.waitForFunction(()=>!document.querySelector('.ud-intents button')?.disabled);
 const rail=page.getByRole('navigation',{name:'Công cụ'});
 assert.deepEqual(await rail.locator('.rail-slot button').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label'))),['Cảnh nguồn','Kịch bản']);
 let sourceCalls=0;page.on('request',r=>{if(r.url().endsWith('/api/sourceScene'))sourceCalls++;});
 for(let i=0;i<3;i++){await page.getByRole('button',{name:'Cảnh nguồn',exact:true}).click();await page.getByRole('button',{name:'Kịch bản',exact:true}).click();}
 assert.equal(sourceCalls,0);report.steps.push('three route roundtrips reuse source; one Scenario rail entry');
 await page.route('**/api/reactiveCandidates',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({code:'INTERNAL',message:'injected candidate failure'})}));
 await page.getByRole('combobox',{name:'Cảnh đang chọn'}).selectOption('scene-0553');
 await page.getByText('injected candidate failure',{exact:false}).waitFor();
 assert.equal(await page.getByTestId('scenario-runner').count(),1);
 await page.unroute('**/api/reactiveCandidates');
 await page.locator('.ud-error').filter({hasText:'injected candidate failure'}).getByRole('button',{name:'Thử lại'}).click();
 await page.waitForFunction(()=>!document.querySelector('.ud-error')?.textContent.includes('injected candidate failure'));
 await page.waitForFunction(()=>document.querySelectorAll('.sw-actions button')[1]?.disabled===false,null,{timeout:180000});
 report.steps.push('candidate failure leaves library mounted and retries in place');
 await page.getByRole('button',{name:'Cài đặt',exact:true}).click();
 await page.getByRole('radio',{name:'Sáng',exact:true}).click();
 await page.getByRole('button',{name:'Ngôn ngữ',exact:true}).click();
 await page.getByRole('radio',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'Back',exact:true}).click();
 await page.getByRole('heading',{name:'Scenarios',exact:true,level:1}).waitFor();
 assert.equal(await page.locator('.studio').getAttribute('data-theme'),'light');
 await page.screenshot({path:join(out,'light-en-desktop.png')});
 for(const size of [{width:1050,height:720},{width:390,height:844}]){await page.setViewportSize(size);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(out,`light-en-${size.width}.png`),fullPage:true});}
 report.steps.push('English and light theme in same workspace; no document overflow at1440/1050/390');
 assert.deepEqual(report.errors,[]);report.pass=true;
}catch(e){report.failure=String(e);await page?.screenshot({path:join(out,'failure.png'),fullPage:true});throw e;}
finally{fs.writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));await browser.close();await host.close();fs.rmSync(userData,{recursive:true,force:true});}
console.log(JSON.stringify(report,null,2));
