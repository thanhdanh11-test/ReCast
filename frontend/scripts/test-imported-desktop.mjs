import {_electron} from 'playwright-core';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const [executable,datasetArg,evidenceArg]=process.argv.slice(2);
const dataset=resolve(datasetArg),evidence=resolve(evidenceArg);
mkdirSync(evidence,{recursive:true});
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const profile=mkdtempSync(join(tmpdir(),'topeye-imported-profile-'));
const workspace=mkdtempSync(join(tmpdir(),'topeye-imported-workspace-'));
const contextFile=join(evidence,'map-context.json'),fixture=join(evidence,'generated.xosc');
const hashes=()=>Object.fromEntries(readdirSync(join(dataset,'v1.0-mini')).filter(f=>f.endsWith('.json')).map(f=>[f,createHash('sha256').update(readFileSync(join(dataset,'v1.0-mini',f))).digest('hex')]));
const before=hashes();
const app=await _electron.launch({executablePath:resolve(executable),args:['--user-data-dir='+profile],cwd:tmpdir(),env:{...process.env,PATH:'/usr/bin:/bin',PYTHONPATH:'',ELECTRON_RUN_AS_NODE:''},timeout:30000});
let result;const errors=[];let owned=[];
try {
 const page=await app.firstWindow();page.setDefaultTimeout(120000);
 await app.evaluate(({app},isolated)=>app.setPath("userData",isolated),profile);
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.locator('.studio').waitFor();
 const pick=async path=>app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},path);
 await pick(workspace);await page.getByRole('button',{name:'Thư mục lưu',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã cập nhật nơi lưu'}).waitFor();
 await pick(dataset);await page.locator('.dataset-button').click();await page.locator('.scene3d').waitFor();
 await page.getByLabel('Cảnh đang xem',{exact:true}).selectOption('scene-0061');await page.locator('.studio-status').filter({hasText:'Cảnh gốc:'}).waitFor();
 await app.evaluate(({dialog},p)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:p});},contextFile);
 if(await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).getAttribute('aria-expanded')!=='true') await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).click();await page.getByRole('button',{name:'Xuất thông tin map',exact:true}).click();
 await page.locator('.studio-status').filter({hasText:/Đã xuất|thông tin map/}).waitFor();
 // Wait for actual exported file completion, not a matching progress label.
 await page.waitForFunction(()=>!document.querySelector('.studio-status').textContent.includes('◌'));
 const context=JSON.parse(readFileSync(contextFile));assert(context.map_id.startsWith('sha256:'));assert.equal(context.profile,'topeye-map-trajectories-v1');
 execFileSync(join(repo,'backend/.venv/bin/python'),[join(repo,'backend/scripts/generate_map_scenario_fixture.py'),contextFile,fixture],{cwd:repo,timeout:120000});
 // Dialog cancellation and rejected input must retain source view.
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 if(await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).getAttribute('aria-expanded')!=='true') await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).click();await page.getByRole('button',{name:'Nạp OpenSCENARIO',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.studio-status').textContent.includes('◌'));
 assert.equal(await page.locator('.scene3d').getAttribute('data-source'),'source');
 const bad=join(evidence,'wrong-map.xosc');writeFileSync(bad,readFileSync(fixture,'utf8').replaceAll(context.map_id,'sha256:'+'0'.repeat(64)));
 await pick(bad);if(await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).getAttribute('aria-expanded')!=='true') await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).click();await page.getByRole('button',{name:'Nạp OpenSCENARIO',exact:true}).click();await page.getByRole('alert').filter({hasText:'MAP_MISMATCH'}).waitFor();assert.equal(await page.locator('.scene3d').getAttribute('data-source'),'source');
 await pick(fixture);if(await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).getAttribute('aria-expanded')!=='true') await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).click();await page.getByRole('button',{name:'Nạp OpenSCENARIO',exact:true}).click();await page.locator('.studio-status').filter({hasText:'Đã nạp OpenSCENARIO'}).waitFor();
 assert.equal(await page.locator('.scene3d').getAttribute('data-source'),'preview');
 assert(await page.locator('[data-testid=map-view]').count()===1);
 await page.getByRole('button',{name:'Chạy kịch bản đã nạp',exact:true}).click();await page.locator('.studio-status').filter({hasText:/Đã lưu kết quả phát lại/}).waitFor();await page.waitForFunction(()=>!document.querySelector('.studio-status').textContent.includes('◌'));
 assert.equal(await page.getByText('Đang hiển thị kết quả đo thực từ esmini.',{exact:true}).count(),1);
 assert.equal(await page.getByText('Quỹ đạo đã kiểm tra theo map. Xem trước chưa phải kết quả simulator.',{exact:true}).count(),0);
 const ids=readdirSync(workspace).filter(n=>/^[a-f0-9]{32}$/.test(n));assert.equal(ids.length,1);const packagePath=join(workspace,ids[0],'import');
 const run=readdirSync(join(workspace,ids[0],'runs'))[0];const runPath=join(workspace,ids[0],'runs',run);
 const report=JSON.parse(readFileSync(join(runPath,'report.json')));assert.equal(report.kind,'imported');assert.equal(report.execution,'pass');assert.equal(report.map_conformance,'pass');assert.equal(report.fidelity.coverage,1);assert(report.fidelity.max_xy_m<=.10);
 await page.getByRole('slider',{name:'Thời gian mô phỏng'}).fill('1');
 const screens=[];
 for(const [width,height] of [[1360,900],[1050,720]]) {
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),[width,height]);
  assert(await page.evaluate(()=>document.querySelector('.studio').scrollWidth<=document.querySelector('.studio').clientWidth));
  await page.locator('.workflow').evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:join(evidence,`imported-${width}.png`)});screens.push([width,height]);
 }
 await page.getByRole('button',{name:'Xem cảnh gốc',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.scene3d')?.dataset.source==='source');
 await pick(packagePath);if(await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).getAttribute('aria-expanded')!=='true') await page.getByRole('button',{name:'OpenSCENARIO',exact:true}).click();await page.getByRole('button',{name:'Mở kịch bản đã lưu',exact:true}).click();await page.locator('.studio-status').filter({hasText:'Đã nạp OpenSCENARIO'}).waitFor();
 assert.equal(await page.locator('.scene3d').getAttribute('data-source'),'preview');
 const ipc=await page.evaluate(async()=>{
  const api=window.scenarioApp;
  try {await api.importXosc({source_id:'0'.repeat(32),path:'/etc/passwd'});return 'unexpected';}catch(e){return String(e);}
 });assert(ipc.includes('INVALID_INPUT'));
 const cancelResults=await page.evaluate(async scenario_id=>Promise.allSettled([
  window.scenarioApp.replayImported({scenario_id}),window.scenarioApp.cancelJob()
 ]).then(rs=>rs.map(r=>({status:r.status,message:r.status==='rejected'?String(r.reason):''}))),ids[0]);
 assert.equal(cancelResults[0].status,'rejected');assert.equal(cancelResults[1].status,'fulfilled');
 await page.evaluate(()=>window.scenarioApp.listScenes());
 const reopenedFresh=await page.evaluate(async()=>{
  const api=window.scenarioApp;
  const source=await api.sourceScene({scene:'scene-0061'});
  const context=await api.mapContext({source_id:source.id});
  const reopened=await api.openImported({source_id:source.id});
  return {map_id:context.map_id,id:reopened.id};
 });
 assert.equal(reopenedFresh.map_id,context.map_id);assert.equal(reopenedFresh.id,ids[0]);
 const statuses=readdirSync(join(workspace,ids[0],'runs')).map(r=>JSON.parse(readFileSync(join(workspace,ids[0],'runs',r,'status.json'))).status);
 assert(!statuses.includes('running'));
 const prefix=join(dirname(dirname(resolve(executable))),'Resources','worker');
 owned=execFileSync('/bin/ps',['-ax','-o','pid=,ppid=,command='],{encoding:'utf8'}).split('\n').filter(row=>row.includes(prefix)&&Number(row.trim().split(/\s+/)[1])===app.process().pid).map(row=>Number(row.trim().split(/\s+/)[0]));
 assert(owned.length>=1);
 assert.deepEqual(hashes(),before);assert.deepEqual(errors,[]);
 result={report,workspace,packagePath,cancelResults,statuses,owned,reopenedFresh,map_id:context.map_id,sourceFilesUnchanged:Object.keys(before).length,rendererErrors:errors,screens,ipcRejected:true,canceledDialogKeptSource:true,wrongMapRejected:true,reopened:true};
} finally {await app.close();}
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
const end=Date.now()+12000;
while(owned.some(alive)&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
assert(owned.every(pid=>!alive(pid)));result.ownedChildrenGone=true;
writeFileSync(join(evidence,'desktop-imported.json'),JSON.stringify(result,null,2));console.log('Packaged imported map-bound XOSC desktop acceptance: PASS');
