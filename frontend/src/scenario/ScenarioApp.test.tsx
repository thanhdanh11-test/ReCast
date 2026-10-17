// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI } from "./types";
import {pkg as reactionPackageFixture} from "./reactive/fixtures";
vi.mock("./TrackView", async () => {
    const { useEffect } = await import("react");
    return {
        // Like the real view: reports ready after drawing each new scene.
        TrackView: ({environmentSettings, time, scenario, onReady}: {environmentSettings: {preset: string; quality: string}; time: number; scenario: unknown; onReady?: () => void}) => {
            // Counts scene builds like the real view's [scenario] effect (plan44: view switches must not rebuild).
            useEffect(() => { if (scenario) { (globalThis as {trackBuilds?: number}).trackBuilds = ((globalThis as {trackBuilds?: number}).trackBuilds ?? 0) + 1; onReady?.(); } }, [scenario]);
            return <div data-testid="viewport" data-preset={environmentSettings.preset} data-quality={environmentSettings.quality} data-time={time}/>;
        },
    };
});
const mock = {
    settings: vi.fn(),
    listScenes: vi.fn(),
    sourceScene: vi.fn(),
    onProgress: vi.fn(),
    chooseDataset: vi.fn(),
    chooseWorkspace: vi.fn(),
    extract: vi.fn(),
    export: vi.fn(),
    variant: vi.fn(),
    replay: vi.fn(),
    cancelJob: vi.fn(),
    mapContext: vi.fn(),
    exportMapContext: vi.fn(),
    importXosc: vi.fn(),
    importTemplate: vi.fn(),
    pickPackage: vi.fn(),
    importPackage: vi.fn(),
    reactiveCandidates: vi.fn(),
    importReactive: vi.fn(),
    reactiveSensitivity: vi.fn(),
    reactiveMetrics: vi.fn(),
    replayErrorMetrics: vi.fn(),
    esminiCheck: vi.fn(() => new Promise<never>(() => {})),
    templateFit: vi.fn(() => new Promise<never>(() => {})),
    openImported: vi.fn(),
    replayImported: vi.fn(),
    lidarFrame: vi.fn(),
    scenarioMetrics: vi.fn(() => new Promise<never>(() => {})),
    listImported: vi.fn(),
    readImported: vi.fn(),
    deleteImported: vi.fn(),
    deleteImportedRun: vi.fn(),
    storageInfo: vi.fn(async () => ({ workspace: '/w', scenarios: 2, scenarioBytes: 2048, metricsBytes: 512, trashBytes: 0, trashItems: 0 })),
    clearMetricsCache: vi.fn(async () => ({ removed: 2 })),
    emptyTrash: vi.fn(async () => ({ removed: 0 })),
    submitFeedback: vi.fn(async () => ({ id: 'x', saved_at: '2026-10-13T10:00:00Z' })),
    listFeedback: vi.fn(async () => []),
};
window.scenarioApp = mock as DesktopAPI;
const { default: ScenarioApp } = await import("./ScenarioApp");
// Dataset and workspace pickers live on the full "Cài đặt" page › "Dữ liệu & lưu trữ" (plan35).
// Panel titles/labels were removed in 0.18.0; the 3D panel exposes its state for tests.
const viewState = () => screen.getByRole("region", { name: "Mô phỏng 3D" }).getAttribute("data-view-state");
// 0.18.0: every control lives behind an icon-rail tool (drawer) or the OpenSCENARIO runner.
function tool(name: string) {
    const button = screen.getByRole("button", { name: new RegExp(`^${name}`) });
    // plan44: the rail marks the view on screen; "Cảnh nguồn" is pressed while its drawer may still be closed.
    const open = name === "Cảnh nguồn" ? !!screen.queryByRole("complementary", { name: "Cảnh nguồn" }) : button.getAttribute("aria-pressed") === "true";
    if (!open) fireEvent.click(button);
}
/** Both views stay mounted (plan44); the scene view's 3D stub lives in the "Mô phỏng 3D" region. */
const sceneViewport = () => document.querySelector('[aria-label="Mô phỏng 3D"] [data-testid="viewport"]')!;
function settingsSection(name: string) {
    tool("Cài đặt");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Mục cài đặt" })).getByRole("button", { name }));
}
function openDatasetPicker() {
    settingsSection("Dữ liệu & lưu trữ");
    fireEvent.click(screen.getByText("Chọn thư mục dữ liệu"));
    fireEvent.click(screen.getByRole("button", { name: "Quay lại" }));
}
beforeEach(() => {
    vi.clearAllMocks();
    mock.listImported.mockResolvedValue([]);
    mock.mapContext.mockResolvedValue({map_id:"sha256:test"});
    // One measured point (1 m ahead) in the backend's int16-centimetre encoding.
    mock.lidarFrame.mockResolvedValue({ scene: "scene-0061", sensor: "LIDAR_TOP", frame: "ego", time_s: 0, offset_s: 0, timestamp_us: 1, count: 1, range_m: 100,
        xyz_cm_b64: btoa(String.fromCharCode(100, 0, 0, 0, 0, 0)), intensity_b64: btoa(String.fromCharCode(7)) });
    mock.settings.mockResolvedValue({
        dataset: null,
        engineAvailable: true,
        version: "0.3.0",
        workspace: "/output",
    });
    mock.sourceScene.mockResolvedValue({
        id: "source",
        mode: "source",
        interval_s: [0, 19],
        actors: [],
        source: { scene: "scene-0103", selected_interval_s: [0, 19] },
        road: { kind: "source_map" },
    });
    mock.cancelJob.mockResolvedValue(true);
    mock.onProgress.mockReturnValue(() => { });
    mock.chooseDataset.mockResolvedValue({
        name: "nuScenes",
        version: "v1.0-mini",
        scenes: [
            {
                scene: "scene-0103",
                duration_s: 19,
                ego_start_s: 0,
                tracks: [
                    {
                        token: "abc",
                        category: "car",
                        start_s: 0,
                        end_s: 19,
                        distance_m: 100,
                        observations: 10,
                    },
                ],
            }
        ]
    });
    mock.listScenes.mockResolvedValue([
        {
            scene: "scene-0103",
            duration_s: 19,
            tracks: [
                {
                    token: "abc",
                    category: "vehicle.car",
                    start_s: 0,
                    end_s: 10,
                    distance_m: 20,
                    observations: 20,
                },
            ],
        },
    ]);
});
afterEach(cleanup);
describe("full scenario flow", () => {
    it("loads scenes through native picker into the source view", async () => {
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        expect(mock.sourceScene).toHaveBeenCalledWith({ scene: "scene-0103" });
        expect(viewState()).toBe("source");
    });
    it("allows cancelling an outstanding job from the top bar", async () => {
        mock.chooseDataset.mockImplementation(() => new Promise(() => { }));
        render(<ScenarioApp />);
        openDatasetPicker();
        expect(screen.getByTestId("busy-indicator").textContent).toContain("Đang mở dữ liệu");
        fireEvent.click(await screen.findByText("Huỷ tác vụ"));
        await waitFor(() => expect(screen.getByRole("status", { name: "Trạng thái tác vụ" }).textContent).toContain("Đã huỷ"));
        expect(mock.cancelJob).toHaveBeenCalledOnce();
        expect(screen.queryByTestId("busy-indicator")).toBeNull();
    });
});
describe("sensor workspace", () => {
    it("expands each panel to the full workspace and restores it with the button or Esc", async () => {
        render(<ScenarioApp />);
        const workspace = () => screen.getByRole("region", { name: "Mô phỏng 3D" }).parentElement!;
        for (const [label, cls] of [["khung 3D", "expanded-track"], ["khung LiDAR", "expanded-lidar"], ["khung map", "expanded-map"]]) {
            fireEvent.click(screen.getByRole("button", { name: `Phóng to ${label}` }));
            expect(workspace().className).toContain(cls);
            expect(screen.getByRole("button", { name: `Thu nhỏ ${label}` }).getAttribute("aria-pressed")).toBe("true");
            fireEvent.click(screen.getByRole("button", { name: `Thu nhỏ ${label}` }));
            expect(workspace().className).not.toContain("expanded");
        }
        fireEvent.click(screen.getByRole("button", { name: "Phóng to khung map" }));
        fireEvent.keyDown(window, { key: "Escape" });
        expect(workspace().className).not.toContain("expanded");
    });
    it("always shows the three views; the scene drawer is a plain list without extra controls", async () => {
        render(<ScenarioApp />);
        expect(screen.getByRole("region", { name: "Mô phỏng 3D" })).toBeTruthy();
        expect(screen.getByRole("region", { name: "LiDAR" })).toBeTruthy();
        expect(screen.getByRole("region", { name: "Map tích hợp" })).toBeTruthy();
        tool("Cảnh nguồn");
        expect(screen.queryByRole("checkbox", { name: "Hiển thị map tích hợp" })).toBeNull();
        expect(screen.queryByText("Xem cảnh gốc")).toBeNull();
        expect(screen.getByText(/Chưa có dữ liệu/)).toBeTruthy();
        expect(screen.queryByText(/CONF 98|65 KM|94%|SYNCED/)).toBeNull();
        await waitFor(() => expect(mock.settings).toHaveBeenCalled());
        await act(async () => {});
    });
});

