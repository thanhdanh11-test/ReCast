import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Actor } from "./types";
import { vehicleClass } from "./vehicleClass";
import { createLampMaterial, NEUTRAL_PALETTE } from "./vehicleMaterials";

/** A scene owns these resources. Sharing never crosses the disposal boundary. */
export interface ModelResources {
  geometries: Map<string, THREE.BufferGeometry>;
  materials: Map<string, THREE.MeshStandardMaterial>;
  templates: Map<string, THREE.Group>;
}
export function createModelResources(): ModelResources {
  return { geometries: new Map(), materials: new Map(), templates: new Map() };
}
function surface(
  resources: ModelResources,
  key: string,
  color: number,
  roughness = 0.5,
) {
  if (!resources.materials.has(key))
    resources.materials.set(
      key,
      new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness: key === "rim" ? 0.65 : 0.12,
      }),
    );
  return resources.materials.get(key)!;
}

/** Detailed procedural silhouettes, not a claimed manufacturer/annotated body shape. */
function template(
  actor: Actor,
  high: boolean,
  resources: ModelResources,
): THREE.Group {
  const cls = vehicleClass(actor.category);
  const kind =
    cls === "pedestrian"
      ? "person"
      : cls === "bicycle" || cls === "motorcycle"
        ? "bike"
        : cls === "object"
          ? "object"
          : cls === "bus"
            ? "bus"
            : cls === "truck" || cls === "heavy"
              ? "truck"
              : "car";
  // Long buses/trucks get an extra axle; body silhouette otherwise scales with the true box.
  const axles =
    kind === "bus"
      ? actor.length_m > 14
        ? 3
        : 2
      : kind === "truck"
        ? actor.length_m > 8
          ? 3
          : 2
        : 0;
  const rider =
    actor.attributes?.includes("cycle.with_rider") || !actor.attributes;
  const key = `${kind}:${actor.role === "ego"}:${rider}:${high}:${axles}`;
  const cached = resources.templates.get(key);
  if (cached) return cached;
  const group = new THREE.Group();
  const paint = surface(
    resources,
    actor.role === "ego" ? "ego" : "paint",
    actor.role === "ego" ? 0x444444 : NEUTRAL_PALETTE.paint,
    0.34,
  );
  const glass = surface(resources, "glass", NEUTRAL_PALETTE.glass, 0.16);
  const rubber = surface(resources, "rubber", NEUTRAL_PALETTE.rubber, 0.88);
  const rim = surface(resources, "rim", 0x999999, 0.32);
  const trim = surface(resources, "trim", NEUTRAL_PALETTE.trim, 0.34);
  const lampMaterial = (side: "front" | "rear") => {
    const k = `lamp-${side}`;
    if (!resources.materials.has(k))
      resources.materials.set(k, createLampMaterial(side));
    return resources.materials.get(k)!;
  };
  const lampFront = lampMaterial("front"),
    lampRear = lampMaterial("rear");
  const pieces = new Map<THREE.Material, THREE.BufferGeometry[]>();
  function add(
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    position: number[],
    scale = [1, 1, 1],
    rotation?: THREE.Quaternion,
  ) {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      rotation ?? new THREE.Quaternion(),
      new THREE.Vector3(...scale),
    );
    geometry.applyMatrix4(matrix);
    // Match attributes/indexing across primitive types before batching by material.
    const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    flat.deleteAttribute("uv");
    const list = pieces.get(mat) ?? [];
    list.push(flat);
    pieces.set(mat, list);
  }
  function rounded(
    size: number[],
    position: number[],
    mat = paint,
    radius = 0.035,
  ) {
    add(
      new RoundedBoxGeometry(
        size[0],
        size[1],
        size[2],
        high ? 3 : 1,
        Math.min(radius, ...size.map((v) => v * 0.45)),
      ),
      mat,
      position,
    );
  }
  function sphere(position: number[], scale: number[], mat = paint) {
    add(
      new THREE.SphereGeometry(1, high ? 28 : 10, high ? 18 : 7),
      mat,
      position,
      scale,
    );
  }
  function tube(a: number[], b: number[], radius: number, mat = paint) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b),
      d = end.clone().sub(start);
    add(
      new THREE.CylinderGeometry(radius, radius, d.length(), high ? 16 : 8),
      mat,
      start.add(end).multiplyScalar(0.5).toArray(),
      [1, 1, 1],
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        d.normalize(),
      ),
    );
  }
  function limbs(
    centerX: number,
    base: number,
    span: number,
    humanHeight: number,
  ) {
    sphere(
      [centerX, base + humanHeight * 0.91, 0],
      [span * 0.17, humanHeight * 0.085, span * 0.17],
    );
    sphere(
      [centerX, base + humanHeight * 0.63, 0],
      [span * 0.24, humanHeight * 0.23, span * 0.29],
    );
    for (const side of [-1, 1]) {
      const z = side * span * 0.2;
      tube(
        [centerX, base + humanHeight * 0.5, z],
        [centerX, base + humanHeight * 0.08, z],
        span * 0.105,
        rubber,
      );
      rounded(
        [span * 0.42, humanHeight * 0.055, span * 0.22],
        [centerX + span * 0.07, base + humanHeight * 0.04, z],
        rubber,
      );
      tube(
        [centerX, base + humanHeight * 0.79, side * span * 0.28],
        [centerX + span * 0.1, base + humanHeight * 0.47, side * span * 0.4],
        span * 0.085,
      );
      sphere(
        [centerX + span * 0.1, base + humanHeight * 0.46, side * span * 0.4],
        [span * 0.085, humanHeight * 0.04, span * 0.085],
      );
    }
  }
  if (kind === "person") {
    limbs(0, 0, 1, 1);
  } else if (kind === "object") {
    rounded([0.98, 0.98, 0.98], [0, 0.5, 0]);
  } else if (kind === "bike") {
    for (const x of [-0.32, 0.32]) {
      add(
        new THREE.TorusGeometry(1, 0.075, high ? 12 : 6, high ? 48 : 18),
        rubber,
        [x, 0.23, 0],
        [0.16, 0.21, 0.65],
      );
      if (high)
        for (let i = 0; i < 12; i++) {
          const angle = (i * Math.PI) / 6;
          tube(
            [x, 0.23, 0],
            [x + Math.cos(angle) * 0.145, 0.23 + Math.sin(angle) * 0.19, 0],
            0.005,
            rim,
          );
        }
    }
    const rear = [-0.32, 0.23, 0],
      front = [0.32, 0.23, 0],
      crank = [-0.06, 0.28, 0],
      saddle = [-0.14, 0.5, 0],
      stem = [0.22, 0.5, 0];
    for (const [a, b] of [
      [rear, crank],
      [rear, saddle],
      [crank, saddle],
      [saddle, stem],
      [crank, stem],
      [stem, front],
    ])
      tube(a, b, 0.018);
    rounded([0.17, 0.035, 0.2], [-0.15, 0.53, 0], rubber);
    tube([0.22, 0.51, -0.3], [0.22, 0.51, 0.3], 0.014, rubber);
    if (rider) {
      sphere([-0.03, 0.75, 0], [0.07, 0.18, 0.18]);
      sphere([0.02, 0.94, 0], [0.06, 0.06, 0.15]);
      for (const side of [-1, 1]) {
        tube(
          [-0.05, 0.58, side * 0.13],
          [0.06, 0.42, side * 0.22],
          0.038,
          rubber,
        );
        tube(
          [0.06, 0.42, side * 0.22],
          [-0.06, 0.27, side * 0.22],
          0.032,
          rubber,
        );
        tube([0.01, 0.83, side * 0.14], [0.22, 0.53, side * 0.28], 0.027);
      }
    }
  } else if (kind === "bus" || kind === "truck") {
    // Same material language as the bundled GLB cars: rounded paint body, dark glass bands,
    // rubber wheels with trim hubs. Silhouette only; no make, model or livery is claimed.
    const wheelX = kind === "bus" ? (axles === 3 ? 0.03 : 0.045) : 0.05;
    const axleXs =
      kind === "bus"
        ? axles === 3
          ? [0.36, -0.05, -0.38]
          : [0.33, -0.33]
        : axles === 3
          ? [0.38, -0.3, -0.42]
          : [0.38, -0.3];
    if (kind === "bus") {
      rounded([0.98, 0.85, 0.98], [0, 0.545, 0], paint, 0.06);
      for (const side of [-1, 1])
        rounded([0.84, 0.3, 0.012], [-0.02, 0.705, side * 0.492], glass, 0.01);
      rounded([0.012, 0.46, 0.86], [0.493, 0.65, 0], glass, 0.01);
      rounded([0.012, 0.22, 0.7], [-0.493, 0.75, 0], glass, 0.01);
      for (const x of [0.3, -0.05])
        rounded([0.09, 0.62, 0.012], [x, 0.45, 0.493], trim, 0.006);
      if (axles === 3) rounded([0.03, 0.84, 1], [0.12, 0.545, 0], rubber, 0.01);
    } else {
      rounded([0.23, 0.74, 0.96], [0.375, 0.49, 0], paint, 0.05);
      rounded([0.012, 0.3, 0.84], [0.493, 0.66, 0], glass, 0.01);
      for (const side of [-1, 1])
        rounded([0.12, 0.22, 0.012], [0.4, 0.67, side * 0.481], glass, 0.008);
      rounded([0.73, 0.81, 0.98], [-0.125, 0.545, 0], paint, 0.03);
      rounded([1, 0.05, 0.8], [0, 0.14, 0], trim, 0.01);
    }
    for (const side of [-1, 1]) {
      rounded([0.02, 0.08, 0.9], [side * 0.489, 0.17, 0], trim, 0.01);
    }
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    );
    for (const x of axleXs)
      for (const side of [-1, 1]) {
        add(
          new THREE.CylinderGeometry(1, 1, 1, high ? 40 : 12),
          rubber,
          [x, 0.16, side * 0.45],
          [wheelX, 0.07, 0.16],
          q,
        );
        add(
          new THREE.CylinderGeometry(1, 1, 1, high ? 24 : 8),
          trim,
          [x, 0.16, side * 0.487],
          [wheelX * 0.6, 0.012, 0.1],
          q,
        );
      }
    for (const z of [-0.36, 0.36]) {
      rounded(
        [0.012, 0.06, 0.14],
        [0.493, kind === "bus" ? 0.26 : 0.25, z],
        lampFront,
        0.008,
      );
      rounded(
        [0.012, 0.07, 0.12],
        [-0.493, kind === "bus" ? 0.32 : 0.25, z],
        lampRear,
        0.008,
      );
    }
  } else {
    // Curved bonnet/boot and a swept cabin replace stacked cuboids.
    rounded([0.96, 0.3, 0.95], [0, 0.34, 0], paint, 0.08);
    rounded([0.26, 0.13, 0.9], [0.34, 0.51, 0], paint, 0.04);
    rounded([0.23, 0.13, 0.9], [-0.35, 0.49, 0], paint, 0.04);
    const shape = new THREE.Shape();
    shape.moveTo(-0.32, 0.49);
    shape.lineTo(0.3, 0.49);
    shape.quadraticCurveTo(0.24, 0.64, 0.12, 0.85);
    shape.quadraticCurveTo(-0.04, 0.92, -0.21, 0.84);
    shape.quadraticCurveTo(-0.29, 0.68, -0.32, 0.49);
    const cabin = new THREE.ExtrudeGeometry(shape, {
      depth: 0.77,
      bevelEnabled: true,
      bevelSize: 0.018,
      bevelThickness: 0.018,
      bevelSegments: high ? 3 : 1,
      curveSegments: high ? 12 : 4,
      steps: 1,
    });
    cabin.translate(0, 0, -0.385);
    add(cabin, glass, [0, 0, 0]);
    rounded([0.32, 0.045, 0.8], [-0.045, 0.871, 0], paint, 0.02);
    for (const x of [-0.3, 0.3])
      for (const side of [-1, 1]) {
        const q = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          Math.PI / 2,
        );
        add(
          new THREE.CylinderGeometry(1, 1, 1, high ? 48 : 12),
          rubber,
          [x, 0.2, side * 0.435],
          [0.072, 0.095, 0.195],
          q,
        );
        add(
          new THREE.CylinderGeometry(1, 1, 1, high ? 32 : 10),
          rim,
          [x, 0.2, side * 0.486],
          [0.046, 0.015, 0.13],
          q,
        );
      }
    rounded([0.027, 0.075, 0.75], [0.48, 0.415, 0], lampFront, 0.012);
    rounded([0.027, 0.065, 0.75], [-0.48, 0.415, 0], lampRear, 0.012);
    if (high) {
      rounded([0.016, 0.1, 0.56], [0.48, 0.29, 0], rubber, 0.01);
      for (const z of [-0.445, 0.445]) {
        rounded([0.57, 0.012, 0.01], [-0.02, 0.47, z], rim, 0.004);
        rounded([0.055, 0.065, 0.095], [0.14, 0.67, z], paint, 0.015);
        for (const x of [-0.1, 0.14])
          rounded([0.04, 0.012, 0.014], [x, 0.55, z], rim, 0.005);
      }
    }
    if (actor.role === "ego")
      add(
        new THREE.CylinderGeometry(0.044, 0.055, 0.045, high ? 32 : 12),
        glass,
        [-0.04, 0.956, 0],
      );
  }
  for (const [mat, geometries] of pieces) {
    const geometry = mergeGeometries(geometries)!;
    geometries.forEach((g) => g.dispose());
    resources.geometries.set(`${key}:${mat.uuid}`, geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.modelPart = kind;
    group.add(mesh);
  }
  group.userData.detail = high ? "high" : "distant";
  resources.templates.set(key, group);
  return group;
}
export function detailedModel(
  actor: Actor,
  poseAtCenter = false,
  resources = createModelResources(),
): THREE.Group {
  const root = new THREE.Group(),
    lod = new THREE.LOD();
  for (const [high, distance] of [
    [true, 0],
    [false, 42],
  ] as const) {
    const parts = template(actor, high, resources).clone();
    parts.scale.set(actor.length_m, actor.height_m ?? 1.6, actor.width_m);
    parts.position.y =
      actor.role !== "ego" || poseAtCenter ? -(actor.height_m ?? 1.6) / 2 : 0;
    lod.addLevel(parts, distance, 0.15);
  }
  root.add(lod);
  root.userData.asset = "procedural-monochrome-v2";
  return root;
}
