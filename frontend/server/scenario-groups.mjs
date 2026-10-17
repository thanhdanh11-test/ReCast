import fs from "node:fs";
import { join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const invalid = message => Object.assign(new Error(message), { code: "GROUP_METADATA_INVALID" });
const requireValue = (value, message) => { if (!value) throw invalid(message); };
const idOK = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const canonical = value => JSON.stringify(value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
function readJSON(path) { return JSON.parse(fs.readFileSync(path, "utf8")); }
function checkGroup(g) {
  requireValue(g && g.schema_version === 1 && idOK(g.id) && typeof g.scene === "string" && g.scene.length > 0 && typeof g.map_id === "string" && g.map_id.length > 0, "Nhóm so sánh không hợp lệ");
  requireValue((g.baseline_id === null || idOK(g.baseline_id)) && (g.pilot_id === null || idOK(g.pilot_id)) && (g.baseline_id || g.pilot_id) && g.baseline_id !== g.pilot_id, "ID biến thể không hợp lệ");
  requireValue(g.event && typeof g.event.actor_id === "string" && Number.isFinite(g.event.t0_s) && !('react' in g.event) && Number.isFinite(Date.parse(g.created_at)), "Sự kiện nhóm không hợp lệ");
  requireValue(Object.keys(g).every(k => ["schema_version","id","scene","map_id","event","baseline_id","pilot_id","created_at"].includes(k)), "Trường nhóm không được hỗ trợ");
}
function packageReport(workspace, id) {
  const dir = join(workspace,id,"import"), file = join(dir,"scenario.json"), manifestFile = join(dir,"manifest.json");
  requireValue(fs.existsSync(file), `Không tìm thấy gói ${id}`);
  const root = fs.realpathSync(workspace) + sep;
  requireValue(fs.realpathSync(file).startsWith(root) && fs.realpathSync(manifestFile).startsWith(root), "Đường dẫn gói không hợp lệ");
  const manifest = readJSON(manifestFile), scenario = readJSON(file);
  requireValue(manifest.scenario_id === id && scenario.id === id && manifest.kind === "real2sim", "Gói không phải biến thể phản ứng");
  requireValue(manifest.files?.['scenario.json'] === createHash('sha256').update(fs.readFileSync(file)).digest('hex'), "Hash gói không khớp");
  for(const [name,hash] of Object.entries(manifest.files??{})) {
    requireValue(/^[a-zA-Z0-9_.-]+$/.test(name),"Tên file trong manifest không hợp lệ");
    const filePath=join(dir,name);requireValue(!fs.lstatSync(filePath).isSymbolicLink() && fs.realpathSync(filePath).startsWith(root),"Đường dẫn payload không hợp lệ");
    requireValue(createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')===hash,"Hash payload không khớp");
  }
  requireValue(manifest.files?.['report.json'],"Gói thiếu báo cáo phản ứng");
  return {...scenario,report:readJSON(join(dir,'report.json'))};
}
export function scenarioGroups(workspace) {
  const path = join(resolve(workspace),".scenario-groups.json");
  try {
    if (!fs.existsSync(path)) return [];
    requireValue(!fs.lstatSync(path).isSymbolicLink(), "Metadata không được là symlink");
    requireValue(fs.statSync(path).size<=4*1024*1024,"Metadata nhóm quá lớn");
    const data = readJSON(path);
    requireValue(data.schema_version === 1 && Array.isArray(data.groups), "Schema nhóm không hỗ trợ");
    data.groups.forEach(checkGroup);
    requireValue(new Set(data.groups.map(g => g.id)).size === data.groups.length, "Trùng ID nhóm");
    return data.groups;
  } catch(e) { throw e.code === "GROUP_METADATA_INVALID" ? e : invalid("Không đọc được nhóm so sánh; dữ liệu gốc được giữ nguyên"); }
}
export function recordScenarioGroup(workspace, group) {
  try {
    checkGroup(group);
    const groups = scenarioGroups(workspace), previous = groups.find(g => g.id === group.id);
    if (previous) {
      requireValue(canonical({...previous,baseline_id:null,pilot_id:null}) === canonical({...group,baseline_id:null,pilot_id:null}), "Không được đổi sự kiện hoặc map của nhóm");
      for (const k of ['baseline_id','pilot_id']) requireValue(!previous[k] || previous[k] === group[k], "Không được thay biến thể đã lưu");
    }
    let event = null, reaction = null;
    for (const variant of ['baseline','pilot']) {
      const id = group[variant + '_id']; if (!id) continue;
      requireValue(!groups.some(g => g.id !== group.id && [g.baseline_id,g.pilot_id].includes(id)), "Gói đã thuộc một nhóm khác");
      const s = packageReport(workspace,id), r = s.report;
      requireValue(s.map_id === group.map_id && s.source?.scene === group.scene && r?.drivers?.react === (variant === 'pilot'), "Map/cảnh/biến thể không khớp");
      const binding=s.source?.reactive_event;
      requireValue(binding && binding.react===(variant==='pilot'),"Gói cũ chưa có liên kết sự kiện; giữ như gói riêng");
      const {react:_react,...frozen}=binding;
      requireValue(canonical(frozen)===canonical(group.event),"Sự kiện nguồn không khớp");
      const next = canonical(r.event);
      requireValue(event === null || event === next, "Hai gói không cùng sự kiện");
      requireValue(reaction === null || reaction === r.drivers.reaction_s, "Hai gói không cùng độ trễ");
      requireValue(r.event?.t0 === group.event.t0_s && r.drivers.reaction_s === group.event.reaction_s, "Thời điểm/độ trễ không khớp");
      const kind=group.event.kind??'brake';requireValue((r.event.kind??'brake')===kind,"Loại sự kiện không khớp");
      const fields=kind==='brake'?{decel_mps2:'decel',target:'target',dwell_s:'dwell'}:kind==='accelerate'?{target_mps:'target_mps',accel_mps2:'accel_mps2'}:kind==='stopline'?{dwell_s:'dwell_s'}:{direction:'direction',duration_s:'duration_s'};
      for(const [input,saved] of Object.entries(fields))requireValue(group.event[input]===r.event[saved],"Tham số sự kiện không khớp");
      event = next; reaction = r.drivers.reaction_s;
    }
    const next = groups.filter(g => g.id !== group.id).concat(group);
    const serialized=JSON.stringify({schema_version:1,groups:next});
    requireValue(Buffer.byteLength(serialized,'utf8')<=4*1024*1024,"Metadata nhóm quá lớn");
    fs.mkdirSync(workspace,{recursive:true});
    const path=join(workspace,'.scenario-groups.json'), temp=path+'.'+randomUUID()+'.tmp';
    try { fs.writeFileSync(temp,serialized,{flag:'wx',mode:0o600});fs.renameSync(temp,path); }
    finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
    return group;
  } catch(e) { throw e.code === "GROUP_METADATA_INVALID" ? e : invalid("Không ghi được nhóm so sánh; các gói đã tạo vẫn được giữ nguyên"); }
}