describe("cancelled job ownership", () => {
    it("discards a source scene that resolves after cancellation", async () => {
        let finish!: (value: unknown) => void;
        mock.sourceScene.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        render(<ScenarioApp />);
        openDatasetPicker();
        fireEvent.click(await screen.findByText("Huỷ tác vụ"));
        await screen.findByText("Đã huỷ · tạo lại kịch bản để tiếp tục");
        await act(async () => { finish({ id: "late", mode: "source", interval_s: [0, 19], actors: [], source: { scene: "scene-0103" }, road: { kind: "source_map" } }); });
        expect(viewState()).toBe("empty");
        expect(screen.getByText("Đã huỷ · tạo lại kịch bản để tiếp tục")).toBeTruthy();
    });
});

const environment = {polygons:[{kind:'drivable_area',outer:[[-30,-30],[30,-30],[30,30],[-30,30]],holes:[]}],lines:[],buildings:[],trees:[],poles:[],warnings:[],provenance:[]};
const importedScenario = {id:'imported',mode:'imported',profile:'topeye-map-trajectories-v1',map_id:'sha256:test',interval_s:[0,2],source:{scene:'scene-0103',source_id:'source',origin_global_m:[0,0,0]},environment,import:{sha256:'hash',diagnostics:[]},actors:[{id:'ego',role:'ego',category:'vehicle.car',length_m:4,width_m:2,height_m:1.6,samples:[{t_s:0,x_m:0,y_m:0,z_m:0,yaw_rad:0,observed:false},{t_s:2,x_m:1,y_m:0,z_m:0,yaw_rad:0,observed:false}]}]};
importedScenario.actors.push({...importedScenario.actors[0],id:'car-new',role:'traffic',samples:importedScenario.actors[0].samples.map(p=>({...p,x_m:p.x_m+10,z_m:.8}))});
importedScenario.actors.push({...importedScenario.actors[0],id:'person-new',role:'traffic',category:'human.pedestrian.adult',length_m:.6,width_m:.5,height_m:1.8,samples:importedScenario.actors[0].samples.map(p=>({...p,x_m:5,y_m:p.t_s,z_m:.9}))});
const importedReplay = {path:'run',observed:importedScenario.actors.flatMap(a=>a.samples.map(p=>({...p,id:a.id,observed:true}))),report:{kind:'imported',execution:'pass',fidelity:{coverage:1,max_xy_m:.02,max_yaw_rad:.01},map_conformance:'pass',contacts:[{actors:['ego','person']}],warnings:['Tiếp xúc có thể có chủ ý']}};
const entry = (id: string, name: string, runs: unknown[] = []) => ({scenario_id:id,package_path:`/ws/${id}/import`,name,scene:'scene-0103',map_id:'sha256:test',actors:3,duration_s:2,created_at:'2026-10-12T10:00:00Z',runs});
async function openRunner() {
 mock.sourceScene.mockResolvedValue({...importedScenario,id:'source',mode:'source',import:undefined,actors:[importedScenario.actors[0]]});
 render(<ScenarioApp/>);
 // After picking a dataset the host reports it, which enables the workspace library.
 mock.settings.mockResolvedValue({dataset:'nuscenes',datasetVersion:'v1.0-mini',engineAvailable:true,version:'0.18.0',workspace:'/ws'});
 openDatasetPicker();
 await screen.findByText('Đã đọc 1 cảnh');
 fireEvent.click(screen.getByRole('button', {name:'Kịch bản'}));
 await screen.findByTestId('scenario-runner');
}
const runner = () => within(screen.getByTestId('scenario-runner'));
const createDialog = () => within(screen.getByRole('dialog',{name:'Tạo kịch bản'}));
describe('OpenSCENARIO runner',()=>{
 it('opens the create dialog even while a job is running',async()=>{
  await openRunner();
  mock.chooseDataset.mockImplementation(() => new Promise(() => {}));
  settingsSection('Dữ liệu & lưu trữ');
  fireEvent.click(screen.getByText('Đổi dữ liệu'));
  fireEvent.click(screen.getByRole('button',{name:'Quay lại'}));
  await screen.findByTestId('busy-indicator');
  fireEvent.click(screen.getByRole('button',{name:'Kịch bản'}));
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  expect(screen.getByRole('dialog',{name:'Tạo kịch bản'})).toBeTruthy();
  expect((createDialog().getByRole('button',{name:'Chọn file .xosc'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('always offers a red Tạo kịch bản button and no header buttons or checkboxes',async()=>{
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'one.xosc')]);
  await openRunner();
  await runner().findByText('one.xosc');
  const create = runner().getByRole('button',{name:'Tạo kịch bản'});
  expect(create.className).toContain('primary');
  expect((create as HTMLButtonElement).disabled).toBe(false);
  expect(runner().queryByRole('checkbox')).toBeNull();
  for (const name of ['Nạp file .xosc','Mở gói đã lưu','Xuất thông tin map']) expect(runner().queryByRole('button',{name})).toBeNull();
  for (const action of ['Xuất','Sửa','Xoá']) expect(runner().getByRole('button',{name:`${action} one.xosc`})).toBeTruthy();
 });
 it('creates a scenario from the dialog: picks the map, imports the file and opens it',async()=>{
  mock.importXosc.mockResolvedValue(importedScenario);
  mock.replayImported.mockResolvedValue(importedReplay);
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  expect((createDialog().getByRole('combobox',{name:'Map cho kịch bản'}) as HTMLSelectElement).value).toBe('scene-0103');
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn file .xosc'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.importXosc).toHaveBeenCalledWith({source_id:'source'});
  expect(mock.listImported).toHaveBeenCalled();
  expect(runner().getByText(/scene-0103 · topeye-map-trajectories-v1 · 3 đối tượng/)).toBeTruthy();
  // 0.20.1: the 2D map sits at the top of the report column; there is no esmini run block any more.
  expect(within(screen.getByRole('region',{name:'Cảnh và kết quả'})).getByTestId('map-view')).toBeTruthy();
  expect(document.querySelector('.runner-minimap')).toBeNull();
  expect(runner().queryByRole('button',{name:/Chạy (lại )?kịch bản này/})).toBeNull();
  expect(runner().queryByText('Chạy esmini')).toBeNull();
  fireEvent.click(runner().getByRole('tab',{name:'Số liệu'}));
  expect(runner().getByRole('cell',{name:'người đi bộ'})).toBeTruthy();
  const actorSlider = runner().getAllByRole('slider', {name:/Thời gian của/})[0];
  fireEvent.keyDown(actorSlider,{key:'Home'});
  fireEvent.keyDown(actorSlider,{key:'ArrowRight'});
  expect((screen.getByRole('slider',{name:document.querySelector('.scenario-workspace')?.closest('.view-pane')?.hasAttribute('hidden')===false?'Thời gian':'Thời gian mô phỏng'}) as HTMLInputElement).value).toBe('0.1');
  fireEvent.click(runner().getByRole('tab',{name:'Lịch sử'}));
  expect(runner().queryByRole('button',{name:'Tạo kịch bản'})).toBeNull();
  fireEvent.click(runner().getByRole('tab',{name:'Thư viện'}));
  expect(runner().getByRole('button',{name:'Tạo kịch bản'})).toBeTruthy();
  expect(mock.replayImported).not.toHaveBeenCalled();
  expect(mock.replay).not.toHaveBeenCalled();
 });
 it('keeps the dialog for a cancelled picker and escapes invalid XML diagnostics',async()=>{
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  mock.importXosc.mockResolvedValue(null);
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn file .xosc'}));
  await screen.findByText(/Đã đóng hộp chọn · giữ nguyên cảnh đang xem/);
  expect(screen.getByRole('dialog',{name:'Tạo kịch bản'})).toBeTruthy();
  mock.importXosc.mockRejectedValue(new Error('INVALID_XML: <img src=x onerror=alert(1)>'));
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn file .xosc'}));
  await screen.findByRole('alert');
  expect(document.querySelector('img[src=x]')).toBeNull();
  fireEvent.keyDown(window,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('imports a real2sim package folder on the scene of its report and shows the tool report instead of metrics (plan43)',async()=>{
  const report = {id:'car_013',scene:'scene-0103',source:'nuscenes-mini',valid:true,reasons:[],group:'close',
   event:{actor:'car_013',t0:1,decel:8,target:'stop',dwell:3},
   drivers:{react:true,reaction_s:1,thresholds:{},per_vehicle:{ego:{T:1.46,s0:2,max_decel:8}}},
   ego:{a_min:3.2,a_used:5.27,min_gap:1.751,min_ttc:1.1,conflict_with:'car_013',recorded_min_gap:10.335},
   reacted:['ego'],max_decel_used:{ego:5.27},physics:{ego:{max_speed:12.01,max_decel:5.1,t_decel:2.85,limit_decel:8.2}},gaps:{},collisions:[],
   esmini:{exit:0,version:'v3.9.0',problems:[],replay_error_m:{ego:{mean:0,max:0.0001}}},
   run:{created:'2026-10-14T15:23:15',commit:'a75ce6bb3f',dirty:false,esmini_version:'v3.9.0',dt:0.05,road:'map'}};
  const packaged = {...importedScenario,id:'e'.repeat(32),kind:'real2sim',profile:'real2sim-replay-v1',report,
   import:{sha256:'h',diagnostics:[{code:'MAP_NOTE_SURFACE',actor_id:'car-new',t_s:3.96,message:'car-new ra ngoài mặt đường lúc t=3.96s'}]}};
  mock.pickPackage.mockResolvedValue({files:[{name:'car_013.xosc',data_base64:'eA=='}],scene:'scene-0103',skipped:['scene-1077_map.xodr']});
  mock.importPackage.mockResolvedValue(packaged);
  mock.listImported.mockResolvedValue([{...entry('e'.repeat(32),'car_013.xosc'),kind:'real2sim',report:{valid:true,group:'close',event:report.event}}]);
  mock.scenarioMetrics.mockClear();
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Nạp gói real2sim'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.importPackage).toHaveBeenCalledWith({source_id:'source',files:[{name:'car_013.xosc',data_base64:'eA=='}]});
  await screen.findByText(/Đã nạp gói real2sim · 3 đối tượng · 1 ghi chú map/);
  expect(runner().getByText('1 ghi chú map')).toBeTruthy();
  expect(runner().queryByText('Đúng map')).toBeNull();
  expect((runner().getByRole('button',{name:'Sửa car_013.xosc'}) as HTMLButtonElement).disabled).toBe(true);
  expect(within(runner().getByLabelText('Thư viện kịch bản')).getByText('Hợp lệ')).toBeTruthy();
  fireEvent.click(runner().getByRole('tab',{name:'Số liệu'}));
  const panel = runner().getByLabelText('Báo cáo kịch bản real2sim');
  expect(within(panel).getByText('car_013 dừng hẳn · giảm tốc 8,0 m/s² lúc 1,0 s · đứng 3,0 s')).toBeTruthy();
  expect(within(panel).getByRole('cell',{name:'1,75 m'})).toBeTruthy();
  expect(within(panel).getByRole('cell',{name:'10,34 m'})).toBeTruthy();
  expect(within(panel).getByText('car-new ra ngoài mặt đường lúc t=3.96s')).toBeTruthy();
  expect(runner().queryByText('Kết quả lần chạy gần nhất')).toBeNull();
  expect(mock.scenarioMetrics).not.toHaveBeenCalled();
 });
 it('creates paired reactions in the single scenario tab and opens the selected result in 3D',async()=>{
  const c={scene:'scene-0103',duration_s:19,label_problems:[],candidates:[{actor_id:'a1',name:'car_154',category:'vehicle.car',max_decel_mps2:8,windows:[[0,10]],followers:['ego'],windows_by_event:{'stop:0:4':[[0,10]]}}]};
  mock.reactiveCandidates.mockResolvedValue(c);
  mock.importReactive.mockImplementation(async({event}:{event:{react:boolean}})=>({...reactionPackageFixture(),id:(event.react?'f':'e').repeat(32),source:{...reactionPackageFixture().source,scene:'scene-0103'},report:{...reactionPackageFixture().report!,drivers:{...reactionPackageFixture().report!.drivers!,react:event.react}}}));
  await openRunner();
  fireEvent.click(await screen.findByRole('button',{name:/^Xe phía trước phanh/}));
  fireEvent.click(screen.getByRole('button',{name:'Dùng xe này'}));
  fireEvent.click(screen.getByRole('button',{name:'Xem xe của tôi phản ứng'}));
  await screen.findByRole('button',{name:'Đặt cạnh nhau'});
  expect(mock.importReactive).toHaveBeenCalledTimes(2);
  const [base,pilot]=mock.importReactive.mock.calls.map(([arg])=>arg.event);expect(pilot).toEqual({...base,react:true});expect(base.react).toBe(false);
  expect(screen.queryByRole('button',{name:'Phản ứng'})).toBeNull();expect(screen.getByRole('button',{name:'Kịch bản'}).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'3D'}));expect(document.querySelector('.ud-stage [data-testid="viewport"]')).toBeTruthy();
 });
 it('keeps saved reactions when authoring again and only trashes an explicitly confirmed variant',async()=>{
  const c={scene:'scene-0103',duration_s:19,label_problems:[],candidates:[{actor_id:'a1',name:'car_154',category:'vehicle.car',max_decel_mps2:8,windows:[[0,10]],followers:['ego'],windows_by_event:{'stop:0:4':[[0,10]]}}]};
  mock.reactiveCandidates.mockResolvedValue(c);
  let rows:ReturnType<typeof entry>[]=[];
  mock.listImported.mockImplementation(async()=>rows);
  mock.importReactive.mockImplementation(async({event}:{event:{react:boolean}})=>{const id=(event.react?'f':'e').repeat(32);rows.push(entry(id,event.react?'pilot.xosc':'baseline.xosc'));return {...importedScenario,id,kind:'real2sim',report:null};});
  mock.deleteImported.mockImplementation(async({scenario_id}:{scenario_id:string})=>{rows=rows.filter(e=>e.scenario_id!==scenario_id);return {trash_path:'/ws/.trash/test'};});
  await openRunner();fireEvent.click(await screen.findByRole('button',{name:/^Xe phía trước phanh/}));fireEvent.click(screen.getByRole('button',{name:'Dùng xe này'}));fireEvent.click(screen.getByRole('button',{name:'Xem xe của tôi phản ứng'}));
  await screen.findByRole('button',{name:'Đặt cạnh nhau'});await runner().findByText('baseline.xosc');
  fireEvent.click(screen.getByRole('button',{name:'Thử phản ứng'}));
  expect(mock.deleteImported).not.toHaveBeenCalled();expect(rows).toHaveLength(2);
  vi.stubGlobal('confirm',vi.fn().mockReturnValue(true));fireEvent.click(runner().getByRole('button',{name:'Xoá baseline.xosc'}));
  await waitFor(()=>expect(mock.deleteImported).toHaveBeenCalledWith({scenario_id:'e'.repeat(32)}));expect(rows).toHaveLength(1);
 });
 it('creates a scenario from a template through the worker and opens it',async()=>{
  mock.importTemplate.mockResolvedValue(importedScenario);
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn loại Dừng khẩn cấp'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Tạo từ template'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.importTemplate).toHaveBeenCalledWith({source_id:'source', template: expect.objectContaining({scenario_type:'emergency_stop', map: expect.objectContaining({scene:'scene-0103'})})});
  expect(mock.listImported).toHaveBeenCalled();
  expect(runner().getByText(/scene-0103 · topeye-map-trajectories-v1 · 3 đối tượng/)).toBeTruthy();
 });
 it('keeps the dialog open and shows the worker error when a template is rejected',async()=>{
  mock.importTemplate.mockRejectedValue(new Error('OUTSIDE_SURFACE: “cutter” lúc 3.0 s đi ra ngoài mặt đường'));
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn loại Xe cắt làn'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Tạo từ template'}));
  expect((await screen.findByRole('alert', {}, {timeout: 2000})).textContent).toMatch(/ra ngoài mặt đường/);
  expect(screen.getByRole('dialog',{name:'Tạo kịch bản'})).toBeTruthy();
 });
 it('exports the map context for the chosen map from the dialog',async()=>{
  mock.exportMapContext.mockResolvedValue({path:'/context.json'});
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Tải thông tin map'}));
  await screen.findByText(/Đã xuất thông tin map: \/context.json/);
  expect(mock.exportMapContext).toHaveBeenCalledWith({source_id:'source'});
 });
 it('cancels an import without accepting a late result',async()=>{
  let finish!:(s:unknown)=>void;
  mock.importXosc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn file .xosc'}));
  fireEvent.click(await screen.findByText('Huỷ tác vụ'));
  await screen.findByText('Đã huỷ tác vụ');
  await act(async()=>{finish(importedScenario);});
  expect(runner().getByText('Chọn một kịch bản')).toBeTruthy();
 });
 it('confirms individual run removal and refreshes saved history',async()=>{
  const e=entry('a'.repeat(32),'history.xosc',[{run_id:'b'.repeat(32),at:'2026-10-13T10:00:00Z',status:'completed',execution:'pass',map_conformance:'pass'}]);
  mock.listImported.mockResolvedValue([e]); mock.deleteImportedRun.mockResolvedValue({trash_path:'/ws/.trash/run'});
  const confirm=vi.fn().mockReturnValue(false); vi.stubGlobal('confirm',confirm);
  await openRunner(); fireEvent.click(runner().getByRole('tab',{name:'Lịch sử'}));
  fireEvent.click(runner().getByRole('button',{name:/Xoá lần chạy/}));expect(mock.deleteImportedRun).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);mock.listImported.mockResolvedValue([{...e,runs:[]}]);
  fireEvent.click(runner().getByRole('button',{name:/Xoá lần chạy/}));
  await waitFor(()=>expect(mock.deleteImportedRun).toHaveBeenCalledWith({scenario_id:e.scenario_id,run_id:'b'.repeat(32)}));
  await runner().findByText('Chưa có lịch sử.');expect(mock.deleteImported).not.toHaveBeenCalled();vi.unstubAllGlobals();
 });
 it('lists the library with statuses and opens an entry by its saved path',async()=>{
  mock.listImported.mockResolvedValue([
   entry('a'.repeat(32),'cut-in-left.xosc',[{run_id:'r1',at:'2026-10-12T10:05:00Z',status:'completed',execution:'pass',map_conformance:'pass',max_xy_m:0}]),
   entry('b'.repeat(32),'hard-brake.xosc',[{run_id:'r2',at:'2026-10-12T10:06:00Z',status:'completed',execution:'fail',map_conformance:'pass',max_xy_m:.612}]),
   entry('c'.repeat(32),'night-merge.xosc'),
  ]);
  mock.openImported.mockResolvedValue(importedScenario);
  await openRunner();
  await runner().findByText('cut-in-left.xosc');
  expect(runner().getAllByText('Đạt').length).toBeGreaterThan(0);
  expect(runner().getByText('Không đạt')).toBeTruthy();
  expect(runner().getByText('Chưa chạy')).toBeTruthy();
  fireEvent.click(runner().getByText('hard-brake.xosc'));
  await waitFor(() => expect(mock.openImported).toHaveBeenCalledWith({source_id:'source',path:`/ws/${'b'.repeat(32)}/import`}));
  expect(runner().getAllByText('0,612 m').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('slider',{name:document.querySelector('.scenario-workspace')?.closest('.view-pane')?.hasAttribute('hidden')===false?'Thời gian':'Thời gian mô phỏng'}),{target:{value:'1'}});
  expect(document.querySelector('.ud-stage [data-testid="map-view"]')?.getAttribute('data-time')).toBe('1');
  fireEvent.click(runner().getByRole('tab',{name:'Lịch sử'}));
  const history = runner().getByRole('tabpanel',{name:'Lịch sử'});
  const rows = within(history).getAllByRole('row');
  expect(rows).toHaveLength(3);
  expect(rows[1].textContent).toContain('hard-brake.xosc');
  expect(rows[2].textContent).toContain('cut-in-left.xosc');
  expect(within(history).queryByText('night-merge.xosc')).toBeNull();
 });
 it('computes metrics of the opened scenario automatically, in the runner report, once',async()=>{
  mock.listImported.mockResolvedValue([entry('b'.repeat(32),'hard-brake.xosc')]);
  mock.openImported.mockResolvedValue(importedScenario);
  mock.scenarioMetrics.mockRejectedValueOnce(new Error('ENGINE_FAILED: esmini metrics run failed'));
  await openRunner();
  expect(mock.scenarioMetrics).not.toHaveBeenCalled();
  fireEvent.click(await runner().findByText('hard-brake.xosc'));
  await waitFor(() => expect(mock.scenarioMetrics).toHaveBeenCalledWith({scenario_id:'imported'}));
  await waitFor(() => expect(within(runner().getByLabelText('Chỉ số kịch bản')).getByText('esmini metrics run failed')).toBeTruthy());
  fireEvent.click(screen.getByRole('button',{name:'Cảnh nguồn'}));
  fireEvent.click(screen.getByRole('button',{name:'Kịch bản'}));
  await runner().findAllByText('hard-brake.xosc');
  // A failed computation is retried on return; one in flight (or done) is not started again.
  await waitFor(() => expect(mock.scenarioMetrics).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button',{name:'Cảnh nguồn'}));
  fireEvent.click(screen.getByRole('button',{name:'Kịch bản'}));
  await runner().findAllByText('hard-brake.xosc');
  expect(mock.scenarioMetrics).toHaveBeenCalledTimes(2);
 });
 it('receives pending metrics after leaving and returning to the same scenario',async()=>{
  let reject!: (reason: Error) => void;
  mock.scenarioMetrics.mockImplementation(()=>new Promise((_,fail)=>{reject=fail;}));
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'pending.xosc')]);
  mock.openImported.mockResolvedValue(importedScenario);
  await openRunner();fireEvent.click(await runner().findByText('pending.xosc'));
  await waitFor(()=>expect(mock.scenarioMetrics).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button',{name:'Cảnh nguồn'}));
  fireEvent.click(screen.getByRole('button',{name:'Kịch bản'}));
  await act(async()=>reject(new Error('pending request finished')));
  expect(within(runner().getByLabelText('Chỉ số kịch bản')).getByText('pending request finished')).toBeTruthy();
  expect(mock.scenarioMetrics).toHaveBeenCalledOnce();
 });
 it('exports an entry as its .xosc file',async()=>{
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'cut-in.xosc')]);
  mock.readImported.mockResolvedValue({scenario_id:'a'.repeat(32),name:'cut-in.xosc',file_name:'cut-in.xosc',xml:'<OpenSCENARIO/>'});
  const click = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  const blob = vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:x');
  await openRunner();
  fireEvent.click(await runner().findByRole('button',{name:'Xuất cut-in.xosc'}));
  await screen.findByText('Đã xuất cut-in.xosc (thư mục Tải về)');
  expect(mock.readImported).toHaveBeenCalledWith({scenario_id:'a'.repeat(32)});
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore(); blob.mockRestore();
 });
 it('edits the XML: saves as a validated new package and trashes the old one only on success',async()=>{
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'cut-in.xosc')]);
  mock.readImported.mockResolvedValue({scenario_id:'a'.repeat(32),name:'cut-in.xosc',file_name:'cut-in.xosc',xml:'<OpenSCENARIO>v1</OpenSCENARIO>'});
  mock.deleteImported.mockResolvedValue({trash_path:'/ws/.trash/x'});
  await openRunner();
  fireEvent.click(await runner().findByRole('button',{name:'Sửa cut-in.xosc'}));
  const dialog = within(await screen.findByRole('dialog',{name:'Sửa cut-in.xosc'}));
  // No template: code is hidden until the user asks for the advanced XML editor.
  expect(dialog.queryByRole('textbox',{name:'Nội dung OpenSCENARIO'})).toBeNull();
  fireEvent.click(dialog.getByRole('button',{name:'Sửa XML (nâng cao)'}));
  expect((dialog.getByRole('textbox',{name:'Nội dung OpenSCENARIO'}) as HTMLTextAreaElement).value).toBe('<OpenSCENARIO>v1</OpenSCENARIO>');
  fireEvent.change(dialog.getByRole('textbox',{name:'Nội dung OpenSCENARIO'}),{target:{value:'<OpenSCENARIO>v2</OpenSCENARIO>'}});
  fireEvent.change(dialog.getByRole('textbox',{name:'Tên kịch bản'}),{target:{value:'cut-in-v2.xosc'}});
  mock.importXosc.mockRejectedValueOnce(new Error('INVALID_PROFILE: thiếu ego'));
  fireEvent.click(dialog.getByRole('button',{name:'Lưu'}));
  await screen.findByRole('alert');
  expect(mock.deleteImported).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog',{name:'Sửa cut-in.xosc'})).toBeTruthy();
  mock.importXosc.mockResolvedValueOnce({...importedScenario,id:'d'.repeat(32)});
  fireEvent.click(dialog.getByRole('button',{name:'Lưu'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.importXosc).toHaveBeenLastCalledWith({source_id:'source',xml:'<OpenSCENARIO>v2</OpenSCENARIO>',file_name:'cut-in-v2.xosc'});
  expect(mock.deleteImported).toHaveBeenCalledWith({scenario_id:'a'.repeat(32)});
 });
 it('edits a template-made scenario in the template form, not as XML',async()=>{
  const { SCENARIO_TYPES, newTemplate } = await import('./authoring/catalog');
  const template = newTemplate(SCENARIO_TYPES.find(x => x.id === 'pedestrian_crossing')!, 'scene-0103', 'Người đi bộ');
  mock.listImported.mockResolvedValue([{...entry('a'.repeat(32),'Người_đi_bộ.xosc'), has_template:true}]);
  mock.readImported.mockResolvedValue({scenario_id:'a'.repeat(32),name:'Người_đi_bộ.xosc',file_name:'Người_đi_bộ.xosc',xml:'<OpenSCENARIO/>',template});
  mock.deleteImported.mockResolvedValue({trash_path:'/ws/.trash/x'});
  mock.importTemplate.mockResolvedValue({...importedScenario,id:'d'.repeat(32)});
  await openRunner();
  fireEvent.click(await runner().findByRole('button',{name:'Sửa Người_đi_bộ.xosc'}));
  const dialog = within(await screen.findByRole('dialog',{name:'Sửa Người_đi_bộ.xosc'}));
  expect(dialog.queryByRole('textbox',{name:'Nội dung OpenSCENARIO'})).toBeNull();
  expect((dialog.getByRole('slider',{name:'Vận tốc ego'}) as HTMLInputElement).value).toBe('40');
  fireEvent.change(dialog.getByRole('slider',{name:'Vận tốc ego'}),{target:{value:'30'}});
  fireEvent.click(dialog.getByRole('button',{name:'Thêm tình huống'}));
  fireEvent.click(dialog.getByRole('button',{name:'Lưu thay đổi'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.importTemplate).toHaveBeenCalledWith({source_id:'source',template:expect.objectContaining({params:expect.objectContaining({ego_kmh:30}),events:[expect.objectContaining({type:'hard_brake',actor:'ego'})]})});
  expect(mock.deleteImported).toHaveBeenCalledWith({scenario_id:'a'.repeat(32)});
 });
 it('recreates a scenario without template from the type gallery and replaces it',async()=>{
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'Dừng_khẩn_cấp.xosc')]);
  mock.readImported.mockResolvedValue({scenario_id:'a'.repeat(32),name:'Dừng_khẩn_cấp.xosc',file_name:'Dừng_khẩn_cấp.xosc',xml:'<OpenSCENARIO/>',template:null});
  mock.deleteImported.mockResolvedValue({trash_path:'/ws/.trash/x'});
  mock.importTemplate.mockResolvedValue({...importedScenario,id:'d'.repeat(32)});
  await openRunner();
  fireEvent.click(await runner().findByRole('button',{name:'Sửa Dừng_khẩn_cấp.xosc'}));
  fireEvent.click(within(await screen.findByRole('dialog',{name:'Sửa Dừng_khẩn_cấp.xosc'})).getByRole('button',{name:'Tạo lại bằng template'}));
  const dialog = within(screen.getByRole('dialog',{name:'Sửa Dừng_khẩn_cấp.xosc'}));
  expect((dialog.getByRole('combobox',{name:'Map cho kịch bản'}) as HTMLSelectElement).value).toBe('scene-0103');
  fireEvent.click(dialog.getByRole('button',{name:'Chọn loại Dừng khẩn cấp'}));
  fireEvent.click(dialog.getByRole('button',{name:'Lưu thay đổi'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(mock.importTemplate).toHaveBeenCalledWith({source_id:'source',template:expect.objectContaining({scenario_type:'emergency_stop'})});
  expect(mock.deleteImported).toHaveBeenCalledWith({scenario_id:'a'.repeat(32)});
 });
 it('switches views without rebuilding either 3D scene and marks the shown view on the rail (plan44)',async()=>{
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'one.xosc')]);
  mock.openImported.mockResolvedValue(importedScenario);
  await openRunner();
  fireEvent.click(await runner().findByRole('button',{name:/^one\.xosc/}));
  await waitFor(() => expect(runner().getByText(/scene-0103 · topeye-map-trajectories-v1 · 3 đối tượng/)).toBeTruthy());
  const rail = within(screen.getByRole('navigation',{name:'Công cụ'}));
  const pressed = () => ['Cảnh nguồn','Kịch bản'].map(n => rail.getByRole('button',{name:n}).getAttribute('aria-pressed'));
  expect(pressed()).toEqual(['false','true']);
  const builds = () => (globalThis as {trackBuilds?: number}).trackBuilds ?? 0;
  fireEvent.click(rail.getByRole('button',{name:'Cảnh nguồn'}));
  fireEvent.keyDown(window,{key:'Escape'});
  const settled = builds();
  expect(pressed()).toEqual(['true','false']);
  expect(screen.getByTestId('scenario-runner').closest('.view-pane')!.hasAttribute('hidden')).toBe(true);
  for (let i = 0; i < 3; i++) {
   fireEvent.click(rail.getByRole('button',{name:'Kịch bản'}));
   expect(runner().getByText(/scene-0103 · topeye-map-trajectories-v1 · 3 đối tượng/)).toBeTruthy();
   fireEvent.click(rail.getByRole('button',{name:'Cảnh nguồn'}));
   fireEvent.keyDown(window,{key:'Escape'});
  }
  expect(builds()).toBe(settled);
 });
 it('deletes only after confirmation',async()=>{
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'cut-in.xosc')]);
  mock.deleteImported.mockResolvedValue({trash_path:'/ws/.trash/x'});
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('confirm', confirm);
  await openRunner();
  fireEvent.click(await runner().findByRole('button',{name:'Xoá cut-in.xosc'}));
  expect(mock.deleteImported).not.toHaveBeenCalled();
  fireEvent.click(runner().getByRole('button',{name:'Xoá cut-in.xosc'}));
  await screen.findByText('Đã xoá cut-in.xosc');
  expect(mock.deleteImported).toHaveBeenCalledWith({scenario_id:'a'.repeat(32)});
  expect(confirm.mock.calls[0][0]).toContain('cut-in.xosc');
  vi.unstubAllGlobals();
 });
});

