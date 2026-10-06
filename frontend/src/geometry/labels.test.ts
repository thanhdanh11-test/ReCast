import { describe, it, expect } from 'vitest';
import { shortLabel, isBoxLongEdgeAtLeast40 } from './labels';

describe('shortLabel (SPEC-P02 §2)', () => {
  it('maps standard 10 classes correctly', () => {
    // 1. car
    expect(shortLabel('car')).toBe('car');
    expect(shortLabel('vehicle.car')).toBe('car');

    // 2. truck
    expect(shortLabel('truck')).toBe('truck');
    expect(shortLabel('vehicle.truck')).toBe('truck');

    // 3. bus
    expect(shortLabel('bus')).toBe('bus');
    expect(shortLabel('vehicle.bus')).toBe('bus');
    expect(shortLabel('vehicle.bus.rigid')).toBe('bus');
    expect(shortLabel('vehicle.bus.bendy')).toBe('bus');

    // 4. trailer
    expect(shortLabel('trailer')).toBe('trailer');
    expect(shortLabel('vehicle.trailer')).toBe('trailer');

    // 5. cons (construction_vehicle)
    expect(shortLabel('cons')).toBe('cons');
    expect(shortLabel('construction_vehicle')).toBe('cons');
    expect(shortLabel('vehicle.construction')).toBe('cons');
    expect(shortLabel('construction')).toBe('cons');

    // 6. ped (pedestrian)
    expect(shortLabel('ped')).toBe('ped');
    expect(shortLabel('pedestrian')).toBe('ped');
    expect(shortLabel('human.pedestrian')).toBe('ped');
    expect(shortLabel('human.pedestrian.adult')).toBe('ped');
    expect(shortLabel('human.pedestrian.child')).toBe('ped');
    expect(shortLabel('human.pedestrian.police_officer')).toBe('ped');

    // 7. moto (motorcycle)
    expect(shortLabel('moto')).toBe('moto');
    expect(shortLabel('motorcycle')).toBe('moto');
    expect(shortLabel('vehicle.motorcycle')).toBe('moto');

    // 8. bike (bicycle)
    expect(shortLabel('bike')).toBe('bike');
    expect(shortLabel('bicycle')).toBe('bike');
    expect(shortLabel('vehicle.bicycle')).toBe('bike');

    // 9. cone (traffic_cone)
    expect(shortLabel('cone')).toBe('cone');
    expect(shortLabel('traffic_cone')).toBe('cone');
    expect(shortLabel('trafficcone')).toBe('cone');
    expect(shortLabel('movable_object.trafficcone')).toBe('cone');

    // 10. barrier
    expect(shortLabel('barrier')).toBe('barrier');
    expect(shortLabel('movable_object.barrier')).toBe('barrier');
  });

  it('returns original label for unknown labels (nhãn lạ thì trả nguyên nhãn)', () => {
    expect(shortLabel('animal')).toBe('animal');
    expect(shortLabel('custom.traffic_light')).toBe('custom.traffic_light');
    expect(shortLabel('unknown_class')).toBe('unknown_class');
    expect(shortLabel('debris')).toBe('debris');
  });

  it('handles empty or whitespace strings gracefully', () => {
    expect(shortLabel('')).toBe('');
    expect(shortLabel('   ')).toBe('');
  });
});

describe('isBoxLongEdgeAtLeast40', () => {
  it('returns false for empty edges', () => {
    expect(isBoxLongEdgeAtLeast40([])).toBe(false);
  });

  it('returns false when both bbox and edges are strictly under 40 px', () => {
    const smallEdges = [
      { p1: { u: 10, v: 10 }, p2: { u: 30, v: 10 } }, // len = 20
      { p1: { u: 30, v: 10 }, p2: { u: 30, v: 25 } }, // len = 15
    ];
    // bbox: w = 20, h = 15, maxLen = 20 -> max = 20 < 40
    expect(isBoxLongEdgeAtLeast40(smallEdges)).toBe(false);
  });

  it('returns true when bounding box width or height is >= 40 px', () => {
    const edges = [
      { p1: { u: 10, v: 10 }, p2: { u: 60, v: 10 } }, // len = 50 >= 40
    ];
    expect(isBoxLongEdgeAtLeast40(edges)).toBe(true);
  });

  it('returns true when edge length is >= 40 px even if axis-aligned extent is smaller', () => {
    const diagEdge = [
      { p1: { u: 0, v: 0 }, p2: { u: 30, v: 30 } }, // hypot(30, 30) = 42.42 >= 40
    ];
    expect(isBoxLongEdgeAtLeast40(diagEdge)).toBe(true);
  });
});
