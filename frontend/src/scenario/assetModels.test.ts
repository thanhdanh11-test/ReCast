import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  disposeActorTemplates,
  instantiateAssetModel,
  loadActorTemplates,
  parseActorTemplate,
  validateBundledGlb,
} from "./assetModels";
import type { Actor } from "./types";
const bytes = (name: string) => {
  const b = readFileSync(
    new URL(`./assets/models/${name}.glb`, import.meta.url),
  );
  return b.buffer.slice(
    b.byteOffset,
    b.byteOffset + b.byteLength,
  ) as ArrayBuffer;
};
const actor: Actor = {
  id: "ego",
  role: "ego",
  category: "vehicle.car",
  length_m: 4.5,
  width_m: 1.85,
  height_m: 1.6,
  samples: [],
};
const triangles = (g: THREE.Object3D) => {
  let n = 0;
  g.traverse((o) => {
    if (o instanceof THREE.Mesh)
      n +=
        (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  return n;
};
describe("offline bundled GLB actor silhouettes", () => {
  it.each(["traffic-sedan", "traffic-suv"])(
    "parses actual %s header/mesh and normalizes dimensions",
    async (name) => {
      const pair = await parseActorTemplate(bytes(name), name),
        box = new THREE.Box3().setFromObject(pair.high);
      expect(box.min.toArray()).toEqual([-0.5, -0.5, -0.5]);
      expect(box.max.toArray()).toEqual([0.5, 0.5, 0.5]);
      expect(pair.high.children.length).toBeLessThanOrEqual(5);
      expect(triangles(pair.high)).toBeGreaterThan(5000);
      expect(triangles(pair.distant)).toBeLessThan(triangles(pair.high) * 0.75);
      pair.high.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const m = o.material as THREE.MeshStandardMaterial;
          expect(m.map).toBeNull();
          // Fixed front-white / rear-red lamps are the only coloured, emissive parts (plan15).
          if (m.userData.lamp) return;
          expect(m.color.r).toBe(m.color.g);
          expect(m.color.g).toBe(m.color.b);
          expect(m.emissiveIntensity).toBe(1);
        }
      });
      for (const name of [
        "glass",
        "rubber",
        "paint",
        "lamp-front",
        "lamp-rear",
      ])
        expect(
          pair.high.children.some(
            (o) =>
              (o as THREE.Mesh).material instanceof
                THREE.MeshStandardMaterial &&
              ((o as THREE.Mesh).material as THREE.MeshStandardMaterial)
                .name === name,
          ),
        ).toBe(true);
      const headlights = pair.high.children.find(
        (o) =>
          ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).userData
            .lamp === "front",
      )!;
      const taillights = pair.high.children.find(
        (o) =>
          ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).userData
            .lamp === "rear",
      )!;
      expect(new THREE.Box3().setFromObject(headlights).min.x).toBeGreaterThan(
        0,
      );
      expect(new THREE.Box3().setFromObject(taillights).max.x).toBeLessThan(0);
      const front = pair.high.children
        .filter(
          (o) =>
            ((o as THREE.Mesh).material as THREE.MeshStandardMaterial).userData
              .actorSurface === "lights",
        )
        .map((o) => new THREE.Box3().setFromObject(o));
      expect(front.some((b) => b.max.x > 0)).toBe(true);
      expect(front.some((b) => b.min.x < 0)).toBe(true);
      disposeActorTemplates({ sedan: pair, suv: pair });
    },
  );
  it("fits exact source/import actor boxes and keeps models shared only within their scene", async () => {
    const sedan = await parseActorTemplate(bytes("traffic-sedan"), "sedan"),
      suv = await parseActorTemplate(bytes("traffic-suv"), "suv"),
      templates = { sedan, suv };
    const source = instantiateAssetModel(actor, false, templates)!,
      imported = instantiateAssetModel(actor, true, templates)!,
      traffic = instantiateAssetModel(
        { ...actor, role: "traffic" },
        false,
        templates,
      )!;
    for (const [model, centerY] of [
      [source, 0.8],
      [imported, 0],
      [traffic, 0],
    ] as const) {
      const b = new THREE.Box3().setFromObject(model);
      expect(b.getSize(new THREE.Vector3()).toArray()).toEqual([
        4.5, 1.6, 1.85,
      ]);
      expect(b.getCenter(new THREE.Vector3()).y).toBeCloseTo(centerY);
    }
    const a = (source.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh,
      b = (imported.children[0] as THREE.LOD).levels[0].object
        .children[0] as THREE.Mesh;
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect(
      instantiateAssetModel(
        { ...actor, length_m: Number.NaN },
        false,
        templates,
      ),
    ).toBeNull();
    expect(
      instantiateAssetModel(
        { ...actor, category: "vehicle.bus" },
        false,
        templates,
      ),
    ).toBeNull();
    expect(
      instantiateAssetModel(
        { ...actor, category: "vehicle.truck" },
        false,
        templates,
      ),
    ).toBeNull();
    expect(
      instantiateAssetModel(
        { ...actor, category: "human.pedestrian.adult" },
        false,
        templates,
      ),
    ).toBeNull();
    const spy = vi.spyOn(a.geometry, "dispose");
    disposeActorTemplates(templates);
    expect(spy).toHaveBeenCalledTimes(1);
  });
  it("rejects corrupt and external references before any load", () => {
    expect(() => validateBundledGlb(new ArrayBuffer(8))).toThrow();
    const input = bytes("traffic-sedan"),
      v = new DataView(input);
    v.setUint32(4, 1, true);
    expect(() => validateBundledGlb(input)).toThrow("header");
    const json = new TextEncoder().encode(
      JSON.stringify({
        asset: { version: "2.0" },
        buffers: [{ uri: "https://invalid.example/model.bin" }],
      }),
    );
    const length = Math.ceil(json.length / 4) * 4,
      glb = new ArrayBuffer(20 + length),
      view = new DataView(glb);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.byteLength, true);
    view.setUint32(12, length, true);
    view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(glb, 20).fill(32);
    new Uint8Array(glb, 20, json.length).set(json);
    expect(() => validateBundledGlb(glb)).toThrow("External");
  });
  it("cancels before an asynchronous scene load without creating resources", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadActorTemplates(controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
it("loads actual inline payloads offline and disposes on late cancellation", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const templates = await loadActorTemplates();
  expect(templates.sedan.id).toBe("traffic-sedan");
  expect(templates.suv.id).toBe("traffic-suv");
  expect(fetchSpy).not.toHaveBeenCalled();
  disposeActorTemplates(templates);
  const controller = new AbortController(),
    disposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
  const loading = loadActorTemplates(controller.signal);
  controller.abort();
  await expect(loading).rejects.toMatchObject({ name: "AbortError" });
  expect(disposeSpy).toHaveBeenCalled();
  disposeSpy.mockRestore();
  fetchSpy.mockRestore();
});