describe("switching between the runner and the scene view", () => {
 it("shows the loaded source scene (measured LiDAR) in the scene view and restores the runner scenario on return", async () => {
  mock.listImported.mockResolvedValue([entry('a'.repeat(32),'cut-in.xosc')]);
  mock.openImported.mockResolvedValue(importedScenario);
  mock.replayImported.mockResolvedValue(importedReplay);
  await openRunner();
  fireEvent.click(await runner().findByText('cut-in.xosc'));
  await runner().findByText(/topeye-map-trajectories-v1/);
  fireEvent.change(screen.getByRole('slider',{name:document.querySelector('.scenario-workspace')?.closest('.view-pane')?.hasAttribute('hidden')===false?'Thời gian':'Thời gian mô phỏng'}),{target:{value:'1'}});
  tool('Cảnh nguồn');
  expect(viewState()).toBe('source');
  expect(screen.getByTestId('lidar-view').getAttribute('data-mode')).toBe('measured');
  await waitFor(() => expect(mock.lidarFrame).toHaveBeenLastCalledWith({scene:'scene-0103',time_s:0}));
  expect(screen.getByRole('button',{name:/^scene-0103/}).getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'Kịch bản'}));
  expect(runner().getByText(/scene-0103 · topeye-map-trajectories-v1 · 3 đối tượng/)).toBeTruthy();
  expect(within(screen.getByRole('region',{name:'Cảnh và kết quả'})).getByTestId('map-view')).toBeTruthy();
  expect(mock.openImported).toHaveBeenCalledTimes(1);
 });
});

