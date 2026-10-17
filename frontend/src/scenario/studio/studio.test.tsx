// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../i18n";
import { describeName, historyRows, initialOf } from "./history";
import { StudioTimeline, timelineRows } from "./StudioTimeline";
import { SaveDialog } from "./SaveDialog";
import { ExportsPage } from "./ExportsPage";
import { SceneList } from "./SceneList";
import { sectionsOf } from "./AnalysisPage";
import { AnalysisSummary } from "./AnalysisSummary";
import { carlaBlocked } from "./ScenarioStudio";
import { chosenActorIds, invalidityOf } from "./validity";
import type { DesktopAPI, ExportJob, ImportedEntry, ImportedScenario, Scenario, ScenarioGroup } from "../types";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const wrap = (node: React.ReactNode) => render(<LanguageProvider value="vi">{node}</LanguageProvider>);
const entry = (id: string, name: string, extra: Partial<ImportedEntry> = {}): ImportedEntry =>
    ({ scenario_id: id.repeat(32), package_path: `/ws/${id}`, name, scene: "scene-0061", map_id: "m", actors: 2, duration_s: 4, created_at: `2026-10-17T10:00:0${extra.created_at ?? "0"}Z`, runs: [], ...extra, ...(extra.created_at ? { created_at: extra.created_at } : {}) });
const group = (b: string, p: string, event: Record<string, unknown> = { actor_id: "tok", t0_s: 3, decel_mps2: 6, target: "stop", dwell_s: 0, reaction_s: 1.5 }): ScenarioGroup =>
    ({ schema_version: 1, id: "g".repeat(32), scene: "scene-0061", map_id: "m", event, baseline_id: b.repeat(32), pilot_id: p.repeat(32), created_at: "2026-10-17T10:00:00Z" } as unknown as ScenarioGroup);
const pose = (t: number, x: number) => ({ t_s: t, x_m: x, y_m: 0, z_m: 0, yaw_rad: 0, observed: true });
const scenario = (actors: { id: string; role?: string; xs: number[] }[]): Scenario => ({
    id: "s", mode: "imported", interval_s: [0, 4], source: { scene: "scene-0061" },
    actors: actors.map(a => ({ id: a.id, role: a.role ?? "traffic", category: "vehicle.car", length_m: 4, width_m: 2, height_m: 1.5, samples: a.xs.map((x, i) => pose(i, x)) })),
} as unknown as Scenario);

describe("history rows", () => {
    it("collapses a complete baseline+pilot group to one row and labels the other kinds", () => {
        const rows = historyRows([
            entry("a", "base.xosc", { kind: "real2sim", created_at: "2026-10-17T10:00:01Z" }), entry("b", "pilot.xosc", { kind: "real2sim", created_at: "2026-10-17T10:00:02Z" }),
            entry("c", "tpl.xosc", { has_template: true, created_at: "2026-10-17T10:00:03Z" }), entry("d", "hand.xosc", { created_at: "2026-10-17T10:00:04Z" }),
            entry("e", "team.xosc", { kind: "real2sim", created_at: "2026-10-17T10:00:05Z" }),
        ], [group("a", "b"), group("x", "y")]);
        expect(rows.map(r => [r.name, r.kind, r.baseline?.name ?? null])).toEqual([
            ["team.xosc", "real2sim", null], ["hand.xosc", "xosc", null], ["tpl.xosc", "template", null], ["pilot.xosc", "reaction", "base.xosc"]]);
    });
    it("keeps both packages as rows when one side of a group is missing", () => {
        expect(historyRows([entry("a", "base.xosc", { kind: "real2sim" })], [group("a", "b")]).map(r => r.kind)).toEqual(["real2sim"]);
    });
    it("turns a stored group event back into reaction form values", () => {
        // replay-forge “stop” with no dwell drives on (“Dừng rồi đi ngay”); “hold” is “Dừng hẳn” (plan51).
        expect(initialOf(group("a", "b"))).toMatchObject({ actorId: "tok", kind: "brake", t0: 3, params: { decel: 6, goal: "go", reaction: 1.5 } });
        expect(initialOf(group("a", "b", { actor_id: "tok", t0_s: 3, decel_mps2: 6, target: "hold", dwell_s: 0, reaction_s: 1 })).params.goal).toBe("stop");
        expect(initialOf(group("a", "b", { kind: "lane_change", actor_id: "t2", t0_s: 2, direction: "right", duration_s: 5, reaction_s: 1 })))
            .toMatchObject({ kind: "lane_change", actorId: "t2", params: { direction: "right", duration: 5 } });
    });
});

