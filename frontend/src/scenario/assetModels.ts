import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import sedanBase64 from "./assets/models/traffic-sedan.base64?raw";
import suvBase64 from "./assets/models/traffic-suv.base64?raw";
import type { Actor } from "./types";
import { createLampMaterial, NEUTRAL_PALETTE } from "./vehicleMaterials";

export interface AssetTemplatePair {
  high: THREE.Group;
  distant: THREE.Group;
  id: string;
}
export interface ActorTemplates {
  sedan: AssetTemplatePair;
  suv: AssetTemplatePair;
  /** An independently licensed, axis-normalized ego asset may be supplied by the caller. */
  ego?: AssetTemplatePair;
}
export const TRAFFIC_MODEL_CREDIT = {
  title: "Generic passenger car pack",
  author: "comrade1280",
  source:
    "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  modifications:
    "Blender normalization; grayscale materials; dimension fitting; batching; distant LOD",
};

function disposeObjects(objects: THREE.Object3D[]) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  for (const object of objects)
    object.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material])
        materials.add(material);
    });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}
/** For aborted/unattached loads. Attached models are disposed once by the owning scene. */
export function disposeActorTemplates(templates: ActorTemplates) {
  const pairs = [templates.sedan, templates.suv, templates.ego].filter(
    (p): p is AssetTemplatePair => !!p,
  );
  disposeObjects(pairs.flatMap((p) => [p.high, p.distant]));
}
function abortError() {
  return new DOMException("Actor model loading was cancelled", "AbortError");
}
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/** Validate binary/self-contained input before GLTFLoader can resolve any URL. */
export function validateBundledGlb(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 20 || buffer.byteLength > 16 * 1024 * 1024)
    throw new Error("Invalid bundled GLB size");
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error("Invalid bundled GLB header");
  const length = view.getUint32(12, true);
  if (20 + length > buffer.byteLength)
    throw new Error("Invalid GLB JSON chunk");
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, length)),
  );
  for (const collection of [json.buffers ?? [], json.images ?? []])
    for (const entry of collection)
      if (entry.uri && !entry.uri.startsWith("data:"))
        throw new Error("External GLB dependency rejected");
  if (
    (json.extensionsRequired ?? []).some((name: string) =>
      /draco|meshopt/i.test(name),
    )
  )
    throw new Error("Compressed GLB requires unsupported decoder");
  if (
    (json.meshes ?? []).some((mesh: { primitives: { mode?: number }[] }) =>
      mesh.primitives.some((p) => p.mode !== undefined && p.mode !== 4),
    )
  )
    throw new Error("Only triangle actor meshes are supported");
}
function decodeInline(url: string): ArrayBuffer {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(url);
  if (!match)
    throw new Error(
      "Actor model was not bundled inline; external file loading is disabled",
    );
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function surfaceKind(name: string) {
  return /glass|window/i.test(name)
    ? "glass"
    : /light|optic/i.test(name)
      ? "lights"
      : /trim|metal|rim|chrome/i.test(name)
        ? "trim"
        : /tire|rubber|wheel/i.test(name)
          ? "rubber"
          : "paint";
}
function neutralMaterial(name: string): THREE.MeshStandardMaterial {
  const kind = surfaceKind(name) as Exclude<
    ReturnType<typeof surfaceKind>,
    "lights"
  >;
  const material = new THREE.MeshStandardMaterial({
    color: NEUTRAL_PALETTE[kind],
    roughness: kind === "glass" ? 0.16 : kind === "rubber" ? 0.88 : 0.34,
    metalness: kind === "paint" ? 0.3 : 0.12,
    side: THREE.DoubleSide,
  });
  material.name = kind;
  material.userData.actorSurface = kind;
  material.userData.sourceMaterial = name;
  return material;
}
/** Splits a non-indexed light range by triangle centroid: +x (front) white, -x (rear) red. */
function splitLamps(
  flat: THREE.BufferGeometry,
  range: { start: number; count: number },
): Record<"front" | "rear", THREE.BufferGeometry | null> {
  const position = flat.attributes.position,
    normal = flat.attributes.normal;
  const data = { front: [[], []], rear: [[], []] } as Record<
    "front" | "rear",
    number[][]
  >;
  for (let i = range.start; i + 2 < range.start + range.count; i += 3) {
    const x =
      (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
    const side = x > 0 ? "front" : "rear";
    for (let j = i; j < i + 3; j++) {
      data[side][0].push(position.getX(j), position.getY(j), position.getZ(j));
      if (normal)
        data[side][1].push(normal.getX(j), normal.getY(j), normal.getZ(j));
    }
  }
  const build = ([p, n]: number[][]) => {
    if (!p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    if (n.length)
      g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    else g.computeVertexNormals();
    return g;
  };
  return { front: build(data.front), rear: build(data.rear) };
}
/** Procedural lamp pair on the normalized body face when an asset has no lamp mesh on a side. */
function fallbackLamps(side: "front" | "rear"): THREE.BufferGeometry {
  const x = side === "front" ? 0.49 : -0.49;
  const pieces = [-0.34, 0.34].map((z) =>
    new THREE.BoxGeometry(0.02, 0.07, 0.16)
      .translate(x, -0.1, z)
      .toNonIndexed(),
  );
  const merged = mergeGeometries(pieces)!;
  pieces.forEach((g) => g.dispose());
  merged.deleteAttribute("uv");
  return merged;
}
/** Cheap mesh LOD via vertex clustering, retaining the imported body silhouette. */
function distantGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = source.attributes.position,
    normal = source.attributes.normal;
  const cells = new Map<string, number>(),
    vertices: number[] = [],
    normals: number[] = [],
    counts: number[] = [],
    remap: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      y = position.getY(i),
      z = position.getZ(i),
      key = `${Math.round(x * 24)}:${Math.round(y * 24)}:${Math.round(z * 24)}`;
    let index = cells.get(key);
    if (index === undefined) {
      index = counts.length;
      cells.set(key, index);
      vertices.push(0, 0, 0);
      normals.push(0, 0, 0);
      counts.push(0);
    }
    vertices[index * 3] += x;
    vertices[index * 3 + 1] += y;
    vertices[index * 3 + 2] += z;
    normals[index * 3] += normal.getX(i);
    normals[index * 3 + 1] += normal.getY(i);
    normals[index * 3 + 2] += normal.getZ(i);
    counts[index]++;
    remap.push(index);
  }
  for (let i = 0; i < counts.length; i++) {
    for (let j = 0; j < 3; j++) vertices[i * 3 + j] /= counts[i];
    const n = new THREE.Vector3(
      normals[i * 3],
      normals[i * 3 + 1],
      normals[i * 3 + 2],
    ).normalize();
    normals.splice(i * 3, 3, n.x, n.y, n.z);
  }
  const indices: number[] = [];
  for (let i = 0; i < remap.length; i += 3) {
    const a = remap[i],
      b = remap[i + 1],
      c = remap[i + 2];
    if (a !== b && b !== c && a !== c) indices.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}
/** Assets in this module have decoded +X forward / +Y up; generic inputs must be normalized first. */
export async function parseActorTemplate(
  buffer: ArrayBuffer,
  id: string,
): Promise<AssetTemplatePair> {
  validateBundledGlb(buffer);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  const high = new THREE.Group(),
    distant = new THREE.Group();
  const originals = [gltf.scene];
  try {
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    if (![size.x, size.y, size.z].every((v) => Number.isFinite(v) && v > 1e-5))
      throw new Error("Degenerate actor asset bounds");
    const normalize = new THREE.Matrix4()
      .makeScale(1 / size.x, 1 / size.y, 1 / size.z)
      .multiply(
        new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z),
      );
    const materials = new Map<string, THREE.MeshStandardMaterial>(),
      batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o instanceof THREE.SkinnedMesh)
        throw new Error("Animated actor assets require a separate renderer");
      const transformed = o.geometry
        .clone()
        .applyMatrix4(
          new THREE.Matrix4().multiplyMatrices(normalize, o.matrixWorld),
        );
      const flat = transformed.index
        ? transformed.toNonIndexed()
        : transformed.clone();
      transformed.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material],
        groups = flat.groups.length
          ? flat.groups
          : [
              {
                start: 0,
                count: flat.attributes.position.count,
                materialIndex: 0,
              },
            ];
      for (const range of groups) {
        const original = mats[range.materialIndex ?? 0],
          name = original.name || "paint";
        if (surfaceKind(name) === "lights") {
          const split = splitLamps(flat, range);
          for (const side of ["front", "rear"] as const) {
            if (!split[side]) continue;
            if (!materials.has(`lamp-${side}`))
              materials.set(`lamp-${side}`, createLampMaterial(side));
            const lamp = materials.get(`lamp-${side}`)!;
            const list = batches.get(lamp) ?? [];
            list.push(split[side]!);
            batches.set(lamp, list);
          }
          continue;
        }
        if (!materials.has(name)) materials.set(name, neutralMaterial(name));
        const mat = materials.get(name)!;
        const geometry = new THREE.BufferGeometry();
        for (const attribute of ["position", "normal"]) {
          const source = flat.attributes[attribute];
          if (!source) continue;
          const data: number[] = [];
          for (let i = range.start; i < range.start + range.count; i++)
            data.push(source.getX(i), source.getY(i), source.getZ(i));
          geometry.setAttribute(
            attribute,
            new THREE.Float32BufferAttribute(data, 3),
          );
        }
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        const list = batches.get(mat) ?? [];
        list.push(geometry);
        batches.set(mat, list);
      }
      flat.dispose();
    });
    for (const side of ["front", "rear"] as const)
      if (!materials.has(`lamp-${side}`)) {
        const lamp = createLampMaterial(side);
        materials.set(`lamp-${side}`, lamp);
        batches.set(lamp, [fallbackLamps(side)]);
      }
    for (const [mat, pieces] of batches) {
      const geometry = mergeGeometries(pieces);
      pieces.forEach((p) => p.dispose());
      if (!geometry) throw new Error("Actor geometry could not be batched");
      const near = new THREE.Mesh(geometry, mat),
        far = new THREE.Mesh(distantGeometry(geometry), mat);
      for (const mesh of [near, far]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
      high.add(near);
      distant.add(far);
    }
    high.userData.asset = id;
    distant.userData.asset = id;
    return { high, distant, id };
  } catch (error) {
    disposeObjects([high, distant]);
    throw error;
  } finally {
    disposeObjects(originals);
  }
}
/** One asynchronous load per owning scene; abort disposes every completed late resource. */
export async function loadActorTemplates(
  signal?: AbortSignal,
): Promise<ActorTemplates> {
  checkAbort(signal);
  let sedan: AssetTemplatePair | undefined, suv: AssetTemplatePair | undefined;
  try {
    sedan = await parseActorTemplate(
      decodeInline(`data:model/gltf-binary;base64,${sedanBase64}`),
      "traffic-sedan",
    );
    checkAbort(signal);
    suv = await parseActorTemplate(
      decodeInline(`data:model/gltf-binary;base64,${suvBase64}`),
      "traffic-suv",
    );
    checkAbort(signal);
    return { sedan, suv };
  } catch (error) {
    disposeObjects([
      ...(sedan ? [sedan.high, sedan.distant] : []),
      ...(suv ? [suv.high, suv.distant] : []),
    ]);
    throw error;
  }
}
export function instantiateAssetModel(
  actor: Actor,
  poseAtCenter: boolean,
  templates: ActorTemplates,
): THREE.Group | null {
  if (
    actor.category !== "vehicle.car" ||
    ![actor.length_m, actor.width_m, actor.height_m ?? 1.6].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  )
    return null;
  const pair =
    actor.role === "ego" && templates.ego
      ? templates.ego
      : (actor.height_m ?? 1.6) >= 1.65
        ? templates.suv
        : templates.sedan;
  const root = new THREE.Group(),
    lod = new THREE.LOD(),
    height = actor.height_m ?? 1.6;
  for (const [template, distance] of [
    [pair.high, 0],
    [pair.distant, 42],
  ] as const) {
    const group = template.clone();
    group.scale.set(actor.length_m, height, actor.width_m);
    group.position.y = actor.role === "ego" && !poseAtCenter ? height / 2 : 0;
    lod.addLevel(group, distance, 0.15);
  }
  root.add(lod);
  root.userData.asset = pair.id;
  root.userData.assetCredit =
    pair.high.userData.assetCredit ??
    (pair === templates.sedan || pair === templates.suv
      ? TRAFFIC_MODEL_CREDIT
      : null);
  return root;
}
