// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScenarioMetricsView } from "./ScenarioMetricsView";
import { detail } from "../reactive/fixtures";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

it("renders simple mode by default with visual verdict and comparison cards", () => {
  render(<ScenarioMetricsView detail={detail} />);

  expect(screen.getByLabelText("Baseline và pilot")).toBeTruthy();
  expect(screen.getByText("Đánh giá an toàn dễ hiểu")).toBeTruthy();
  expect(screen.getByText("Không phát hiện va chạm trong khoảng mô phỏng")).toBeTruthy();

  // Baseline and Pilot cards
  expect(screen.getByText("BASELINE · KHÔNG PHẢN ỨNG")).toBeTruthy();
  expect(screen.getByText("PILOT · CÓ PHẢN ỨNG")).toBeTruthy();
  expect(screen.getAllByText(/9,55 m/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText(/\+9,55 m/)).toBeTruthy();
});

it("switches to technical mode and displays detailed comparison table", () => {
  render(<ScenarioMetricsView detail={detail} />);

  const techButton = screen.getByRole("button", { name: "Kỹ thuật" });
  fireEvent.click(techButton);

  expect(screen.getByText("Đối chiếu chỉ số kỹ thuật chi tiết")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Bảng so sánh kỹ thuật" })).toBeTruthy();
  expect(screen.getByText("Khoảng cách gần nhất (Min Gap)")).toBeTruthy();
  expect(screen.getByText("Thời gian tới va chạm (Min TTC)")).toBeTruthy();
  expect(screen.getByText("Gia tốc phanh sử dụng (a_used)")).toBeTruthy();

  // Switch back to simple mode
  const simpleButton = screen.getByRole("button", { name: "Cơ bản" });
  fireEvent.click(simpleButton);
  expect(screen.getByText("Đánh giá an toàn dễ hiểu")).toBeTruthy();
  expect(screen.queryByRole("table", { name: "Bảng so sánh kỹ thuật" })).toBeNull();
});

it("shows appropriate verdict when both variants are far", () => {
  const farDetail = {
    ...detail,
    comparison: {
      baseline: { ...detail.comparison.baseline, group: "far" as const },
      pilot: { ...detail.comparison.pilot, group: "far" as const, valid: true },
    },
  };
  render(<ScenarioMetricsView detail={farDetail} />);
  expect(screen.getByText("Không phát hiện va chạm trong khoảng mô phỏng")).toBeTruthy();
});

it("shows alert when pilot is invalid", () => {
  const invalidDetail = {
    ...detail,
    summary: "Quỹ đạo vi phạm giới hạn gia tốc.",
    comparison: {
      baseline: { ...detail.comparison.baseline, group: "collision" as const },
      pilot: { ...detail.comparison.pilot, valid: false, reasons: ["physics"] },
    },
  };
  render(<ScenarioMetricsView detail={invalidDetail} />);
  expect(screen.getByText("Tình huống cần lưu ý")).toBeTruthy();
  expect(screen.getByText("Quỹ đạo vi phạm giới hạn gia tốc.")).toBeTruthy();
});

it("uses explicit ego collision evidence even when an invalid baseline has no group",()=>{
 const d={...detail,comparison:{baseline:{...detail.comparison.baseline,valid:false,group:null,collisions:[["ego","car_154",1,"ego"] as [string,string,number,string]]},pilot:detail.comparison.pilot}};
 render(<ScenarioMetricsView detail={d} reactionSeconds={1.5}/>);
 expect(screen.getByText("Baseline có va chạm ego; pilot không phát hiện va chạm")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Kỹ thuật"}));expect(screen.getByText("1,50 s")).toBeTruthy();
});
it("does not claim ego reacted when the report records no reaction",()=>{
 const d={...detail,comparison:{...detail.comparison,pilot:{...detail.comparison.pilot,reacted:[]}}};
 render(<ScenarioMetricsView detail={d}/>);expect(screen.getByText("Báo cáo không ghi nhận ego phản ứng trong trường hợp này.")).toBeTruthy();
 expect(screen.queryByText(/an toàn tuyệt đối/)).toBeNull();
});
