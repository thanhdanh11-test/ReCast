import { Box3D, ObjectsDenseData, DenseObjectEntry } from './types';

/**
 * Generate mock objects_dense data for testing and offline preview.
 * Guarantees at least 3 distinct objects with valid contiguous points,
 * aligned to 28 bytes (7 float32 channels: x, y, z, intensity, r, g, b).
 * Includes both RGB-colored points (r >= 0) and grayscale points (r < 0).
 */
export function getMockObjectsDense(boxes: Box3D[]): ObjectsDenseData {
  // Ensure we have at least 3 objects
  const targetBoxes: { id: string; track_key: string; cx: number; cy: number; cz: number; l: number; w: number; h: number }[] = [];

  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    targetBoxes.push({
      id: b.id,
      track_key: b.track_key || `inst:mock_obj_${i}`,
      cx: b.cx,
      cy: b.cy,
      cz: b.cz,
      l: b.l,
      w: b.w,
      h: b.h,
    });
  }

  // If fewer than 3 boxes, fill with synthetic objects to guarantee >= 3 objects
  const syntheticFallbacks = [
    { id: 'gt:mock_obj_01', track_key: 'inst:mock_car_01', cx: 2.0, cy: 10.0, cz: -0.5, l: 4.5, w: 2.0, h: 1.6 },
    { id: 'gt:mock_obj_02', track_key: 'inst:mock_truck_02', cx: -5.0, cy: 18.0, cz: 0.0, l: 7.2, w: 2.5, h: 2.8 },
    { id: 'gt:mock_obj_03', track_key: 'inst:mock_ped_03', cx: 4.0, cy: 8.0, cz: -0.8, l: 0.8, w: 0.8, h: 1.7 },
  ];

  while (targetBoxes.length < 3) {
    targetBoxes.push(syntheticFallbacks[targetBoxes.length]);
  }

  // Pre-configured point counts for the 3+ objects
  const counts = [120, 150, 100, 80, 90];
  const objects: DenseObjectEntry[] = [];

  let currentStart = 0;
  let totalPointsCount = 0;

  for (let i = 0; i < targetBoxes.length; i++) {
    const cnt = counts[i % counts.length];
    objects.push({
      id: targetBoxes[i].id,
      track_key: targetBoxes[i].track_key,
      start: currentStart,
      count: cnt,
      n_frames: 10 + i * 2,
      rigid: true,
    });
    currentStart += cnt;
    totalPointsCount += cnt;
  }

  const pointsBuffer = new Float32Array(totalPointsCount * 7);

  for (let i = 0; i < targetBoxes.length; i++) {
    const box = targetBoxes[i];
    const obj = objects[i];

    for (let p = 0; p < obj.count; p++) {
      const globalIdx = obj.start + p;
      const offset = globalIdx * 7;

      // Distribute points within the box volume
      // Skip the bottom 0.15m per SPEC-P06 §2
      const u = (p % 10) / 10 - 0.5;
      const v = (Math.floor(p / 10) % 10) / 10 - 0.5;
      const w = p / obj.count - 0.5;

      const px = box.cx + u * (box.l * 0.9);
      const py = box.cy + v * (box.w * 0.9);
      const pz = box.cz + w * (box.h * 0.85);

      const intensity = 100 + ((p * 17) % 155);

      // Half the points have RGB colors, half have r = -1 to test intensity/grayscale fallback
      const hasColor = p % 2 === 0;
      const r = hasColor ? 40 + ((p * 23) % 200) : -1;
      const g = hasColor ? 80 + ((p * 31) % 170) : -1;
      const b = hasColor ? 120 + ((p * 47) % 135) : -1;

      pointsBuffer[offset + 0] = px;
      pointsBuffer[offset + 1] = py;
      pointsBuffer[offset + 2] = pz;
      pointsBuffer[offset + 3] = intensity;
      pointsBuffer[offset + 4] = r;
      pointsBuffer[offset + 5] = g;
      pointsBuffer[offset + 6] = b;
    }
  }

  return {
    meta: { objects },
    points: pointsBuffer,
  };
}