describe("environment session settings", () => {
 it("keeps time through settings changes; quality and theme persist, weather stays ClearNoon (plan35)", async () => {
  localStorage.clear();
  await openRunner();
  tool("Cảnh nguồn");
  fireEvent.change(screen.getByRole("slider", {name:"Thời gian mô phỏng"}), {target:{value:"1"}});
  tool("Cài đặt");
  expect(screen.queryByRole("combobox", {name:"Thời tiết CARLA 0.9.15"})).toBeNull();
  fireEvent.click(within(screen.getByRole("radiogroup", {name:"Chất lượng đồ hoạ"})).getByRole("radio", {name:"Cân bằng"}));
  fireEvent.click(within(screen.getByRole("radiogroup", {name:"Chế độ màu"})).getByRole("radio", {name:"Sáng"}));
  fireEvent.click(screen.getByRole("button", {name:"Quay lại"}));
  expect(sceneViewport().getAttribute("data-time")).toBe("1");
  expect(sceneViewport().getAttribute("data-preset")).toBe("ClearNoon");
  expect(document.querySelector(".studio")?.getAttribute("data-theme")).toBe("light");
  tool("Cảnh nguồn");
  fireEvent.click(screen.getByRole("button", {name:/^scene-0103/}));
  expect(sceneViewport().getAttribute("data-quality")).toBe("balanced");
  expect(JSON.parse(localStorage.getItem("topeye.preferences.v1")!)).toMatchObject({appearance:"light", quality:"balanced"});
  expect(mock.replay).not.toHaveBeenCalled();
  localStorage.clear();
 });
});

