export interface ProjectedEdgePoint {
  u: number;
  v: number;
}

export interface ProjectedEdgeLike {
  p1: ProjectedEdgePoint;
  p2: ProjectedEdgePoint;
}

const SHORT_NAME_LOOKUP: Record<string, string> = {
  car: 'car',
  truck: 'truck',
  bus: 'bus',
  trailer: 'trailer',
  cons: 'cons',
  construction_vehicle: 'cons',
  construction: 'cons',
  ped: 'ped',
  pedestrian: 'ped',
  moto: 'moto',
  motorcycle: 'moto',
  bike: 'bike',
  bicycle: 'bike',
  cone: 'cone',
  traffic_cone: 'cone',
  trafficcone: 'cone',
  barrier: 'barrier',
};

/**
 * Convert full or hierarchical class label to short label according to SPEC-P02 §2:
 * - car, truck, bus, trailer
 * - cons (construction_vehicle)
 * - ped (pedestrian)
 * - moto (motorcycle)
 * - bike (bicycle)
 * - cone (traffic_cone)
 * - barrier
 * Nhãn lạ thì trả nguyên nhãn.
 */
export function shortLabel(label: string): string {
  if (!label || typeof label !== 'string') return label;

  const raw = label.trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();

  // 1. Direct match
  if (SHORT_NAME_LOOKUP[lower]) {
    return SHORT_NAME_LOOKUP[lower];
  }

  // 2. Check dot-separated parts (e.g. human.pedestrian.adult, vehicle.car) from right to left
  const dotParts = lower.split('.');
  for (let i = dotParts.length - 1; i >= 0; i--) {
    const part = dotParts[i];
    if (SHORT_NAME_LOOKUP[part]) {
      return SHORT_NAME_LOOKUP[part];
    }
  }

  // 3. Check substring match in dot-separated parts
  for (let i = dotParts.length - 1; i >= 0; i--) {
    const part = dotParts[i];
    if (part.includes('pedestrian')) return 'ped';
    if (part.includes('motorcycle')) return 'moto';
    if (part.includes('bicycle')) return 'bike';
    if (part.includes('trafficcone') || part.includes('traffic_cone')) return 'cone';
    if (part.includes('construction')) return 'cons';
    if (part === 'car') return 'car';
    if (part === 'truck') return 'truck';
    if (part === 'bus') return 'bus';
    if (part === 'trailer') return 'trailer';
    if (part === 'barrier') return 'barrier';
  }

  // 4. Unknown label -> return original
  return label;
}

/**
 * Determine if a projected 3D box on camera image has long edge >= 40 px (SPEC-P02 §2).
 * Checks both bounding box dimension (max(width, height)) and max segment length.
 */
export function isBoxLongEdgeAtLeast40(edges: ProjectedEdgeLike[]): boolean {
  if (!edges || edges.length === 0) return false;

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  let maxEdgeLen = 0;

  for (const edge of edges) {
    minU = Math.min(minU, edge.p1.u, edge.p2.u);
    maxU = Math.max(maxU, edge.p1.u, edge.p2.u);
    minV = Math.min(minV, edge.p1.v, edge.p2.v);
    maxV = Math.max(maxV, edge.p1.v, edge.p2.v);

    const len = Math.hypot(edge.p2.u - edge.p1.u, edge.p2.v - edge.p1.v);
    if (len > maxEdgeLen) {
      maxEdgeLen = len;
    }
  }

  const bboxW = maxU - minU;
  const bboxH = maxV - minV;
  return Math.max(bboxW, bboxH, maxEdgeLen) >= 40;
}
