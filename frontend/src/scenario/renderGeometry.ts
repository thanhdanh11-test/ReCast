import * as THREE from "three";
/** Presentation-only validation, never edits authoritative map. */
export function validRing(points: number[][]): boolean {
  if (
    points.length < 3 ||
    points.some(
      (p) => p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]),
    )
  )
    return false;
  const ring =
    points.length > 3 &&
    points[0][0] === points.at(-1)![0] &&
    points[0][1] === points.at(-1)![1]
      ? points.slice(0, -1)
      : points;
  if (ring.length < 3) return false;
  const seen = new Set<string>();
  for (const [x, y] of ring) {
    const key = `${x}:${y}`;
    // Includes consecutive duplicates (zero-length edges) and non-adjacent pinches.
    if (seen.has(key)) return false;
    seen.add(key);
  }
  const cross = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: number[], b: number[], p: number[]) =>
    cross(a, b, p) === 0 &&
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
  const intersects = (a: number[], b: number[], c: number[], d: number[]) => {
    const abC = cross(a, b, c),
      abD = cross(a, b, d),
      cdA = cross(c, d, a),
      cdB = cross(c, d, b);
    return (
      (abC * abD < 0 && cdA * cdB < 0) ||
      onSegment(a, b, c) ||
      onSegment(a, b, d) ||
      onSegment(c, d, a) ||
      onSegment(c, d, b)
    );
  };
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      next = ring[(i + 2) % ring.length];
    // Adjacent edges may share their vertex, but cannot retrace one another.
    if (
      cross(a, b, next) === 0 &&
      (b[0] - a[0]) * (next[0] - b[0]) + (b[1] - a[1]) * (next[1] - b[1]) < 0
    )
      return false;
    area += a[0] * b[1] - a[1] * b[0];
    for (let j = i + 2; j < ring.length; j++) {
      if (i === 0 && j === ring.length - 1) continue;
      if (intersects(a, b, ring[j], ring[(j + 1) % ring.length])) return false;
    }
  }
  return Math.abs(area) > 1e-8;
}
export function mapShape(outer: number[][], holes: number[][][]): THREE.Shape {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes = holes.map(
    (h) => new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))),
  );
  return shape;
}
/** Miter joined strip keeps source vertices and clamps acute spikes. */
export function joinedLine(
  points: number[][],
  floor: number,
  width = 0.14,
): THREE.BufferGeometry {
  const clean = points.filter(
      (p, i) =>
        i === 0 ||
        Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-7,
    ),
    vertices: number[] = [],
    indices: number[] = [];
  const normal = (a: number[], b: number[]) => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return l ? [-(b[1] - a[1]) / l, (b[0] - a[0]) / l] : [0, 0];
  };
  for (let i = 0; i < clean.length; i++) {
    const p = clean[i];
    let a = normal(clean[Math.max(0, i - 1)], p),
      b = normal(p, clean[Math.min(clean.length - 1, i + 1)]);
    if (i === 0) a = b;
    if (i === clean.length - 1) b = a;
    let nx = a[0] + b[0],
      ny = a[1] + b[1],
      l = Math.hypot(nx, ny);
    if (l < 1e-6) {
      nx = b[0];
      ny = b[1];
      l = 1;
    }
    nx /= l;
    ny /= l;
    const offset = Math.min(
      width * 2,
      (width * 0.5) / Math.max(0.25, Math.abs(nx * b[0] + ny * b[1])),
    );
    for (const side of [-1, 1])
      vertices.push(
        p[0] + nx * offset * side,
        floor,
        -p[1] - ny * offset * side,
      );
    if (i)
      indices.push(
        (i - 1) * 2,
        (i - 1) * 2 + 1,
        i * 2,
        (i - 1) * 2 + 1,
        i * 2 + 1,
        i * 2,
      );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
export function crossingDirection(points: number[][]): THREE.Vector2 {
  let longest = 0,
    direction = new THREE.Vector2(1, 0);
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > longest) {
      longest = l;
      direction.set((b[0] - a[0]) / l, -(b[1] - a[1]) / l);
    }
  }
  return direction;
}
export function convexRing(points: number[][]): number[][] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    cross = (a: number[], b: number[], c: number[]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list: number[][]) => {
    const out: number[][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 0)
        out.pop();
      out.push(p);
    }
    return out;
  };
  const lower = half(sorted),
    upper = half(sorted.slice().reverse());
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}