describe('static web demo shell', () => {
 beforeEach(() => {
  mock.settings.mockResolvedValue({mode:'web-demo', dataset:'nuScenes demo', datasetVersion:'v1.0-mini', workspace:'', engineAvailable:false, version:'0.12.4'});
  window.scenarioDemo = {demoVariants: () => []};
 });
 afterEach(() => { delete window.scenarioDemo; vi.unstubAllEnvs(); });
 it('loads without a picker and hides full-version-only actions, retaining shared views and credits', async () => {
  render(<ScenarioApp/>);
  await screen.findByText('Đã đọc 1 cảnh');
  for (const name of ['OpenSCENARIO','Góp ý']) expect(screen.queryByRole('button',{name})).toBeNull();
  tool('Cài đặt');
  const nav = within(screen.getByRole('navigation',{name:'Mục cài đặt'}));
  expect(nav.getByRole('button',{name:'Giao diện'})).toBeTruthy();
  for (const name of ['Dữ liệu & lưu trữ','Tài khoản']) expect(nav.queryByRole('button',{name})).toBeNull();
  tool('Cảnh nguồn');
  expect(screen.getByText('nuScenes © Motional, CC BY-NC-SA 4.0')).toBeTruthy();
  expect(screen.getByText('Nguồn mô hình xe')).toBeTruthy();
  expect(mock.chooseDataset).not.toHaveBeenCalled();
 });
 it('opens optional feedback with only the five context parameters and no API call', async () => {
  vi.stubEnv('VITE_FEEDBACK_URL','https://feedback.example/form?unrelated=discard');
  const open = vi.spyOn(window,'open').mockReturnValue(null);
  render(<ScenarioApp/>);
  await screen.findByText('Đã đọc 1 cảnh');
  fireEvent.change(screen.getByRole('slider',{name:document.querySelector('.scenario-workspace')?.closest('.view-pane')?.hasAttribute('hidden')===false?'Thời gian':'Thời gian mô phỏng'}),{target:{value:'1.26'}});
  const host = document.createElement('div'); host.dataset.cameraMode = 'cabin';
  screen.getByRole('region',{name:'Mô phỏng 3D'}).append(host);
  settingsSection('Góp ý nhà sản xuất');
  fireEvent.click(screen.getByRole('button',{name:'Mở biểu mẫu góp ý'}));
  const url = new URL(String(open.mock.calls[0][0]));
  expect(Object.fromEntries(url.searchParams)).toEqual({scene:'scene-0103',time:'1.3',camera:'cabin',weather:'ClearNoon',version:'0.12.4'});
  expect(open.mock.calls[0].slice(1)).toEqual(['_blank','noopener,noreferrer']);
  open.mockRestore();
 });
 it('allows retrying failed initial data loading', async () => {
  mock.listScenes.mockRejectedValueOnce(new Error('NETWORK: data/scenes.json'));
  render(<ScenarioApp/>);
  fireEvent.click(await screen.findByText('Thử lại'));
  await screen.findByText('Đã đọc 1 cảnh');
  expect(mock.listScenes).toHaveBeenCalledTimes(2);
 });
});

