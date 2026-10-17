// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DesktopAPI, ImportedScenario, ReactiveEvent } from "../types";
import { candidates, pkg, source } from "../reactive/fixtures";
import { UnifiedScenarioDemo } from "./UnifiedScenarioDemo";
vi.mock("../TacticalMap", () => ({ TacticalMap: ({ scenario, time, onPickActor }: { scenario: { id: string } | null; time: number; onPickActor?: (id: string) => void }) => <div data-testid="demo-map" data-time={time} data-scene={scenario?.id}>{onPickActor && <><button onClick={() => onPickActor("ego")}>Map ego</button><button onClick={() => onPickActor("tok-car")}>Map car</button></>}</div> }));
vi.mock("../TrackView", () => ({ TrackView: () => <div/> }));
vi.mock("../Real2simReport", () => ({ Real2simReport: () => <div>Báo cáo thật</div> }));
afterEach(cleanup);
function setup(failPilot = false, guided = false) {
  const pilot = pkg();
  const baseline = { ...pkg(), id: "b".repeat(32), report: { ...pilot.report!, drivers: { ...pilot.report!.drivers!, react: false } } };
  const imported = { ...pilot, id: "a".repeat(32), kind: undefined, report: null } as ImportedScenario;
  const api = {
    mapContext: vi.fn(async()=>({map_id:"sha256:test"})), listScenes: vi.fn(async () => [{ scene: "scene-0061" }]), sourceScene: vi.fn(async () => source), reactiveCandidates: vi.fn(async () => candidates), listImported: vi.fn(async () => []),
    importReactive: vi.fn(async ({ event }: { event: ReactiveEvent }) => { if (event.react && failPilot) throw new Error("pilot failed"); return event.react ? pilot : baseline; }),
    importXosc: vi.fn(async () => imported), importTemplate: vi.fn(async () => imported),
  };
  render(<UnifiedScenarioDemo api={api as unknown as DesktopAPI} onLibrary={vi.fn()}/>);
  if (!guided) fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
  return { api, baseline, pilot, imported };
}
async function selectReaction(label = "Phanh") {
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Xe gây sự kiện" }) as HTMLSelectElement).options.length).toBeGreaterThan(1));
  fireEvent.click(screen.getByRole("button", { name: "Map car" }));
  fireEvent.click(screen.getByRole("button", { name: "Tiếp: chọn tình huống" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
}
it("creates a frozen event pair and plays both maps on the same timeline", async () => {
  const { api, baseline, pilot } = setup();
  expect((screen.getByRole("button", { name: "Tiếp: chọn tình huống" }) as HTMLButtonElement).disabled).toBe(true);
  await selectReaction(); fireEvent.click(screen.getByRole("button", { name: "Chạy baseline và pilot" }));
  await screen.findByRole("button", { name: "Đặt cạnh nhau" });
  expect(api.importReactive.mock.calls.map(([arg]) => arg.event)).toEqual([false, true].map(react => ({ actor_id: "tok-car", t0_s: 0, decel_mps2: 4, target: "hold", dwell_s: 0, react, reaction_s: 1 })));
  expect(screen.getAllByTestId("demo-map").map(el => el.getAttribute("data-scene"))).toEqual([baseline.id, pilot.id]);
  fireEvent.change(screen.getByRole("slider", { name: "Thời gian" }), { target: { value: "4.5" } });
  expect(screen.getAllByTestId("demo-map").map(el => el.getAttribute("data-time"))).toEqual(["4.5", "4.5"]);
  fireEvent.click(screen.getByRole("button", { name: "Baseline" }));
  expect(screen.getByTestId("demo-map").getAttribute("data-scene")).toBe(baseline.id);
  fireEvent.click(screen.getByRole("button", { name: "Pilot" }));
  expect(screen.getByTestId("demo-map").getAttribute("data-scene")).toBe(pilot.id);
  fireEvent.click(screen.getByRole("button", { name: "Tiếp: lưu và xuất" }));
  expect(screen.getByText("Đã tự lưu vào thư viện")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Xuất baseline .xosc" })).toBeTruthy();
});
for (const [label, kind] of [["Tăng tốc", "accelerate"], ["Dừng ở vạch", "stopline"], ["Chuyển làn", "lane_change"]] as const) {
  it(`creates both variants of ${kind}`, async () => {
    const { api } = setup(); await selectReaction(label); fireEvent.click(screen.getByRole("button", { name: "Chạy baseline và pilot" }));
    await screen.findByRole("button", { name: "Đặt cạnh nhau" });
    expect(api.importReactive).toHaveBeenCalledTimes(2);
    const [base, pilot] = api.importReactive.mock.calls.map(([arg]) => arg.event);
    expect(base).toMatchObject({ kind, react: false }); expect(pilot).toEqual({ ...base, react: true });
  });
}
it("invalidates comparison when editing and clears vehicle selection", async () => {
  setup(); await selectReaction(); fireEvent.click(screen.getByRole("button", { name: "Chạy baseline và pilot" }));
  await screen.findByRole("button", { name: "Đặt cạnh nhau" });
  fireEvent.click(screen.getByRole("button", { name: /Chỉnh tham số/ }));
  expect(screen.queryByRole("button", { name: "Đặt cạnh nhau" })).toBeNull(); expect(screen.queryByLabelText("Baseline và pilot")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Chọn xe/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Xe gây sự kiện" }), { target: { value: "" } });
  expect((screen.getByRole("button", { name: "Tiếp: chọn tình huống" }) as HTMLButtonElement).disabled).toBe(true);
});
it("reports partial persistence without inventing a complete pair", async () => {
  const { api } = setup(true); await selectReaction(); fireEvent.click(screen.getByRole("button", { name: "Chạy baseline và pilot" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Baseline đã được lưu; pilot chưa hoàn tất");
  expect(screen.queryByRole("button", { name: "Đặt cạnh nhau" })).toBeNull(); expect(api.listImported.mock.calls.length).toBeGreaterThan(1);
});
it("opens twenty templates from ego and compiles through the shared result", async () => {
  const { api, imported } = setup(); await screen.findByRole("button", { name: "Map ego" });
  fireEvent.click(screen.getByRole("button", { name: "Map ego" })); fireEvent.click(screen.getByRole("button", { name: "Tiếp: chọn tình huống" }));
  expect(screen.getAllByRole("button", { name: /^Chọn loại / })).toHaveLength(20);
  fireEvent.click(screen.getByRole("button", { name: "Chọn loại Dừng khẩn cấp" })); fireEvent.click(screen.getByRole("button", { name: "Tạo kịch bản trên map" }));
  await screen.findByRole("button", { name: "Tiếp: lưu và xuất" });
  expect(api.importTemplate).toHaveBeenCalledWith({ source_id: source.id, template: expect.objectContaining({ scenario_type: "emergency_stop" }) });
  expect(screen.getByTestId("demo-map").getAttribute("data-scene")).toBe(imported.id); expect(screen.queryByLabelText("Baseline và pilot")).toBeNull();
});
it("imports ordinary XOSC without invented comparison", async () => {
  const { api, imported } = setup(); await waitFor(() => expect(api.reactiveCandidates).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Nạp tệp .xosc" })); await screen.findByRole("button", { name: "Tiếp: lưu và xuất" });
  expect(screen.getByTestId("demo-map").getAttribute("data-scene")).toBe(imported.id); expect(screen.queryByLabelText("Baseline và pilot")).toBeNull();
});

it("keeps result navigation disabled until saved library refresh completes", async () => {
  const { api } = setup(); await selectReaction();
  let finish!: () => void;
  api.listImported.mockImplementationOnce(() => new Promise<never[]>(resolve => { finish = () => resolve([]); }));
  fireEvent.click(screen.getByRole("button", { name: "Chạy baseline và pilot" }));
  const next = await screen.findByRole("button", { name: "Tiếp: lưu và xuất" }) as HTMLButtonElement;
  expect(next.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Thiết kế tình huống khác" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Baseline" }) as HTMLButtonElement).disabled).toBe(true);
  finish(); await waitFor(() => expect(next.disabled).toBe(false));
});

it("guides a beginner from intent to suggested vehicle and real paired simulation", async () => {
  const { api } = setup(false, true);
  await waitFor(() => expect((screen.getByRole("button", { name: /Xe phía trước phanh/ }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("combobox", { name: "Xe gây sự kiện" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Xe phía trước phanh/ }));
  expect(((await screen.findByRole("combobox", { name: "Xe tạo tình huống" })) as HTMLSelectElement).value).toBe("tok-car");
  fireEvent.click((await screen.findByRole("button", { name: "Dùng xe này" })));
  expect(screen.getByRole("combobox", { name: "Cách xảy ra" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Xem xe của tôi phản ứng" }));
  await screen.findByRole("button", { name: "Đặt cạnh nhau" });
  const [a, b] = api.importReactive.mock.calls.map(([arg]) => arg.event);
  expect(a.react).toBe(false); expect(b).toEqual({ ...a, react: true });
  expect(screen.getByRole("button", { name: "Không bật phản ứng" })).toBeTruthy();
});
it("explains unavailable guided situations and keeps expert authoring accessible", async () => {
  const { api } = setup(false, true);
  api.reactiveCandidates.mockResolvedValue({ ...candidates, candidates: [] });
  await screen.findAllByText("Chưa có xe phù hợp trong cảnh này");
  expect((screen.getByRole("button", { name: /Xe phía trước phanh/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Chi tiết" }));
  expect(screen.getByRole("button", { name: /Xe của tôi · ego/ })).toBeTruthy();
  expect(api.importReactive).not.toHaveBeenCalled();
});
it("keeps a completed artifact visible if the library refresh fails",async()=>{
 const {api,pilot}=setup();await selectReaction();
 api.listImported.mockRejectedValue(new Error("library unavailable"));
 fireEvent.click(screen.getByRole("button",{name:"Chạy baseline và pilot"}));
 await screen.findByRole("button",{name:"Đặt cạnh nhau"});
 await waitFor(()=>expect(screen.getByRole("button",{name:"Tiếp: lưu và xuất"})).toHaveProperty("disabled",false));
 expect(screen.getAllByTestId("demo-map").some(e=>e.dataset.scene===pilot.id)).toBe(true);
 expect(screen.getByText("Không đọc được thư viện")).toBeTruthy();
});
it("clicking the selected display mode preserves the current draft",async()=>{
 setup();await selectReaction();
 fireEvent.click(screen.getByRole("button",{name:"Chi tiết"}));
 expect(screen.getByRole("button",{name:"Chạy baseline và pilot"})).toBeTruthy();
 expect(screen.getByRole("button",{name:"Chi tiết"}).getAttribute("aria-pressed")).toBe("true");
});
it("retries only the missing pilot using the persisted baseline",async()=>{
 const {api,baseline,pilot}=setup(true);await selectReaction();
 const row={scenario_id:baseline.id,scene:"scene-0061",package_path:"baseline-path",name:"baseline",created_at:new Date().toISOString(),runs:[]};
 api.listImported.mockResolvedValue([row] as never[]);
 Object.assign(api,{openImported:vi.fn(async()=>baseline),recordScenarioGroup:vi.fn(async({group})=>group),scenarioGroups:vi.fn(async()=>[])});
 fireEvent.click(screen.getByRole("button",{name:"Chạy baseline và pilot"}));
 await screen.findByRole("button",{name:"Thử lại pilot đã thiếu"});
 api.importReactive.mockImplementation(async({event})=>event.react?pilot:baseline);
 fireEvent.click(screen.getByRole("button",{name:"Thử lại pilot đã thiếu"}));
 await screen.findByRole("button",{name:"Đặt cạnh nhau"});
 expect(api.importReactive.mock.calls.filter(([p])=>!p.event.react)).toHaveLength(1);
 expect(api.importReactive.mock.calls.filter(([p])=>p.event.react)).toHaveLength(2);
});
it("retries group metadata without regenerating an already persisted pilot",async()=>{
 const {api}=setup();await selectReaction();
 const record=vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("metadata unavailable")).mockResolvedValue({});Object.assign(api,{recordScenarioGroup:record});
 fireEvent.click(screen.getByRole("button",{name:"Chạy baseline và pilot"}));
 await screen.findByRole("button",{name:"Lưu lại liên kết hai gói"});
 expect(screen.getByRole("alert").textContent).toContain("Hai gói đã được lưu");
 fireEvent.click(screen.getByRole("button",{name:"Lưu lại liên kết hai gói"}));
 await waitFor(()=>expect(record).toHaveBeenCalledTimes(3));
 expect(api.importReactive).toHaveBeenCalledTimes(2);
});
