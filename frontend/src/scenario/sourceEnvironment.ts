import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Environment } from "./types";
import { pastelColor } from "./pastelStyle";
import {
  createGroundSupport,
  drapeGeometry,
  type GroundSupport,
} from "./groundSupport";
import {
  crossingDirection,
  joinedLine,
  mapShape,
  validRing,
  convexRing,
} from "./renderGeometry";

/** Splits environment diagnostics: source-map geometry defects vs terrain-drape flat fallbacks. */
export function environmentIssues(group: THREE.Object3D): {
  geometryIssues: number;
  flatFallbacks: number;
} {
  let geometryIssues = 0,
    flatFallbacks = 0;
  group.traverse((object) => {
    geometryIssues += object.userData.geometryDiagnostics?.length ?? 0;
    flatFallbacks += object.userData.terrainDiagnostics?.length ?? 0;
  });
  return { geometryIssues, flatFallbacks };
}

/** Contact notice for source mode; flat fallbacks are disclosed here, never as map errors. */
export function formatContactNotice(
  grounded: number,
  unknownGround: number,
  flatFallbacks: number,
): string {
  return `Cao độ hiển thị theo nền ước lượng LiDAR / hộp 3D · ${grounded} đối tượng có hỗ trợ${unknownGround ? ` · ${unknownGround} bám nền hiển thị dự phòng (chưa đủ hỗ trợ đo)` : ""}${flatFallbacks ? ` · ${flatFallbacks} mặt nền phẳng dự phòng (không dựng được lưới địa hình)` : ""}`;
}