describe("scene list 0.19.1", () => {
    it("lists every scene, opens one on click and re-selecting returns to its original data", async () => {
        mock.chooseDataset.mockResolvedValue({ name: "nuScenes", version: "v1.0-mini", scenes: [
            { scene: "scene-0103", duration_s: 19.4, tracks: [] },
            { scene: "scene-0061", duration_s: 19.0, tracks: [{ token: "t", category: "vehicle.car", start_s: 0, end_s: 1, distance_m: 1, observations: 2 }] },
        ] });
        mock.sourceScene.mockImplementation(async ({ scene }: { scene: string }) => ({ id: `src-${scene}`, mode: "source", interval_s: [0, 19], actors: [], source: { scene }, road: { kind: "source_map" } }));
        render(<ScenarioApp />);
        mock.settings.mockResolvedValue({ dataset: "nuscenes", datasetVersion: "v1.0-mini", engineAvailable: true, version: "0.19.1", workspace: "/ws" });
        openDatasetPicker();
        await screen.findByText("Đã đọc 2 cảnh");
        tool("Cảnh nguồn");
        const list = within(screen.getByRole("list", { name: "Danh sách cảnh" }));
        expect(list.getAllByRole("button").map(b => b.querySelector("strong")!.textContent)).toEqual(["scene-0103", "scene-0061"]);
        expect(list.getByRole("button", { name: /^scene-0103/ }).getAttribute("aria-current")).toBe("true");
        expect(list.getByRole("button", { name: /scene-0061 19,0 s · 1 đối tượng/ })).toBeTruthy();
        fireEvent.click(list.getByRole("button", { name: /^scene-0061/ }));
        await waitFor(() => expect(mock.sourceScene).toHaveBeenLastCalledWith({ scene: "scene-0061" }));
        await waitFor(() => expect(list.getByRole("button", { name: /^scene-0061/ }).getAttribute("aria-current")).toBe("true"));
        const calls = mock.sourceScene.mock.calls.length;
        fireEvent.click(list.getByRole("button", { name: /^scene-0061/ }));
        expect(mock.sourceScene.mock.calls.length).toBe(calls);
        expect(viewState()).toBe("source");
    });
});

