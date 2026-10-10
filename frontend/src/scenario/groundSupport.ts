import * as THREE from "three";
import type { Actor, Pose } from "./types";
import { scenePosition } from "./trajectory";

export interface GroundSupport {
  active?: boolean;
  heightAt(x: number, y: number): number | null;
  surfaceAt(x: number, y: number): number;
}
/** Bounded interpolation of measured, low-residual LiDAR ground cells. */
export function createGroundSupport(
  data: { cell_m: number; samples: number[][] } | undefined,
  fallback: number,
): GroundSupport {
  const cells = new Map<string, number[][]>();
  for (const row of data?.samples ?? []) {
    if (
      row.length < 5 ||
      !row.every(Number.isFinite) ||
      row[3] < (row[5] === 1 ? 2 : 8) ||
      row[4] < 0 ||
      row[4] > 0.15
    )
      continue;
    const key = `${Math.floor(row[0] / 3)}:${Math.floor(row[1] / 3)}`;
    const list = cells.get(key) ?? [];
    list.push(row);
    cells.set(key, list);
  }
  function estimateHeightAt(x: number, y: number): number | null {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const ix = Math.floor(x / 3),
      iy = Math.floor(y / 3),
      near: { z: number; distance: number }[] = [];
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++)
        for (const r of cells.get(`${ix + dx}:${iy + dy}`) ?? []) {
          const distance = Math.hypot(r[0] - x, r[1] - y);
          if (distance <= 8) near.push({ z: r[2], distance });
        }
    near.sort((a, b) => a.distance - b.distance);
    if (!near.length) return null;
    const selected = near.slice(0, 6);
    // A single measured plane is usable in its immediate support; no far extrapolation.
    if (selected.length < 2 && selected[0].distance > 1) return null;
    if (
      Math.max(...selected.map((p) => p.z)) -
        Math.min(...selected.map((p) => p.z)) >
      1.2
    )
      return null;
    if (selected[0].distance > 2) {
      const points: [number, number][] = [];
      for (let dx = -3; dx <= 3; dx++)
        for (let dy = -3; dy <= 3; dy++)
          for (const r of cells.get(`${ix + dx}:${iy + dy}`) ?? []) {
            if (Math.hypot(r[0] - x, r[1] - y) <= 8) points.push([r[0], r[1]]);
          }
      points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (a: number[], b: number[], c: number[]) =>
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const half = (list: [number, number][]) => {
        const h: [number, number][] = [];
        for (const p of list) {
          while (
            h.length >= 2 &&
            cross(h[h.length - 2], h[h.length - 1], p) <= 0
          )
            h.pop();
          h.push(p);
        }
        h.pop();
        return h;
      };
      const hull = [...half(points), ...half([...points].reverse())];
      if (
        hull.length < 3 ||
        hull.some(
          (a, i) => cross(a, hull[(i + 1) % hull.length], [x, y]) < -1e-6,
        )
      )
        return null;
    }
    return computeSurfaceAt(x, y);
  }
  // A compact smooth kernel fades to the unobserved flat backdrop without height cliffs.
  function computeSurfaceAt(x: number, y: number): number {
    const ix = Math.floor(x / 3),
      iy = Math.floor(y / 3);
    let weight = 0,
      height = 0;
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++)
        for (const r of cells.get(`${ix + dx}:${iy + dy}`) ?? []) {
          const d2 = (r[0] - x) ** 2 + (r[1] - y) ** 2;
          if (d2 >= 64) continue;
          const w = (1 - d2 / 64) ** 3 * (r[5] === 1 ? 0.3 : 1);
          weight += w;
          height += w * r[2];
        }
    if (!weight) return fallback;
    const confidence = Math.min(1, weight / 0.05);
    return (confidence * height) / weight + (1 - confidence) * fallback;
  }
  const heightCache = new Map<string, number | null>();
  function heightAt(x: number, y: number): number | null {
    const key = `${x}:${y}`;
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    const value = estimateHeightAt(x, y);
    if (heightCache.size >= 4096) heightCache.clear();
    heightCache.set(key, value);
    return value;
  }
  const surfaceCache = new Map<string, number>();
  return {
    active: cells.size > 0,
    heightAt,
    surfaceAt: (x, y) => {
      const key = `${x}:${y}`;
      const cached = surfaceCache.get(key);
      if (cached !== undefined) return cached;
      const value = computeSurfaceAt(x, y);
      if (surfaceCache.size >= 200000) surfaceCache.clear();
      surfaceCache.set(key, value);
      return value;
    },
  };
}
export function contactPosition(
  actor: Actor,
  pose: Pose,
  mode: string | undefined,
  ground: GroundSupport,
  modelMinY: number,
  tilt: [number, number] = [0, 0],
): [number, number, number] {
  if (mode !== "source" || !Number.isFinite(actor.height_m ?? 1.6))
    return scenePosition(pose);
  // Source playback is a visual reconstruction: the rendered surface, including its
  // explicitly disclosed fallback, owns display contact. Raw annotations remain intact.
  const z = ground.surfaceAt(pose.x_m, pose.y_m);
  if (!Number.isFinite(z) || !Number.isFinite(modelMinY)) return scenePosition(pose);
  let height = z - modelMinY;
  if (Number.isFinite(actor.length_m) && Number.isFinite(actor.width_m)) {
    // Contact is evaluated AFTER pitch/roll: rotating a model about its centre moves
    // its underside. Fit the wheel support rectangle used by contactTilt, rather than
    // the body overhangs (which incorrectly lift every wheel on a curved road).
    const rotation = new THREE.Euler(tilt[0], pose.yaw_rad, tilt[1], "YZX");
    height = -Infinity;
    const vehicle = actor.category.startsWith("vehicle.");
    const halfLength = actor.length_m * (vehicle ? 0.3 : 0.5);
    const halfWidth = actor.width_m * (vehicle ? 0.4 : 0.5);
    for (const x of [-halfLength, halfLength])
      for (const z of [-halfWidth, halfWidth]) {
        const foot = new THREE.Vector3(x, modelMinY, z).applyEuler(rotation);
        const surface = ground.surfaceAt(pose.x_m + foot.x, pose.y_m - foot.z);
        if (!Number.isFinite(surface)) return scenePosition(pose);
        height = Math.max(height, surface - foot.y);
      }
  }
  return [pose.x_m, height, -pose.y_m];
}
/** Subdivide and sample a shared height field; UVs retained for crossing shaders. */
export function drapeGeometry(
  input: THREE.BufferGeometry,
  ground: GroundSupport,
  offset: number,
  maxTriangles = 100000,
): THREE.BufferGeometry {
  const source = input.index ? input.toNonIndexed() : input.clone(),
    a = source.getAttribute("position"),
    uv = source.getAttribute("uv");
  type Vertex = { x: number; z: number; u: number; v: number; h: number };
  const vertex = (x: number, z: number, u = 0, v = 0): Vertex => ({
    x,
    z,
    u,
    v,
    h: ground.surfaceAt(x, -z),
  });
  // Adaptive split decided per EDGE from its endpoints only: edges > 4 m (half the 8 m terrain
  // kernel) always split; 1–4 m edges split only where the midpoint misses linear interpolation
  // by > 2 cm. A triangle with any marked edge is bisected on its LONGEST edge, which is then
  // marked too so neighbours follow (longest-edge propagation). Passes repeat until no edge of
  // any triangle is marked: shared edges — also across separately triangulated surfaces — are
  // split identically (no T-junction cracks), angles stay bounded and only edges > 1 m split.
  const midpoints = new Map<string, Vertex | null>();
  const edgeKey = (p: Vertex, q: Vertex) => {
    const a = `${p.x},${p.z}`,
      b = `${q.x},${q.z}`;
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const middle = (p: Vertex, q: Vertex) =>
    vertex((p.x + q.x) / 2, (p.z + q.z) / 2, (p.u + q.u) / 2, (p.v + q.v) / 2);
  const marked = (p: Vertex, q: Vertex): boolean => {
    const key = edgeKey(p, q);
    if (!midpoints.has(key)) {
      const d2 = (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
      let m: Vertex | null = null;
      if (d2 > 1) {
        const c = middle(p, q);
        if (d2 > 16 || Math.abs(c.h - (p.h + q.h) / 2) > 0.02) m = c;
      }
      midpoints.set(key, m);
    }
    return midpoints.get(key) !== null;
  };
  let triangles: Vertex[][] = [];
  for (let i = 0; i < a.count; i += 3)
    triangles.push(
      [0, 1, 2].map((j) =>
        vertex(a.getX(i + j), a.getZ(i + j), uv?.getX(i + j), uv?.getY(i + j)),
      ),
    );
  const budget = () => {
    if (!(triangles.length <= maxTriangles)) {
      source.dispose();
      throw new Error("Terrain subdivision budget exceeded");
    }
  };
  for (let changed = true; changed;) {
    budget();
    changed = false;
    const next: Vertex[][] = [];
    for (const t of triangles) {
      if (![0, 1, 2].some((i) => marked(t[i], t[(i + 1) % 3]))) {
        next.push(t);
        continue;
      }
      changed = true;
      const lengths = [0, 1, 2].map(
        (i) =>
          (t[i].x - t[(i + 1) % 3].x) ** 2 + (t[i].z - t[(i + 1) % 3].z) ** 2,
      );
      const i = lengths.indexOf(Math.max(...lengths)),
        j = (i + 1) % 3,
        k = (i + 2) % 3,
        key = edgeKey(t[i], t[j]);
      const m = midpoints.get(key) ?? middle(t[i], t[j]);
      midpoints.set(key, m);
      next.push([t[i], m, t[k]], [m, t[j], t[k]]);
    }
    triangles = next;
  }
  const done = triangles;
  budget();
  source.dispose();
  const positions: number[] = [],
    uvs: number[] = [];
  for (const t of done)
    for (const v of t) {
      positions.push(v.x, v.h + offset, v.z);
      if (uv) uvs.push(v.u, v.v);
    }
  const result = new THREE.BufferGeometry();
  result.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  if (uvs.length)
    result.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  result.computeVertexNormals();
  return result;
}

/** Display-only pitch/roll from supported terrain; original pose/yaw and replay remain untouched. */
export function contactTilt(
  actor: Actor,
  pose: Pose,
  mode: string | undefined,
  ground: GroundSupport,
  modelMinY: number,
): [number, number] {
  if (mode !== "source" || !actor.category.startsWith("vehicle.") || !Number.isFinite(modelMinY))
    return [0, 0];
  const c = Math.cos(pose.yaw_rad),
    s = Math.sin(pose.yaw_rad),
    l = actor.length_m * 0.3,
    w = actor.width_m * 0.4;
  const front = ground.surfaceAt(pose.x_m + c * l, pose.y_m + s * l),
    back = ground.surfaceAt(pose.x_m - c * l, pose.y_m - s * l);
  const left = ground.surfaceAt(pose.x_m - s * w, pose.y_m + c * w),
    right = ground.surfaceAt(pose.x_m + s * w, pose.y_m - c * w);
  if (![front, back, left, right].every(Number.isFinite))
    return [0, 0];
  const clamp = (v: number) => Math.max(-0.15, Math.min(0.15, v));
  return [
    clamp(Math.atan2(left - right, 2 * w)),
    clamp(Math.atan2(front - back, 2 * l)),
  ];
}