describe("StudioTimeline", () => {
    const s = scenario([{ id: "parked", xs: [5, 5, 5, 5, 5] }, { id: "lead", xs: [0, 0, 4, 8, 12] }, { id: "ego", role: "ego", xs: [0, 2, 4, 6, 8] }]);
    it("orders ego, event vehicle, movers, parked and colours only moving spans", () => {
        expect(timelineRows(s, 4, "lead").map(r => r.actor.id)).toEqual(["ego", "lead", "parked"]);
        wrap(<StudioTimeline scenario={s} baseline={null} duration={4} time={1} playing={false} onPlay={() => {}} onRestart={() => {}} onSeek={() => {}} marks={[]} eventActor="lead" actorIds={["ego", "lead", "parked"]}/>);
        const span = (id: string) => document.querySelectorAll(`[data-actor="${id}"] [data-variant="pilot"]`);
        expect(span("ego")).toHaveLength(1);
        expect(span("lead")).toHaveLength(1);
        expect((span("lead")[0] as HTMLElement).style.left).toBe("25%"); // starts moving at 1 s of 4
        expect(span("parked")).toHaveLength(0);
    });
    it("draws the baseline as dashed spans on the same row and only the marks it is given", () => {
        const baseline = scenario([{ id: "ego", role: "ego", xs: [0, 2, 4, 4, 4] }]);
        wrap(<StudioTimeline scenario={s} baseline={baseline} duration={4} time={0} playing={false} onPlay={() => {}} onRestart={() => {}} onSeek={() => {}} marks={[{ t: 2, label: "Tình huống", tone: "event" }]} actorIds={["ego", "lead", "parked"]}/>);
        expect(document.querySelectorAll('[data-actor="ego"] [data-variant="baseline"]')).toHaveLength(1);
        expect(screen.getByText("Tình huống")).toBeTruthy();
        expect(document.querySelectorAll(".studio-mark")).toHaveLength(1);
    });
    it("seeks from the slider and plays", () => {
        const onSeek = vi.fn(), onPlay = vi.fn();
        wrap(<StudioTimeline scenario={s} baseline={null} duration={4} time={0} playing={false} onPlay={onPlay} onRestart={() => {}} onSeek={onSeek} marks={[]} actorIds={null}/>);
        expect(document.querySelectorAll(".studio-timeline-row")).toHaveLength(0); // source scene: controls only
        fireEvent.change(screen.getByRole("slider", { name: "Thời gian" }), { target: { value: "2.5" } });
        fireEvent.click(screen.getByRole("button", { name: "Phát" }));
        expect(onSeek).toHaveBeenCalledWith(2.5);
        expect(onPlay).toHaveBeenCalledOnce();
    });
});