export function sourceEnvironment(
  env: Environment,
  floor: number,
  ground: GroundSupport = createGroundSupport(env.presentation?.ground, floor),
): THREE.Group {
  const group = new THREE.Group(),
    diagnostics: string[] = [];
  group.userData.provenance = [
    "presentation-only: neutral road support; joined source lines; geometry-oriented crossings; cosmetic facade/bevel/foliage",
  ];
  group.userData.geometryDiagnostics = diagnostics;
  // Mesh-budget fallbacks are a presentation limit, not a source-map defect.
  const terrainDiagnostics: string[] = [];
  group.userData.terrainDiagnostics = terrainDiagnostics;
  const presentation = env.presentation;
  const pastel = presentation?.style === "pastel-v1";
  group.userData.contactDiagnostics = presentation?.diagnostics ?? [];
  diagnostics.push(
    ...(presentation?.diagnostics.filter((s) => s.startsWith("polygon ")) ??
      []),
  );
  let terrainTriangles = 0;
  const surface = (geometry: THREE.BufferGeometry, offset: number) => {
    if (!presentation?.ground.samples.length || ground.active === false) {
      geometry.translate(0, floor + offset, 0);
      return geometry;
    }
    try {
      const result = drapeGeometry(
        geometry,
        ground,
        offset,
        250000 - terrainTriangles,
      );
      terrainTriangles += result.attributes.position.count / 3;
      geometry.dispose();
      return result;
    } catch (error) {
      terrainDiagnostics.push(
        `Terrain drape failed (${error instanceof Error ? error.message : String(error)}); flat fallback retained`,
      );
      geometry.translate(0, floor + offset, 0);
      return geometry;
    }
  };
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (key: string, color: number, offset = 0) => {
    if (!materials.has(key)) {
      const m = new THREE.MeshStandardMaterial({
        color: pastel ? pastelColor(color) : color,
        roughness: pastel ? 1 : 0.88,
        side: THREE.DoubleSide,
        polygonOffset: offset !== 0,
        polygonOffsetFactor: offset,
        polygonOffsetUnits: offset,
      });
      if (key === "road") {
        m.userData.roadSurface = true;
        m.userData.dryRoughness = pastel ? 1 : 0.88;
      }
      materials.set(key, m);
    }
    return materials.get(key)!;
  };
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const batch = (g: THREE.BufferGeometry, mat: THREE.Material) => {
    const flat = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    flat.deleteAttribute("uv");
    const list = batches.get(mat) ?? [];
    list.push(flat);
    batches.set(mat, list);
  };
  for (const [index, p] of (presentation?.surfaces ?? env.polygons).entries()) {
    // nuScenes stop_line polygons denote stopping regions, not painted pavement.
    // Preserve source semantics; do not fill them or invent a stripe from their boundary.
    if (p.kind === "stop_line") continue;
    if (!validRing(p.outer) || p.holes.some((h) => !validRing(h))) {
      diagnostics.push(
        `polygon ${index} (${p.kind}): invalid ring omitted; authoritative map unchanged`,
      );
      continue;
    }
    const shape = mapShape(p.outer, p.holes),
      road = ["drivable_area", "road_segment", "lane"].includes(p.kind),
      g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const elevation =
      p.kind === "background"
        ? -0.04
        : p.kind === "walkway"
          ? 0.045
          : p.kind === "ped_crossing"
            ? 0.012
            : 0;
    const draped = surface(g, elevation);
    // Same color/material across drivable support eliminates competing lane fills; real holes remain.
    batch(
      draped,
      p.kind === "background"
        ? material("background", 0xe7e7e7)
        : road
          ? material("road", 0x626262)
          : p.kind === "walkway"
            ? material("walkway", 0xcdcdcd, -2)
            : p.kind === "ped_crossing"
              ? material("road", 0x626262)
              : material("other", 0x777777),
    );
    if (p.kind === "ped_crossing") {
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      const direction = crossingDirection(p.outer),
        mat = new THREE.MeshStandardMaterial({
          color: 0xfafafa,
          roughness: 0.8,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -8,
          polygonOffsetUnits: -8,
        });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.stripeDirection = { value: direction };
        shader.vertexShader =
          "varying vec3 stripePosition;\n" +
          shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nstripePosition = position;",
          );
        shader.fragmentShader =
          "varying vec3 stripePosition;\nuniform vec2 stripeDirection;\n" +
          shader.fragmentShader.replace(
            "#include <clipping_planes_fragment>",
            "#include <clipping_planes_fragment>\nif(mod(dot(stripePosition.xz,stripeDirection),1.3)>.65) discard;",
          );
      };
      mat.customProgramCacheKey = () => "map-crossing-direction-v2";
      const mesh = new THREE.Mesh(surface(g, 0.026), mat);
      mesh.renderOrder = 3;
      mesh.receiveShadow = true;
      mesh.userData.crossingDirection = direction.toArray();
      group.add(mesh);
    }
  }
  for (const l of presentation?.lines ?? env.lines)
    if (l.points.length > 1)
      batch(
        surface(joinedLine(l.points, 0), 0.03),
        material("markings", 0xf7f7f7, -8),
      );
  for (const [index, b] of (
    presentation?.buildings ?? env.buildings
  ).entries()) {
    const points = validRing(b.polygon) ? b.polygon : convexRing(b.polygon);
    if (!validRing(b.polygon))
      diagnostics.push(
        `building ${index}: invalid estimated footprint; presentation conservative hull`,
      );
    if (!validRing(points)) continue;
    const bases = points
      .map(([x, y]) => ground.heightAt(x, y))
      .filter((z): z is number => z !== null);
    const base = bases.length ? Math.min(b.base_z, ...bases) : b.base_z;
    const displayHeight = b.height + b.base_z - base;
    const g = new THREE.ExtrudeGeometry(
      mapShape(points, (b as { holes?: number[][][] }).holes ?? []),
      {
        depth: displayHeight,
        bevelEnabled: true,
        bevelSegments: 3,
        steps: 1,
        bevelSize: 0.045,
        bevelThickness: 0.045,
      },
    );
    g.rotateX(-Math.PI / 2);
    g.translate(0, base, 0);
    batch(g, material("building", 0xdadada));
    if (pastel) continue;
    // Decorative facade patches are deliberately separate from source geometry and collision envelopes.
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        c = points[(i + 1) % points.length],
        length = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (length < 2) continue;
      const dx = (c[0] - a[0]) / length,
        dy = (c[1] - a[1]) / length;
      for (let z = 2; z < b.height - 0.5; z += 3) {
        const vertices: number[] = [],
          indices: number[] = [];
        for (let t = 0.6; t < length - 0.8; t += 2.4) {
          const end = Math.min(t + 1.5, length - 0.4),
            base = vertices.length / 3;
          for (const [d, h] of [
            [t, z],
            [end, z],
            [t, z + 1],
            [end, z + 1],
          ])
            vertices.push(a[0] + dx * d, b.base_z + h, -a[1] - dy * d);
          indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        if (vertices.length) {
          const g = new THREE.BufferGeometry();
          g.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(vertices, 3),
          );
          g.setIndex(indices);
          g.computeVertexNormals();
          batch(g, material("facade", 0xb8b8b8, -3));
        }
      }
    }
  }
  const treeRows = presentation?.trees ?? env.trees,
    poleRows = presentation?.poles ?? env.poles;
  // Smooth instanced foliage keeps hundreds of trees at two draw calls.
  if (treeRows.length) {
    const trunks = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.18, 0.24, 1, 20),
        material("trunk", 0x999999),
        treeRows.length,
      ),
      crowns = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 28, 18),
        material("crown", 0xbebebe),
        treeRows.length,
      ),
      transform = new THREE.Object3D();
    treeRows.forEach((t, i) => {
      transform.position.set(
        t.x,
        (ground.heightAt(t.x, t.y) ?? t.z) + t.height * 0.325,
        -t.y,
      );
      transform.scale.set(1, t.height * 0.65, 1);
      transform.updateMatrix();
      trunks.setMatrixAt(i, transform.matrix);
      transform.position.set(
        t.x,
        (ground.heightAt(t.x, t.y) ?? t.z) + t.height * 0.68,
        -t.y,
      );
      transform.scale.set(t.crown_radius, t.height * 0.32, t.crown_radius);
      transform.updateMatrix();
      crowns.setMatrixAt(i, transform.matrix);
    });
    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    group.add(trunks, crowns);
  }
  if (poleRows.length) {
    const poles = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.09, 0.12, 1, 16),
        material("pole", 0xb8b8b8),
        poleRows.length,
      ),
      transform = new THREE.Object3D();
    poleRows.forEach((p, i) => {
      transform.position.set(
        p.x,
        (ground.heightAt(p.x, p.y) ?? p.z) + p.height / 2,
        -p.y,
      );
      transform.scale.set(1, p.height, 1);
      transform.updateMatrix();
      poles.setMatrixAt(i, transform.matrix);
    });
    group.add(poles);
  }
  // Plan36: road-edge structures as an open steel frame (posts, rails, lattice when tall),
  // standing on the same draped road support as the carriageway.
  const beam = (a: THREE.Vector3, b: THREE.Vector3, size: number) => {
    const direction = b.clone().sub(a),
      length = direction.length();
    if (length < 0.05) return;
    const g = new THREE.BoxGeometry(size, size, length);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        direction.normalize(),
      ),
    );
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    batch(g, material("structure", 0x7d8288));
  };
  for (const barrier of env.barriers ?? []) {
    const at = (i: number, h: number) => {
      const [x, y] = barrier.points[i];
      return new THREE.Vector3(x, ground.surfaceAt(x, y) + h, -y);
    };
    const n = barrier.points.length;
    for (let i = 0; i + 1 < n; i++) {
      const h0 = barrier.heights[i],
        h1 = barrier.heights[i + 1];
      beam(at(i, h0), at(i + 1, h1), 0.12);
      beam(at(i, Math.min(1, h0 * 0.5)), at(i + 1, Math.min(1, h1 * 0.5)), 0.08);
      if (h0 > 2.2 && h1 > 2.2) {
        beam(at(i, 0.15), at(i + 1, 0.15), 0.1);
        beam(at(i, i % 2 ? h0 : 0.15), at(i + 1, i % 2 ? 0.15 : h1), 0.07);
      }
    }
    for (let i = 0; i < n; i += 2) beam(at(i, 0), at(i, barrier.heights[i]), 0.14);
  }
  for (const overhead of env.overheads ?? []) {
    if (!validRing(overhead.polygon)) continue;
    const xs = overhead.polygon.map((q) => q[0]),
      ys = overhead.polygon.map((q) => q[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length,
      cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const underside = ground.surfaceAt(cx, cy) + overhead.underside_above_road_m;
    const g = new THREE.ExtrudeGeometry(mapShape(overhead.polygon, []), {
      depth: 0.8,
      bevelEnabled: false,
    });
    g.rotateX(-Math.PI / 2);
    g.translate(0, underside, 0);
    batch(g, material("structure", 0x7d8288));
  }
  for (const island of presentation?.landscape ?? []) {
    if (!validRing(island.polygon) || island.holes.some((h) => !validRing(h))) {
      diagnostics.push("landscape: invalid ring omitted");
      continue;
    }
    const flat = new THREE.ShapeGeometry(mapShape(island.polygon, island.holes));
    flat.rotateX(-Math.PI / 2);
    try {
      const geometry = drapeGeometry(flat, ground, 0.006, 25000);
      batch(geometry, material("planting", 0xcbd8b1, -1));
    } catch (error) {
      terrainDiagnostics.push(`Landscape drape failed: ${String(error)}`);
    } finally {
      flat.dispose();
    }
  }
  for (const [mat, list] of batches) {
    const g = mergeGeometries(list)!;
    list.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = mat === materials.get("building");
    mesh.renderOrder = mat === materials.get("markings") ? 3 : 0;
    group.add(mesh);
  }
  return group;
}
