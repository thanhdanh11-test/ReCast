// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AccessApp from "./AccessApp";
import { accessCall } from "./accessApi";
vi.mock("./accessApi", () => ({ accessCall: vi.fn() }));
vi.mock("./ScenarioApp", () => ({ default: ({ onLibrary, initialGuided }: { onLibrary: () => void; initialGuided?: boolean }) => <div data-testid="main-studio" data-guided-default={String(initialGuided)}>Studio đã mở<button onClick={onLibrary}>Thư viện map</button></div> }));
const call = vi.mocked(accessCall);
const dataset = { id: "a".repeat(24), name: "nuScenes mini", format: "nuscenes", root: "/fixture", sceneCount: 10, regions: ["boston-seaport"], status: "ready" };
afterEach(cleanup);
beforeEach(() => { call.mockReset(); HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; });
describe("local access flow", () => {
  it("requires login before loading any dataset, clears password after success", async () => {
    call.mockImplementation(async (name) => {
      if (name === "auth/session") return { configured: true, authenticated: false };
      if (name === "auth/login") return { configured: true, authenticated: true, username: "owner" };
      if (name === "catalog") return [dataset];
    });
    render(<AccessApp/>);
    await screen.findByRole("heading", { name: "Chào mừng trở lại." });
    expect(call.mock.calls.map(c => c[0])).toEqual(["auth/session"]);
    fireEvent.change(screen.getByLabelText("Tên đăng nhập"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "local-test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    await screen.findByRole("button", { name: "Mở nuScenes mini" });
    expect(screen.queryByLabelText("Mật khẩu")).toBeNull();
    expect(call).toHaveBeenCalledWith("auth/login", { username: "owner", password: "local-test-password" });
  });
  it("first launch creates account; failed authentication keeps user on form", async () => {
    call.mockImplementation(async (name) => {
      if (name === "auth/session") return { configured: false, authenticated: false };
      throw new Error("Tài khoản đã được tạo.");
    });
    render(<AccessApp/>);
    const button = await screen.findByRole("button", { name: "Tạo tài khoản" });
    fireEvent.change(screen.getByLabelText("Tên đăng nhập"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "local-test-password" } });
    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("Tài khoản đã được tạo");
    expect(call.mock.calls.some(c => c[0] === "catalog")).toBe(false);
  });
  it("selects a validated dataset, returns to catalog and expires back to login", async () => {
    call.mockImplementation(async (name) => name === "auth/session" ? { configured: true, authenticated: true, username: "owner" } : name === "catalog" ? [dataset] : {});
    render(<AccessApp/>);
    fireEvent.click(await screen.findByRole("button", { name: "Mở nuScenes mini" }));
    await screen.findByText("Studio đã mở");
    expect(screen.getByTestId("main-studio").getAttribute("data-guided-default")).toBe("true");
    expect(call).toHaveBeenCalledWith("catalog/select", { id: dataset.id });
    fireEvent.click(screen.getByRole("button", { name: "Thư viện map" }));
    await screen.findByRole("button", { name: "Mở nuScenes mini" });
    window.dispatchEvent(new Event("topeye-session-expired"));
    await screen.findByRole("heading", { name: "Chào mừng trở lại." });
  });
  it("equal-size plus tile opens import and failed import leaves catalog intact", async () => {
    call.mockImplementation(async (name) => {
      if (name === "auth/session") return { configured: true, authenticated: true, username: "owner" };
      if (name === "catalog") return [dataset];
      throw new Error("Thiếu file LiDAR");
    });
    render(<AccessApp/>);
    const plus = await screen.findByRole("button", { name: /Thêm dữ liệu Mở một hành trình/ });
    await waitFor(() => expect(plus.hasAttribute("disabled")).toBe(false));
    expect(plus.classList.contains("dataset-tile")).toBe(true);
    fireEvent.click(plus);
    fireEvent.change(screen.getByLabelText("Đường dẫn thư mục"), { target: { value: "/broken" } });
    fireEvent.click(screen.getByRole("button", { name: "Thêm vào thư viện" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Thiếu file LiDAR");
    expect(call).toHaveBeenCalledWith("catalog/add", { path: "/broken", name: "" });
    expect(screen.getByRole("button", { name: "Mở nuScenes mini" })).toBeTruthy();
  });
});
