// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI } from "./types";
vi.mock("./TrackView", async () => {
    const { useEffect } = await import("react");
    return {
        // Like the real view: reports ready after drawing each new scene.
        TrackView: ({environmentSettings, time, scenario, onReady}: {environmentSettings: {preset: string; quality: string}; time: number; scenario: unknown; onReady?: () => void}) => {
            useEffect(() => { if (scenario) onReady?.(); }, [scenario]);
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
    openImported: vi.fn(),
    replayImported: vi.fn(),
    lidarFrame: vi.fn(),
    scenarioMetrics: vi.fn(() => new Promise<never>(() => {})),
    listImported: vi.fn(),
    readImported: vi.fn(),
    deleteImported: vi.fn(),
};
window.scenarioApp = mock as DesktopAPI;
const { default: ScenarioApp } = await import("./ScenarioApp");
// Dataset and workspace pickers live in the "Cài đặt" rail drawer (0.23.2; was "Dữ liệu").
// Panel titles/labels were removed in 0.18.0; the 3D panel exposes its state for tests.
const viewState = () => screen.getByRole("region", { name: "Mô phỏng 3D" }).getAttribute("data-view-state");
// 0.18.0: every control lives behind an icon-rail tool (drawer) or the OpenSCENARIO runner.
function tool(name: string) {
    const button = screen.getByRole("button", { name: new RegExp(`^${name}`) });
    if (button.getAttribute("aria-pressed") !== "true") fireEvent.click(button);
}
function openDatasetPicker() {
    tool("Cài đặt");
    fireEvent.click(screen.getByText("Chọn thư mục dữ liệu"));
}
beforeEach(() => {
    vi.clearAllMocks();
    mock.listImported.mockResolvedValue([]);
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
 fireEvent.click(screen.getByRole('button', {name:'OpenSCENARIO'}));
 await screen.findByTestId('scenario-runner');
}
const runner = () => within(screen.getByTestId('scenario-runner'));
const createDialog = () => within(screen.getByRole('dialog',{name:'Tạo kịch bản'}));
describe('OpenSCENARIO runner',()=>{
 it('opens the create dialog even while a job is running',async()=>{
  await openRunner();
  mock.chooseDataset.mockImplementation(() => new Promise(() => {}));
  tool('Cài đặt');
  fireEvent.click(screen.getByText('Đổi dữ liệu'));
  await screen.findByTestId('busy-indicator');
  fireEvent.click(screen.getByRole('button',{name:'OpenSCENARIO'}));
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
  expect(within(runner().getByLabelText('Map 2D')).getByTestId('map-view')).toBeTruthy();
  expect(document.querySelector('.runner-minimap')).toBeNull();
  expect(runner().queryByRole('button',{name:/Chạy (lại )?kịch bản này/})).toBeNull();
  expect(runner().queryByText('Chạy esmini')).toBeNull();
  expect(runner().getByRole('cell',{name:'người đi bộ'})).toBeTruthy();
  expect(mock.replayImported).not.toHaveBeenCalled();
  expect(mock.replay).not.toHaveBeenCalled();
 });
 it('keeps the dialog for a cancelled picker and escapes invalid XML diagnostics',async()=>{
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  mock.importXosc.mockResolvedValue(null);
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn file .xosc'}));
  await screen.findByText('Đã đóng hộp chọn · giữ nguyên cảnh đang xem');
  expect(screen.getByRole('dialog',{name:'Tạo kịch bản'})).toBeTruthy();
  mock.importXosc.mockRejectedValue(new Error('INVALID_XML: <img src=x onerror=alert(1)>'));
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn file .xosc'}));
  await screen.findByRole('alert');
  expect(document.querySelector('img[src=x]')).toBeNull();
  fireEvent.keyDown(window,{key:'Escape'});
  expect(screen.queryByRole('dialog')).toBeNull();
 });
 it('exports the map context for the chosen map from the dialog',async()=>{
  mock.exportMapContext.mockResolvedValue({path:'/context.json'});
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Tải thông tin map'}));
  await screen.findByText('Đã xuất thông tin map: /context.json');
  expect(mock.exportMapContext).toHaveBeenCalledWith({source_id:'source'});
 });
 it('cancels an import without accepting a late result',async()=>{
  let finish!:(s:unknown)=>void;
  mock.importXosc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await openRunner();
  fireEvent.click(runner().getByRole('button',{name:'Tạo kịch bản'}));
  fireEvent.click(createDialog().getByRole('button',{name:'Chọn file .xosc'}));
  fireEvent.click(await screen.findByText('Huỷ tác vụ'));
  await screen.findByText('Đã huỷ · tạo lại kịch bản để tiếp tục');
  await act(async()=>{finish(importedScenario);});
  expect(runner().getByText('Chọn một kịch bản')).toBeTruthy();
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
  fireEvent.change(screen.getByRole('slider',{name:'Thời gian mô phỏng'}),{target:{value:'1'}});
  expect(runner().getByTestId('map-view').getAttribute('data-time')).toBe('1');
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
  fireEvent.click(screen.getByRole('button',{name:'OpenSCENARIO'}));
  await runner().findAllByText('hard-brake.xosc');
  // A failed computation is retried on return; one in flight (or done) is not started again.
  await waitFor(() => expect(mock.scenarioMetrics).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button',{name:'Cảnh nguồn'}));
  fireEvent.click(screen.getByRole('button',{name:'OpenSCENARIO'}));
  await runner().findAllByText('hard-brake.xosc');
  expect(mock.scenarioMetrics).toHaveBeenCalledTimes(2);
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
  fireEvent.change(screen.getByRole('slider',{name:'Thời gian mô phỏng'}),{target:{value:'1'}});
  tool('Cảnh nguồn');
  expect(viewState()).toBe('source');
  expect(screen.getByTestId('lidar-view').getAttribute('data-mode')).toBe('measured');
  await waitFor(() => expect(mock.lidarFrame).toHaveBeenLastCalledWith({scene:'scene-0103',time_s:0}));
  expect(screen.getByRole('button',{name:/^scene-0103/}).getAttribute('aria-current')).toBe('true');
  fireEvent.click(screen.getByRole('button',{name:'OpenSCENARIO'}));
  expect(runner().getByText(/scene-0103 · topeye-map-trajectories-v1 · 3 đối tượng/)).toBeTruthy();
  expect(within(runner().getByLabelText('Map 2D')).getByTestId('map-view')).toBeTruthy();
  expect(mock.openImported).toHaveBeenCalledTimes(1);
 });
});

describe("environment session settings", () => {
 it("keeps time through settings changes; quality and theme persist, weather stays ClearNoon (0.23.3)", async () => {
  localStorage.clear();
  await openRunner();
  tool("Cảnh nguồn");
  fireEvent.change(screen.getByRole("slider", {name:"Thời gian mô phỏng"}), {target:{value:"1"}});
  tool("Cài đặt");
  expect(screen.queryByRole("combobox", {name:"Thời tiết CARLA 0.9.15"})).toBeNull();
  fireEvent.change(screen.getByRole("combobox", {name:"Chất lượng đồ hoạ"}), {target:{value:"balanced"}});
  fireEvent.change(screen.getByRole("combobox", {name:"Giao diện"}), {target:{value:"light"}});
  expect(screen.getByTestId("viewport").getAttribute("data-time")).toBe("1");
  expect(screen.getByTestId("viewport").getAttribute("data-preset")).toBe("ClearNoon");
  expect(document.querySelector(".studio")?.getAttribute("data-theme")).toBe("light");
  tool("Cảnh nguồn");
  fireEvent.click(screen.getByRole("button", {name:/^scene-0103/}));
  expect(screen.getByTestId("viewport").getAttribute("data-quality")).toBe("balanced");
  expect(JSON.parse(localStorage.getItem("topeye.preferences.v1")!)).toEqual({appearance:"light", quality:"balanced"});
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
  expect(screen.getByRole('combobox',{name:'Giao diện'})).toBeTruthy();
  expect(screen.queryByText(/Đổi dữ liệu|Chọn thư mục dữ liệu|Thư mục lưu/)).toBeNull();
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
  fireEvent.change(screen.getByRole('slider',{name:'Thời gian mô phỏng'}),{target:{value:'1.26'}});
  const host = document.createElement('div'); host.dataset.cameraMode = 'cabin';
  screen.getByRole('region',{name:'Mô phỏng 3D'}).append(host);
  fireEvent.click(screen.getByRole('button',{name:'Góp ý'}));
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
        tool("Cài đặt");
        expect(screen.queryByRole("complementary", { name: "Cảnh nguồn" })).toBeNull();
        expect(screen.getByRole("complementary", { name: "Cài đặt" })).toBeTruthy();
        fireEvent.keyDown(window, { key: "Escape" });
        expect(screen.queryByRole("complementary")).toBeNull();
        await act(async () => {});
    });
    it("has no warnings rail tool; data warnings stay in the 3D chip (0.23.2)", async () => {
        mock.sourceScene.mockResolvedValue({ id: "source", mode: "source", interval_s: [0, 19], actors: [], source: { scene: "scene-0103" }, road: { kind: "source_map" }, environment: { ...environment, warnings: ["Thiếu LiDAR 2 mẫu"] } });
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        expect(screen.queryByRole("button", { name: /^Cảnh báo/ })).toBeNull();
        // The 3D view's warning chip is covered by trackViewWarnings.test.tsx.
    });
    it("settings drawer shows the dataset and save folder", async () => {
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        tool("Cài đặt");
        const drawer = within(screen.getByRole("complementary", { name: "Cài đặt" }));
        expect(drawer.getByRole("button", { name: /Đổi dữ liệu|Chọn thư mục dữ liệu/ })).toBeTruthy();
        expect(drawer.getByText("Thư mục lưu")).toBeTruthy();
    });
    it("has no extract, variant, verification or export tools (removed 0.19.0)", async () => {
        render(<ScenarioApp />);
        openDatasetPicker();
        await screen.findByText("Đã đọc 1 cảnh");
        for (const name of ["Trích đoạn", "Biến thể", "Kiểm chứng", "Xuất kịch bản"]) expect(screen.queryByRole("button", { name })).toBeNull();
        expect(screen.queryByTestId("timeline-clip")).toBeNull();
        expect(screen.getAllByRole("button").filter(b => b.closest(".icon-rail")).map(b => b.getAttribute("aria-label"))).toEqual(["Mở rộng thanh công cụ", "Cảnh nguồn", "OpenSCENARIO", "Cài đặt"]);
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
