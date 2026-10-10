import * as THREE from "three";
import type { GroundSupport } from "./groundSupport";
import type { Pose } from "./types";

/** The translucent corridor follows observed/reference ego samples, not a navigation planner. */
export function createDrivingOverlay(
  scene: THREE.Scene,
  floor: number,
  width: number,
  ground?: GroundSupport,
) {
  const capacity = 242,
    positions = new Float32Array(capacity * 3),
    colors = new Float32Array(capacity * 4),
    tint = new THREE.Color(0xa5dcec),
    indices: number[] = [];
  for (let i = 1; i < capacity / 2; i++)
    indices.push(
      (i - 1) * 2,
      (i - 1) * 2 + 1,
      i * 2,
      (i - 1) * 2 + 1,
      i * 2 + 1,
      i * 2,
    );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  // RGBA per vertex: strongest at the ego, fading to zero at the lead vehicle / path end.
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  const corridor = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -10,
      polygonOffsetUnits: -10,
    }),
  );
  corridor.frustumCulled = false;
  corridor.renderOrder = 4;
  scene.add(corridor);
  const ranges = new THREE.Group(),
    lineMaterial = new THREE.LineBasicMaterial({
      color: 0xa5dcec,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
  for (const radius of [20, 40, 60]) {
    const points = Array.from(
      { length: 129 },
      (_, i) =>
        new THREE.Vector3(
          Math.cos((i * Math.PI) / 64) * radius,
          0,
          Math.sin((i * Math.PI) / 64) * radius,
        ),
    );
    const ring = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      lineMaterial,
    );
    ranges.add(ring);
  }
  scene.add(ranges);
  const crossbar = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -width),
      new THREE.Vector3(0, 0, width),
    ]),
    new THREE.LineBasicMaterial({
      color: 0xb9ecf4,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  crossbar.visible = false;
  scene.add(crossbar);
  function update(
    pose: Pose | null,
    rows: Pose[],
    maxGap: number,
    leadPose?: Pose,
    /** Path distance from the ego centre to the lead vehicle's rear (gap + ego length / 2). */
    leadDistanceM?: number,
  ) {
    ranges.visible = !!pose;
    corridor.visible = !!pose;
    crossbar.visible = !!leadPose;
    if (!pose) {
      geometry.setDrawRange(0, 0);
      return 0;
    }
    ranges.position.set(pose.x_m, 0, -pose.y_m);
    ranges.children.forEach((object) => {
      const line = object as THREE.Line;
      const a = line.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        a.setY(
          i,
          (ground?.surfaceAt(pose.x_m + a.getX(i), pose.y_m - a.getZ(i)) ??
            floor) + 0.055,
        );
      }
      a.needsUpdate = true;
    });
    const limit = Math.min(60, leadDistanceM ?? 60);
    const path = [pose],
      along = [0];
    let distance = 0,
      previous = pose;
    for (const row of rows) {
      if (row.t_s <= pose.t_s) continue;
      if (row.t_s - previous.t_s > maxGap) break;
      const step = Math.hypot(row.x_m - previous.x_m, row.y_m - previous.y_m);
      if (path.length >= capacity / 2) break;
      if (distance + step >= limit) {
        // End exactly at the limit instead of the last sample before it.
        const k = step > 0 ? (limit - distance) / step : 0;
        if (limit - distance > 0.01)
          path.push({
            ...row,
            x_m: previous.x_m + (row.x_m - previous.x_m) * k,
            y_m: previous.y_m + (row.y_m - previous.y_m) * k,
          });
        along.push(limit);
        distance = limit;
        break;
      }
      distance += step;
      if (step > 0.01) {
        path.push(row);
        along.push(distance);
      }
      previous = row;
    }
    if (along.length > path.length) along.length = path.length;
    const fadeLength = leadDistanceM ?? distance;
    path.forEach((p, i) => {
      const nx = -Math.sin(p.yaw_rad),
        ny = Math.cos(p.yaw_rad);
      for (const [j, side] of [
        [0, -1],
        [1, 1],
      ]) {
        const k = (i * 2 + j) * 3;
        positions[k] = p.x_m + nx * width * 0.65 * side;
        positions[k + 1] =
          (ground?.surfaceAt(
            positions[k],
            -(-p.y_m - ny * width * 0.65 * side),
          ) ?? floor) + 0.045;
        positions[k + 2] = -p.y_m - ny * width * 0.65 * side;
        const alpha =
          fadeLength > 0
            ? 0.6 * Math.pow(1 - Math.min(along[i] / fadeLength, 1), 1.5)
            : 0;
        colors.set([tint.r, tint.g, tint.b, alpha], (i * 2 + j) * 4);
      }
    });
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.position.needsUpdate = true;
    geometry.setDrawRange(0, Math.max(0, path.length - 1) * 6);
    if (leadPose) {
      crossbar.position.set(
        leadPose.x_m,
        (ground?.surfaceAt(leadPose.x_m, leadPose.y_m) ?? floor) + 0.07,
        -leadPose.y_m,
      );
      crossbar.rotation.y = pose.yaw_rad;
    }
    /** Drawn corridor length along the path (m). */
    return distance;
  }
  return { update };
}
