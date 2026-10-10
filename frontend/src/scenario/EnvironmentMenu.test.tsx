// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvironmentMenu, HeaderPopover } from "./EnvironmentMenu";
import { defaultEnvironmentSettings } from "./weather";
afterEach(cleanup);
describe("header popovers", () => {
    it("offers 22 presets and emits quality changes without changing weather", () => {
        const changed = vi.fn();
        render(<EnvironmentMenu settings={defaultEnvironmentSettings()} onChange={changed}/>);
        fireEvent.click(screen.getByRole("button", {name: "Môi trường"}));
        expect(screen.getByRole("combobox", {name: "Thời tiết CARLA 0.9.15"}).children).toHaveLength(22);
        fireEvent.change(screen.getByRole("combobox", {name: "Thời tiết CARLA 0.9.15"}), {target: {value: "HardRainNight"}});
        expect(changed.mock.calls[0][0]).toMatchObject({preset: "HardRainNight", weather: {precipitation: 100}, quality: "auto"});
        fireEvent.change(screen.getByRole("combobox", {name: "Chất lượng 3D"}), {target: {value: "balanced"}});
        expect(changed.mock.calls[1][0]).toMatchObject({preset: "ClearNoon", quality: "balanced"});
    });
    it("moves focus inside, closes with Escape or outside pointer and restores trigger focus", () => {
        render(<HeaderPopover label="OpenSCENARIO"><button>Nạp</button></HeaderPopover>);
        const trigger = screen.getByRole("button", {name:"OpenSCENARIO"});
        fireEvent.click(trigger);
        expect(document.activeElement).toBe(screen.getByRole("button", {name:"Nạp"}));
        fireEvent.keyDown(document, {key:"Escape"});
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(trigger);
        fireEvent.click(trigger);
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });
});