describe("loading overlay 0.21.1", () => {
    it("shows a spinner with “Đang tải dữ liệu” while a scene loads and hides it once drawn", async () => {
        let finish!: (value: unknown) => void;
        mock.sourceScene.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        render(<ScenarioApp />);
        openDatasetPicker();
        const overlay = await screen.findByTestId("loading-overlay");
        expect(overlay.textContent).toBe("Đang tải dữ liệu");
        await act(async () => { finish({ id: "s", mode: "source", interval_s: [0, 19], actors: [], source: { scene: "scene-0103" }, road: { kind: "source_map" } }); });
        await waitFor(() => expect(screen.queryByTestId("loading-overlay")).toBeNull());
        expect(viewState()).toBe("source");
    });
    it("does not leave the overlay up when loading fails", async () => {
        mock.sourceScene.mockRejectedValue(new Error("DATASET_INVALID: hỏng"));
        render(<ScenarioApp />);
        openDatasetPicker();
        await waitFor(() => expect(document.querySelector(".error-toast")).toBeTruthy());
        expect(screen.queryByTestId("loading-overlay")).toBeNull();
    });
});

describe("shell 0.18.0", () => {
    it("shows only the logo and name on top and no visible status bar", async () => {
        render(<ScenarioApp />);
        const header = document.querySelector(".studio-header")!;
        expect(header.textContent).toBe("Topeye");
        expect(screen.queryByText("Scenario Studio")).toBeNull();
        expect(screen.queryByText("Không gian mô phỏng")).toBeNull();
        expect(screen.getByRole("status", { name: "Trạng thái tác vụ" }).className).toBe("sr-only");
        await act(async () => {});
    });
    it("expands the rail from its top button and opens one tool drawer at a time, Esc closes", async () => {
        render(<ScenarioApp />);
        const rail = screen.getByRole("navigation", { name: "Công cụ" });
        expect(within(rail).getAllByRole("button")[0].getAttribute("aria-label")).toBe("Mở rộng thanh công cụ");
        fireEvent.click(screen.getByRole("button", { name: "Mở rộng thanh công cụ" }));
        expect(rail.className).toContain("wide");
        fireEvent.click(screen.getByRole("button", { name: "Thu gọn thanh công cụ" }));
        expect(rail.className).not.toContain("wide");
        tool("Cảnh nguồn");
        expect(screen.getByRole("complementary", { name: "Cảnh nguồn" })).toBeTruthy();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByRole("complementary")).toBeNull();
        tool("Cài đặt");
        expect(screen.getByRole("region", { name: "Cài đặt" })).toBeTruthy();
        expect(screen.queryByRole("region", { name: "Mô phỏng 3D" })).toBeNull(); // views hidden, still mounted
        expect(document.querySelector('[data-testid="viewport"]')).toBeTruthy();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByRole("region", { name: "Cài đặt" })).toBeNull();
        expect(screen.getByRole("region", { name: "Mô phỏng 3D" })).toBeTruthy();
        await act(async () => {});
    });
    it("keyboard shortcuts step, jump and play, but not while typing (plan35)", async () => {
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        const viewTime = () => sceneViewport().getAttribute("data-time");
        fireEvent.keyDown(window, { key: "ArrowRight" });
        expect(viewTime()).toBe("1");
        fireEvent.keyDown(screen.getByRole("slider", { name: "Thời gian mô phỏng" }), { key: "ArrowRight" });
        expect(viewTime()).toBe("1");
        fireEvent.keyDown(window, { key: "End" });
        expect(Number(viewTime())).toBeGreaterThan(1);
        fireEvent.keyDown(window, { key: "Home" });
        expect(viewTime()).toBe("0");
        fireEvent.keyDown(window, { key: " " });
        expect(screen.getByRole("button", { name: "Tạm dừng" })).toBeTruthy();
        fireEvent.keyDown(window, { key: " " });
        expect(screen.getByRole("button", { name: "Phát mô phỏng" })).toBeTruthy();
    });
    it("has no warnings rail tool; data warnings stay in the 3D chip (0.23.2)", async () => {
        mock.sourceScene.mockResolvedValue({ id: "source", mode: "source", interval_s: [0, 19], actors: [], source: { scene: "scene-0103" }, road: { kind: "source_map" }, environment: { ...environment, warnings: ["Thiếu LiDAR 2 mẫu"] } });
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        expect(screen.queryByRole("button", { name: /^Cảnh báo/ })).toBeNull();
        // The 3D view's warning chip is covered by trackViewWarnings.test.tsx.
    });
    it("settings page data section shows the dataset, save folder and storage", async () => {
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        settingsSection("Dữ liệu & lưu trữ");
        const page = within(screen.getByRole("region", { name: "Cài đặt" }));
        expect(page.getByRole("button", { name: /Đổi dữ liệu|Chọn thư mục dữ liệu/ })).toBeTruthy();
        expect(page.getByText("Thư mục lưu")).toBeTruthy();
        expect(await page.findByText("Bộ nhớ đệm chỉ số")).toBeTruthy();
    });
    it("has no extract, variant, verification or export tools (removed 0.19.0)", async () => {
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        for (const name of ["Trích đoạn", "Biến thể", "Kiểm chứng", "Xuất kịch bản"]) expect(screen.queryByRole("button", { name })).toBeNull();
        expect(screen.queryByTestId("timeline-clip")).toBeNull();
        expect(screen.getAllByRole("button").filter(b => b.closest(".icon-rail")).map(b => b.getAttribute("aria-label"))).toEqual(["Mở rộng thanh công cụ", "Cảnh nguồn", "Kịch bản", "Cài đặt"]);
    });
    it("shows errors in a dismissible toast", async () => {
        mock.sourceScene.mockRejectedValue(new Error("DATASET_INVALID: Thiếu bảng sample"));
        render(<ScenarioApp />);
        openDatasetPicker();
        await waitFor(() => expect(document.querySelector(".error-toast")?.textContent).toContain("Thiếu bảng sample"));
        fireEvent.click(screen.getByRole("button", { name: "Đóng thông báo lỗi" }));
        expect(document.querySelector(".error-toast")).toBeNull();
    });
});

