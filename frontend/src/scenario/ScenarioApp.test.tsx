// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAPI } from "./types";
vi.mock("./TrackView", () => ({
    TrackView: ({environmentSettings, time}: {environmentSettings: {preset: string; quality: string}; time: number}) => <div data-testid="viewport" data-preset={environmentSettings.preset} data-quality={environmentSettings.quality} data-time={time}/>,
}));
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
};
window.scenarioApp = mock as DesktopAPI;
const { default: ScenarioApp } = await import("./ScenarioApp");
beforeEach(() => {
    vi.clearAllMocks();
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
describe("desktop scenario flow", () => {
    it("loads scenes through native picker and exposes extraction errors", async () => {
        mock.extract.mockRejectedValue(new Error("UNSUPPORTED_ROAD: Đường cong"));
        render(<ScenarioApp />);
        fireEvent.click(screen.getByText("Chọn thư mục nuScenes"));
        await screen.findByRole("option", { name: /scene-0103/ });
        fireEvent.click(screen.getByText("Trích đoạn thử nghiệm"));
        await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("UNSUPPORTED_ROAD"));
        expect(mock.extract).toHaveBeenCalledWith({
            scene: "scene-0103",
            actor_tokens: ["abc"],
            start_s: 3,
            end_s: 8,
        });
    });
    it("allows cancelling an outstanding job", async () => {
        mock.chooseDataset.mockImplementation(() => new Promise(() => { }));
        render(<ScenarioApp />);
        fireEvent.click(screen.getByText("Chọn thư mục nuScenes"));
        fireEvent.click(await screen.findByText("Huỷ tác vụ"));
        await waitFor(() => expect(screen.getByRole("status", { name: "Trạng thái tác vụ" }).textContent).toContain("Đã huỷ"));
        expect(mock.cancelJob).toHaveBeenCalledOnce();
    });
});
describe("sensor workspace", () => {
    it("contains only the requested views and toggles the map", async () => {
        render(<ScenarioApp />);
        expect(screen.getByRole("region", { name: "Mô phỏng 3D" })).toBeTruthy();
        expect(screen.getByRole("region", { name: "Mô phỏng LiDAR" })).toBeTruthy();
        expect(screen.getByRole("region", { name: "Map tích hợp" })).toBeTruthy();
        fireEvent.click(screen.getByRole("checkbox", { name: "Hiển thị map tích hợp" }));
        expect(screen.queryByRole("region", { name: "Map tích hợp" })).toBeNull();
        expect(screen.queryByText(/CONF 98|65 KM|94%|SYNCED/)).toBeNull();
        await waitFor(() => expect(mock.settings).toHaveBeenCalled());
        await act(async () => {});
        await act(async () => {});
  expect(screen.queryByText(/esmini sẵn sàng/)).toBeNull();
    });
    it("offers every track and enforces the three actor limit", async () => {
        const tracks = Array.from({ length: 10 }, (_, i) => ({ token: `token${i}`, category: "vehicle.car", start_s: 0, end_s: 19, distance_m: 20, observations: 20 }));
        mock.chooseDataset.mockResolvedValue({ scenes: [{ scene: "scene-test", duration_s: 19, tracks }] });
        render(<ScenarioApp />);
        fireEvent.click(screen.getByText("Chọn thư mục nuScenes"));
        const last = await screen.findByRole("checkbox", { name: "vehicle.car token9", hidden: true });
        fireEvent.click(last);
        fireEvent.click(screen.getByRole("checkbox", { name: "vehicle.car token8", hidden: true }));
        expect((screen.getByRole("checkbox", { name: "vehicle.car token7", hidden: true }) as HTMLInputElement).disabled).toBe(true);
        expect((last as HTMLInputElement).disabled).toBe(false);
        expect(screen.getByText("3/3 đối tượng")).toBeTruthy();
    });
});


describe("cancelled job ownership", () => {
    it("discards extraction results that resolve after cancellation", async () => {
        let finish!: (value: unknown) => void;
        mock.extract.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        render(<ScenarioApp />);
        fireEvent.click(screen.getByText("Chọn thư mục nuScenes"));
        await screen.findByRole("option", {name:/scene-0103/});
        fireEvent.click(screen.getByText("Trích đoạn thử nghiệm"));
        fireEvent.click(await screen.findByText("Huỷ tác vụ"));
        await screen.findByText("Đã huỷ · tạo lại kịch bản để tiếp tục");
        await act(async () => { finish({id:"late",interval_s:[0,2],actors:[],road:{kind:"synthetic"},source:{scene:"scene-0103",selected_interval_s:[0,2]}}); });
        expect((screen.getByRole("button", {name:"Chạy phát lại"}) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.queryByText("Đã trích quỹ đạo · sẵn sàng phát lại")).toBeNull();
        expect(screen.getByText("Đã huỷ · tạo lại kịch bản để tiếp tục")).toBeTruthy();
        expect((screen.getByText("Trích đoạn thử nghiệm") as HTMLButtonElement).disabled).toBe(false);
    });
});

const environment = {polygons:[{kind:'drivable_area',outer:[[-30,-30],[30,-30],[30,30],[-30,30]],holes:[]}],lines:[],buildings:[],trees:[],poles:[],warnings:[],provenance:[]};
const importedScenario = {id:'imported',mode:'imported',profile:'topeye-map-trajectories-v1',map_id:'sha256:test',interval_s:[0,2],source:{scene:'scene-0103',source_id:'source',origin_global_m:[0,0,0]},environment,import:{sha256:'hash',diagnostics:[]},actors:[{id:'ego',role:'ego',category:'vehicle.car',length_m:4,width_m:2,height_m:1.6,samples:[{t_s:0,x_m:0,y_m:0,z_m:0,yaw_rad:0,observed:false},{t_s:2,x_m:1,y_m:0,z_m:0,yaw_rad:0,observed:false}]}]};
importedScenario.actors.push({...importedScenario.actors[0],id:'car-new',role:'traffic',samples:importedScenario.actors[0].samples.map(p=>({...p,x_m:p.x_m+10,z_m:.8}))});
importedScenario.actors.push({...importedScenario.actors[0],id:'person-new',role:'traffic',category:'human.pedestrian.adult',length_m:.6,width_m:.5,height_m:1.8,samples:importedScenario.actors[0].samples.map(p=>({...p,x_m:5,y_m:p.t_s,z_m:.9}))});
async function loadMappedSource() {
 mock.sourceScene.mockResolvedValue({...importedScenario,id:'source',mode:'source',import:undefined,actors:[importedScenario.actors[0]]});
 render(<ScenarioApp/>);
 fireEvent.click(screen.getByText('Chọn thư mục nuScenes'));
 await screen.findByText('Đã đọc 1 cảnh');
 fireEvent.click(screen.getByRole('button', {name:'OpenSCENARIO'}));
}
describe('map-bound OpenSCENARIO',()=>{
 it('requires a real current source map before importing or exporting context',async()=>{
  render(<ScenarioApp/>);
  fireEvent.click(screen.getByRole('button', {name:'OpenSCENARIO'}));
  expect((screen.getByText('Nạp OpenSCENARIO') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Xuất thông tin map') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {});
  expect(screen.queryByText(/esmini sẵn sàng/)).toBeNull();
 });
 it('imports actors and keeps map, disables legacy export and renders measured report separately',async()=>{
  mock.importXosc.mockResolvedValue(importedScenario);
  mock.replayImported.mockResolvedValue({path:'run',observed:importedScenario.actors.flatMap(a=>a.samples.map(p=>({...p,id:a.id,observed:true}))),report:{kind:'imported',execution:'pass',fidelity:{coverage:1,max_xy_m:.02,max_yaw_rad:.01},map_conformance:'pass',contacts:[{actors:['ego','person']}],warnings:['Tiếp xúc có thể có chủ ý']}});
  await loadMappedSource();
  fireEvent.click(screen.getByText('Nạp OpenSCENARIO'));
  await screen.findByText('ĐÃ NẠP · XEM TRƯỚC');
  expect(mock.importXosc).toHaveBeenCalledWith({source_id:'source'});
  expect(screen.getByTestId('map-view')).toBeTruthy();
  expect(screen.getByText('3 đối tượng hiện tại · Bắc ↑')).toBeTruthy();
  expect(screen.getByText('human.pedestrian.adult · person-new')).toBeTruthy();
  expect((screen.getByText('Xuất kịch bản ↗') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByText('Tạo biến thể') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Chạy kịch bản đã nạp'));
  await screen.findByText('Thực thi: pass');
  expect(screen.getByText('Đang hiển thị kết quả đo thực từ esmini.')).toBeTruthy();
  expect(screen.queryByText('Quỹ đạo đã kiểm tra theo map. Xem trước chưa phải kết quả simulator.')).toBeNull();
  expect(screen.getByText(/Quan sát tiếp xúc: 1/)).toBeTruthy();
  expect(screen.getByText('0/0 đạt')).toBeTruthy();
  expect(mock.replay).not.toHaveBeenCalled();
  expect(screen.getByText('ESMINI · ĐÃ ĐO')).toBeTruthy();
  fireEvent.click(screen.getByText('Xem cảnh gốc'));
  expect(screen.getByText('DỮ LIỆU GỐC')).toBeTruthy();
  expect(screen.queryByText('Thực thi: pass')).toBeNull();
 });
 it('retains existing view for canceled picker and invalid XML with escaped diagnostics',async()=>{
  await loadMappedSource();
  mock.importXosc.mockResolvedValue(null);
  fireEvent.click(screen.getByText('Nạp OpenSCENARIO'));
  await screen.findByText('Đã đóng hộp chọn · giữ nguyên cảnh đang xem');
  expect(screen.getByText('DỮ LIỆU GỐC')).toBeTruthy();
  mock.importXosc.mockRejectedValue(new Error('INVALID_XML: <img src=x onerror=alert(1)>'));
  fireEvent.click(screen.getByText('Nạp OpenSCENARIO'));
  await screen.findByRole('alert');
  expect(screen.getByText('DỮ LIỆU GỐC')).toBeTruthy();
  expect(document.querySelector('img[src=x]')).toBeNull();
 });
 it('uses native reopen and resets imported timeline when source is selected',async()=>{
  mock.openImported.mockResolvedValue(importedScenario);
  await loadMappedSource();
  fireEvent.click(screen.getByText('Mở kịch bản đã lưu'));
  await screen.findByText('ĐÃ NẠP · XEM TRƯỚC');
  expect(mock.openImported).toHaveBeenCalledWith({source_id:'source'});
  fireEvent.change(screen.getByRole('slider',{name:'Thời gian mô phỏng'}),{target:{value:'1'}});
  expect(screen.getByTestId('map-view').getAttribute('data-time')).toBe('1');
  expect(screen.getByTestId('lidar-view').getAttribute('data-time')).toBe('1');
  fireEvent.click(screen.getByText('Xem cảnh gốc'));
  expect(screen.getByTestId('map-view').getAttribute('data-time')).toBe('0');
 });
 it('cancels an import and invalidates cleared worker handles without accepting late replacement',async()=>{
  let finish!:(s:unknown)=>void;
  mock.importXosc.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  await loadMappedSource();
  fireEvent.click(screen.getByText('Nạp OpenSCENARIO'));
  fireEvent.click(await screen.findByText('Huỷ tác vụ'));
  await screen.findByText('Đã huỷ · tạo lại kịch bản để tiếp tục');
  await act(async()=>{finish(importedScenario);});
  expect(screen.getByText('CHƯA CÓ CẢNH')).toBeTruthy();
  expect((screen.getByText('Nạp OpenSCENARIO') as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('ĐÃ NẠP · XEM TRƯỚC')).toBeNull();
 });
 it('exports map context via source identity independently of displayed import',async()=>{
  mock.importXosc.mockResolvedValue(importedScenario);
  mock.exportMapContext.mockResolvedValue({path:'/context.json'});
  await loadMappedSource();
  fireEvent.click(screen.getByText('Nạp OpenSCENARIO'));
  await screen.findByText('ĐÃ NẠP · XEM TRƯỚC');
  fireEvent.click(screen.getByText('Xuất thông tin map'));
  await screen.findByText('Đã xuất thông tin map: /context.json');
  expect(mock.exportMapContext).toHaveBeenCalledWith({source_id:'source'});
 });
});

describe("environment session settings", () => {
 it("preserves timestamp and preset through changing display settings and returning to source", async () => {
  await loadMappedSource();
  fireEvent.keyDown(document, {key:"Escape"});
  fireEvent.change(screen.getByRole("slider", {name:"Thời gian mô phỏng"}), {target:{value:"1"}});
  fireEvent.click(screen.getByRole("button", {name:"Môi trường"}));
  fireEvent.change(screen.getByRole("combobox", {name:"Thời tiết CARLA 0.9.15"}), {target:{value:"HardRainNight"}});
  expect(screen.getByTestId("viewport").getAttribute("data-time")).toBe("1");
  expect(screen.getByTestId("viewport").getAttribute("data-preset")).toBe("HardRainNight");
  fireEvent.change(screen.getByRole("combobox", {name:"Chất lượng 3D"}), {target:{value:"balanced"}});
  fireEvent.keyDown(document, {key:"Escape"});
  fireEvent.click(screen.getByText("Xem cảnh gốc"));
  expect(screen.getByTestId("viewport").getAttribute("data-preset")).toBe("HardRainNight");
  expect(screen.getByTestId("viewport").getAttribute("data-quality")).toBe("balanced");
  expect(mock.replay).not.toHaveBeenCalled();
 });
});
