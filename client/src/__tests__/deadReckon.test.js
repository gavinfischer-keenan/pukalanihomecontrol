import { describe, test, expect } from 'vitest';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_R_NM = 3440.065;

function deadReckon(lat0, lon0, cogDeg, sogKt, elapsedSec) {
  if (sogKt < 0.3 || elapsedSec <= 0) return { lat: lat0, lon: lon0 };
  const distNm = (sogKt * elapsedSec) / 3600;
  const angDist = distNm / EARTH_R_NM;
  const bearingR = cogDeg * DEG_TO_RAD;
  const lat0R = lat0 * DEG_TO_RAD;
  const lon0R = lon0 * DEG_TO_RAD;
  const lat1R = Math.asin(Math.sin(lat0R) * Math.cos(angDist) + Math.cos(lat0R) * Math.sin(angDist) * Math.cos(bearingR));
  const lon1R = lon0R + Math.atan2(Math.sin(bearingR) * Math.sin(angDist) * Math.cos(lat0R), Math.cos(angDist) - Math.sin(lat0R) * Math.sin(lat1R));
  return { lat: lat1R * RAD_TO_DEG, lon: lon1R * RAD_TO_DEG };
}

describe('deadReckon', () => {
  test('stationary vessel stays put', () => {
    const r = deadReckon(21.3, -157.8, 90, 0.1, 60);
    expect(r.lat).toBeCloseTo(21.3, 4);
    expect(r.lon).toBeCloseTo(-157.8, 4);
  });
  
  test('vessel heading north increases latitude', () => {
    const r = deadReckon(21.3, -157.8, 0, 10, 3600); // 10kt north for 1hr = ~10nm north
    expect(r.lat).toBeGreaterThan(21.3);
    expect(r.lon).toBeCloseTo(-157.8, 2);
  });
  
  test('vessel heading east increases longitude (less negative)', () => {
    const r = deadReckon(21.3, -157.8, 90, 10, 3600);
    expect(r.lon).toBeGreaterThan(-157.8);
    expect(r.lat).toBeCloseTo(21.3, 1);
  });
  
  test('10kt for 1hr moves ~10nm', () => {
    const r = deadReckon(21.3, -157.8, 0, 10, 3600);
    const diffLat = r.lat - 21.3;
    expect(diffLat).toBeCloseTo(10/60, 2);
  });
  
  test('zero elapsed time returns original position', () => {
    const r = deadReckon(21.3, -157.8, 90, 15, 0);
    expect(r.lat).toBe(21.3);
    expect(r.lon).toBe(-157.8);
  });
});