describe("SaveDialog", () => {
    it("defaults to CARLA, confirms the chosen format and cancels without exporting", () => {
        const onConfirm = vi.fn(), onCancel = vi.fn();
        wrap(<SaveDialog name="a.xosc" carlaBlocked={null} busy={false} onCancel={onCancel} onConfirm={onConfirm}/>);
        const select = screen.getByRole("combobox", { name: "Định dạng xuất" }) as HTMLSelectElement;
        expect(select.value).toBe("carla");
        fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
        expect(onCancel).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));
        expect(onConfirm).toHaveBeenCalledWith("carla");
    });
    it("greys out CARLA with its reason when the dataset cannot produce a road map", () => {
        const reason = carlaBlocked({ source: { scene: "log", dataset_version: "av2-sensor" } } as unknown as Scenario);
        expect(reason).toMatch(/Argoverse 2/);
        expect(carlaBlocked({ source: { scene: "scene-0061", dataset_version: "v1.0-mini" } } as unknown as Scenario)).toBeNull();
        wrap(<SaveDialog name="a.xosc" carlaBlocked={reason} busy={false} onCancel={() => {}} onConfirm={() => {}}/>);
        expect((screen.getByRole("combobox", { name: "Định dạng xuất" }) as HTMLSelectElement).value).toBe("xosc");
        expect((screen.getByRole("option", { name: "Xuất cho CARLA" }) as HTMLOptionElement).disabled).toBe(true);
        expect(screen.getByRole("note").textContent).toContain("Argoverse 2");
    });
});

const job = (id: string, status: ExportJob["status"], progress: number, extra: Partial<ExportJob> = {}): ExportJob =>
    ({ schema_version: 1, id: id.repeat(32), scenario_id: "s".repeat(32), name: `job-${id}`, scene: "scene-0061", format: "carla", status, progress, step: "Dựng bản đồ .xodr",
       created_at: "2026-10-17T10:00:00Z", finished_at: null, files: [], notes: [], error: null, ...extra });