it("opens guided authoring from mainweb for the selected scene and returns to source", async () => {
  mock.settings.mockResolvedValue({ dataset: "nuscenes", datasetVersion: "v1.0-mini", engineAvailable: true, version: "0.36.0", workspace: "/ws" });
  mock.reactiveCandidates.mockResolvedValue({ scene: "scene-0103", duration_s: 19, candidates: [], label_problems: [] });
  render(<ScenarioApp/>);
  const button = await screen.findByRole("button", { name: "Kịch bản" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByRole("heading", { name: "Kịch bản", level:1 });
  await screen.findAllByText("Chưa có xe phù hợp trong cảnh này");
  expect(mock.sourceScene).toHaveBeenLastCalledWith({ scene: "scene-0103" });
  expect(screen.getByRole("button", { name: "Chi tiết" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cảnh nguồn" }));
  await screen.findByRole("button", { name: "Kịch bản" });
  expect(screen.queryByRole("heading", { name: "Kịch bản",level:1 })).toBeNull();
});

it("uses demo buttons immediately when launched from the main catalog", async () => {
  mock.settings.mockResolvedValue({ dataset: "nuscenes", datasetVersion: "v1.0-mini", engineAvailable: true, version: "0.36.1", workspace: "/ws" });
  mock.reactiveCandidates.mockResolvedValue({ scene: "scene-0103", duration_s: 19, candidates: [], label_problems: [] });
  render(<ScenarioApp initialGuided/>);
  await screen.findByRole("heading", { name: "Kịch bản",level:1 });
  expect(screen.getByRole("button", { name: "Có hướng dẫn" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "Chi tiết" })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Công cụ" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cảnh nguồn" }));
  await screen.findByRole("button", { name: "Kịch bản" });
});
it("shows a recoverable boot failure instead of an endless pending screen",async()=>{
 mock.settings.mockResolvedValue({dataset:"mini",workspace:"/w",version:"test"});
 mock.listScenes.mockRejectedValueOnce(new Error("dataset temporarily unavailable"));
 render(<ScenarioApp initialGuided/>);
 const alert=await screen.findByRole("alert");expect(alert.textContent).toContain("dataset temporarily unavailable");
 expect(screen.queryByTestId("busy-indicator")).toBeNull();
 fireEvent.click(within(alert).getByRole("button",{name:"Thử lại"}));
 await waitFor(()=>expect(mock.sourceScene).toHaveBeenCalled());
 expect(screen.getByRole("heading",{name:"Kịch bản",level:1})).toBeTruthy();
});
it("ends loading with an explicit empty dataset state",async()=>{
 mock.settings.mockResolvedValue({dataset:"empty",workspace:"/w",version:"test"});mock.listScenes.mockResolvedValue([]);
 render(<ScenarioApp initialGuided/>);
 await screen.findByText("Chưa có cảnh trong dữ liệu",{selector:"p"});
 expect(screen.queryByTestId("busy-indicator")).toBeNull();expect(mock.sourceScene).not.toHaveBeenCalled();
 expect(screen.getByRole("button",{name:"Cài đặt"})).toHaveProperty("disabled",false);
});
it("greys out scenes with a rejected map in the scenario scene picker",async()=>{
 mock.settings.mockResolvedValue({dataset:"nuscenes",datasetVersion:"v1.0-mini",engineAvailable:true,version:"0.37.1",workspace:"/ws"});
 mock.listScenes.mockResolvedValue([{scene:"scene-0103",duration_s:19,tracks:[]},{scene:"scene-0061",duration_s:19,tracks:[]}]);
 mock.reactiveCandidates.mockResolvedValue({scene:"scene-0103",duration_s:19,candidates:[],label_problems:[]});
 const mapStatus=vi.fn(async()=>({"scene-0103":"Source polygon 8 (road_segment): Invalid map polygon","scene-0061":null}));
 (mock as {mapStatus?:typeof mapStatus}).mapStatus=mapStatus;
 try{
  render(<ScenarioApp initialGuided/>);
  const picker=await screen.findByRole("combobox",{name:"Cảnh đang chọn"});
  const bad=await within(picker).findByRole("option",{name:"scene-0103 · map lỗi, không tạo được kịch bản"}) as HTMLOptionElement;
  expect(bad.disabled).toBe(true);expect(bad.title).toContain("Invalid map polygon");
  expect((within(picker).getByRole("option",{name:"scene-0061"}) as HTMLOptionElement).disabled).toBe(false);
 }finally{delete (mock as {mapStatus?:unknown}).mapStatus;}
});