describe("ExportsPage", () => {
    it("shows progress, polls while a job runs and stops once everything is finished", async () => {
        vi.useFakeTimers();
        const listExports = vi.fn().mockResolvedValueOnce([job("1", "running", 40)]).mockResolvedValue([job("1", "done", 100)]);
        const api = { listExports, deleteExport: vi.fn(), exportScenario: vi.fn(), exportUrl: (id: string) => `/api/exports/${id}.zip` } as unknown as DesktopAPI;
        wrap(<ExportsPage api={api} shown/>);
        await act(async () => {});
        expect((screen.getByRole("progressbar", { name: "Tiến độ job-1" }) as HTMLProgressElement).value).toBe(40);
        expect(screen.getByText(/40% · Dựng bản đồ .xodr/)).toBeTruthy();
        expect((screen.getByRole("button", { name: "Xoá bản xuất job-1" }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => { vi.advanceTimersByTime(1000); });
        expect(screen.getByRole("link", { name: "Tải về job-1" }).getAttribute("href")).toBe(`/api/exports/${"1".repeat(32)}.zip`);
        await act(async () => { vi.advanceTimersByTime(5000); });
        expect(listExports).toHaveBeenCalledTimes(2);
    });
    it("deletes after confirmation and re-exports a failed job", async () => {
        const api = { listExports: vi.fn().mockResolvedValue([job("2", "failed", 10, { error: { code: "TIMEOUT", message: "Xuất quá lâu" } })]),
            deleteExport: vi.fn().mockResolvedValue({ removed: true }), exportScenario: vi.fn().mockResolvedValue(job("3", "queued", 0)) } as unknown as DesktopAPI;
        vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValue(true));
        wrap(<ExportsPage api={api} shown/>);
        expect(await screen.findByText(/Lỗi: Xuất quá lâu/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Xuất lại job-2" }));
        await waitFor(() => expect(api.exportScenario).toHaveBeenCalledWith({ scenario_id: "s".repeat(32), format: "carla" }));
        fireEvent.click(screen.getByRole("button", { name: "Xoá bản xuất job-2" }));
        expect(api.deleteExport).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Xoá bản xuất job-2" }));
        await waitFor(() => expect(api.deleteExport).toHaveBeenCalledWith({ id: "2".repeat(32) }));
    });
    it("does not poll while hidden", async () => {
        const listExports = vi.fn().mockResolvedValue([job("4", "running", 5)]);
        wrap(<ExportsPage api={{ listExports } as unknown as DesktopAPI} shown={false}/>);
        await act(async () => {});
        expect(listExports).not.toHaveBeenCalled();
    });
});

describe("SceneList", () => {
    it("greys out scenes with a map error only when errors are given", () => {
        const scenes = [{ scene: "scene-0103", duration_s: 19, ego_start_s: 0, tracks: [] }, { scene: "scene-0061", duration_s: 19, ego_start_s: 0, tracks: [] }];
        const onOpen = vi.fn();
        wrap(<SceneList scenes={scenes} current="scene-0061" disabled={false} mapErrors={{ "scene-0103": "bad polygon" }} onOpen={onOpen}/>);
        const list = within(screen.getByRole("list", { name: "Danh sách cảnh" }));
        const bad = list.getByRole("button", { name: /scene-0103/ }) as HTMLButtonElement;
        expect(bad.disabled).toBe(true);
        expect(bad.title).toBe("bad polygon");
        fireEvent.click(list.getByRole("button", { name: /scene-0061/ }));
        expect(onOpen).toHaveBeenCalledWith(scenes[1]);
        cleanup();
        wrap(<SceneList scenes={scenes} current="scene-0061" disabled={false} onOpen={onOpen}/>);
        expect((screen.getByRole("button", { name: /scene-0103/ }) as HTMLButtonElement).disabled).toBe(false);
    });
});

describe("AnalysisPage sections", () => {
    const base = { id: "p", import: { diagnostics: [] } } as unknown as ImportedScenario;
    it("offers only sections with data", () => {
        expect(sectionsOf(base, true)).toEqual(["fidelity"]);
        expect(sectionsOf(base, false)).toEqual([]);
        expect(sectionsOf({ ...base, kind: "real2sim", report: {} } as unknown as ImportedScenario, true)).toEqual(["report", "esmini"]);
        expect(sectionsOf({ ...base, kind: "real2sim", report: { topeye: {} } } as unknown as ImportedScenario, true))
            .toEqual(["summary", "timeline", "checks", "vehicles", "report", "esmini"]);
    });
});

describe("plan51 timeline rows and validity", () => {
    const pkg = (report: unknown, diagnostics: unknown[] = []) => ({ ...scenario([{ id: "ego", role: "ego", xs: [0, 1] }, { id: "car_1", xs: [9, 9] }, { id: "car_2", xs: [5, 6] }, { id: "car_3", xs: [20, 21] }]),
        report, import: { sha256: "h", diagnostics } }) as unknown as ImportedScenario;
    it("shows ego + the event vehicle + those that reacted for a reaction, every authored actor otherwise", () => {
        expect(chosenActorIds(pkg({ event: { actor: "car_1" }, reacted: ["car_2", "ego"] }))).toEqual(["ego", "car_1", "car_2"]);
        expect(chosenActorIds(pkg(undefined))).toEqual(["ego", "car_1", "car_2", "car_3"]);
        const s = pkg({ event: { actor: "car_1" }, reacted: [] });
        wrap(<StudioTimeline scenario={s} baseline={null} duration={1} time={0} playing={false} onPlay={() => {}} onRestart={() => {}} onSeek={() => {}} marks={[]} actorIds={chosenActorIds(s)}/>);
        expect([...document.querySelectorAll(".studio-timeline-row")].map(r => r.getAttribute("data-actor"))).toEqual(["ego", "car_1"]);
    });
    it("explains an ego collision with concrete fixes for templates and uses the report's own fix for reactions", () => {
        const tpl = pkg(undefined, [{ code: "EGO_COLLISION", message: "Xe của bạn (ego) va chạm lead lúc 6.90 s", actor_id: "lead", t_s: 6.9 }]);
        const bad = invalidityOf(null, tpl)!;
        expect(bad.code).toBe("EGO_COLLISION");
        expect(bad.hints.length).toBe(3);
        expect(bad.hints[1]).toEqual({ key: "Tăng khoảng cách ban đầu giữa ego và {actor}.", vars: { actor: "lead" } });
        const reaction = pkg({ valid: false, reasons: ["[ego_collision] …"], event: { actor: "car_1" }, topeye: { summary: "Không hợp lệ · … Cách sửa: phanh xe phía trước nhẹ hơn" } });
        expect(invalidityOf(null, reaction)).toEqual({ code: "REPORT_INVALID", message: "Không hợp lệ · … Cách sửa: phanh xe phía trước nhẹ hơn", hints: [] });
        expect(invalidityOf(null, pkg({ valid: true, event: { actor: "car_1" } }))).toBeNull();
        expect(invalidityOf(entry("a", "x.xosc", { invalid: { code: "EGO_COLLISION", message: "m", actor_id: "ped" } }), pkg(undefined))!.hints[1].vars).toEqual({ actor: "ped" });
    });
});

describe("plan52 readable names", () => {
    it("reads reaction package names and leaves others alone", () => {
        expect(describeName("car_154_t0.0_hold_a2")).toEqual({ key: "{actor} · phanh {decel} m/s², {goal} · lúc {t0} s", vars: { actor: "car_154", decel: "2", goal: "dừng hẳn", t0: "0" } });
        expect(describeName("car_9_t3.5_lane_change_left_d4")?.vars).toEqual({ actor: "car_9", side: "trái", d: "4", t0: "3,5" });
        expect(describeName("car_1_t2.0_accelerate_v9_a2")?.key).toContain("tăng tốc lên");
        expect(describeName("Dừng_khẩn_cấp.xosc")).toBeNull();
    });
});

describe("plan53 analysis summary", () => {
    const ego = (min_gap: number, min_ttc: number) => ({ min_gap, min_ttc, a_min: 1, a_used: 1, conflict_with: "car_1" });
    const detail = { summary: "Dùng được · phanh nhẹ là đủ.", checks: [{ id: "physics", passed: true }, { id: "collision", passed: false }], markers: [],
        comparison: { baseline: { valid: true, group: "collision", reasons: [], ego: ego(0, 0.4), collisions: [["ego", "car_1", 3, "ego"]], reacted: [] },
            pilot: { valid: true, group: "mild", reasons: [], ego: ego(4.2, 2.8), collisions: [], reacted: ["ego"] } } } as never;
    const report = (thresholds: Record<string, number>) => ({ drivers: { react: true, reaction_s: 1, thresholds, per_vehicle: {} }, run: { dt: 0.05 } }) as never;
    it("states the verdict, places baseline and pilot on the danger scale and grades metrics on the report's thresholds", () => {
        wrap(<AnalysisSummary report={report({ close_gap_m: 1, close_ttc_s: 1.5, comfort_decel: 3.4 })} detail={detail}/>);
        expect(screen.getByText("Kịch bản hợp lệ")).toBeTruthy();
        expect(screen.getByText("Kiểm định: 1/2 điều kiện đạt")).toBeTruthy();
        const steps = [...document.querySelectorAll(".an-step")].map(s => s.querySelector(".an-pins")!.textContent);
        expect(steps).toEqual(["", "P", "", "", "B"]);
        const gap = screen.getByText("Khoảng cách gần nhất").closest("tr")!;
        expect([...gap.querySelectorAll("td")].map(td => td.textContent)).toEqual(["Khoảng cách gần nhất ?", "0,00 m", "4,20 m", "+4,20 m tốt hơn", "≥ 1,00 m", "Trong ngưỡng"]);
    });
    it("shows a dash instead of guessing when the report has no thresholds", () => {
        wrap(<AnalysisSummary report={report({})} detail={detail}/>);
        const ttc = screen.getByText("Thời gian tới va chạm nhỏ nhất (TTC)").closest("tr")!;
        expect([...ttc.querySelectorAll("td")].slice(4).map(td => td.textContent)).toEqual(["—", "—"]);
    });
});
