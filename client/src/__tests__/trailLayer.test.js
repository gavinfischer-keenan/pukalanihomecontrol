import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

// ── Unit tests for trail helper functions ────────────────────────────────────
// These test the pure functions extracted from TrailLayer.jsx

// Replicate the mergeTrail function
function mergeTrail(dbPoints, liveBuffer) {
  if (!dbPoints || !dbPoints.length) {
    return (liveBuffer || []).map(p => ({
      lat: p.lat, lon: p.lon, altitude: p.altitude,
    }));
  }
  const lastDbTime = new Date(dbPoints[dbPoints.length - 1].recorded_at).getTime();
  const freshLive = (liveBuffer || []).filter(p => p.time > lastDbTime + 5000);
  return [
    ...dbPoints.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude })),
    ...freshLive.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude })),
  ];
}

// Replicate getSelectedInfo
function getSelectedInfo(selected) {
  if (!selected) return null;
  if (selected._type === 'aircraft' || selected.hex) {
    return { type: 'aircraft', id: selected.hex };
  }
  if (selected._type === 'vessel' || selected.entity_id || selected.mmsi) {
    return { type: 'vessel', id: selected.entity_id || selected.id || (selected.mmsi ? String(selected.mmsi) : null) };
  }
  return null;
}

// Replicate vesselTimeout
const HOME_LAT = 21.2855;
const HOME_LON = -157.7969;
const NM_PER_DEG_LAT = 60.0;

const vesselTimeout = (lat, lon) => {
  const dLat = (lat - HOME_LAT) * NM_PER_DEG_LAT;
  const dLon = (lon - HOME_LON) * NM_PER_DEG_LAT * Math.cos(HOME_LAT * Math.PI / 180);
  const range = Math.sqrt(dLat * dLat + dLon * dLon);
  if (range < 12) return 180000;
  if (range < 20) return 90000;
  return 60000;
};

describe('mergeTrail', () => {
  it('returns live buffer points when no DB points exist', () => {
    const live = [
      { lat: 21.28, lon: -157.79, altitude: null, time: Date.now() },
      { lat: 21.29, lon: -157.80, altitude: null, time: Date.now() + 1000 },
    ];
    const result = mergeTrail(null, live);
    expect(result).toHaveLength(2);
    expect(result[0].lat).toBe(21.28);
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeTrail(null, null)).toEqual([]);
    expect(mergeTrail([], [])).toEqual([]);
  });

  it('returns DB points when no live buffer', () => {
    const db = [
      { lat: 21.28, lon: -157.79, altitude: 0, recorded_at: '2026-07-29T10:00:00Z' },
      { lat: 21.29, lon: -157.80, altitude: 0, recorded_at: '2026-07-29T10:01:00Z' },
    ];
    const result = mergeTrail(db, []);
    expect(result).toHaveLength(2);
  });

  it('merges DB and live, deduplicating by time', () => {
    const dbTime = new Date('2026-07-29T10:00:00Z').getTime();
    const db = [
      { lat: 21.28, lon: -157.79, altitude: 0, recorded_at: '2026-07-29T10:00:00Z' },
    ];
    const live = [
      { lat: 21.281, lon: -157.791, altitude: null, time: dbTime + 3000 },  // within 5s gap, should be excluded
      { lat: 21.282, lon: -157.792, altitude: null, time: dbTime + 6000 },  // after gap, should be included
    ];
    const result = mergeTrail(db, live);
    expect(result).toHaveLength(2);  // 1 DB + 1 fresh live
    expect(result[1].lat).toBe(21.282);
  });
});

describe('getSelectedInfo', () => {
  it('returns null for null/undefined selection', () => {
    expect(getSelectedInfo(null)).toBeNull();
    expect(getSelectedInfo(undefined)).toBeNull();
  });

  it('identifies aircraft by hex', () => {
    const info = getSelectedInfo({ hex: 'abc123', lat: 21.28, lon: -157.79 });
    expect(info.type).toBe('aircraft');
    expect(info.id).toBe('abc123');
  });

  it('identifies aircraft by _type', () => {
    const info = getSelectedInfo({ _type: 'aircraft', hex: 'def456' });
    expect(info.type).toBe('aircraft');
    expect(info.id).toBe('def456');
  });

  it('identifies vessel by entity_id', () => {
    const info = getSelectedInfo({ entity_id: '338033000', mmsi: 338033000 });
    expect(info.type).toBe('vessel');
    expect(info.id).toBe('338033000');
  });

  it('identifies vessel by _type', () => {
    const info = getSelectedInfo({ _type: 'vessel', entity_id: '303582000' });
    expect(info.type).toBe('vessel');
    expect(info.id).toBe('303582000');
  });

  it('identifies vessel by mmsi (string conversion)', () => {
    const info = getSelectedInfo({ mmsi: 367596840 });
    expect(info.type).toBe('vessel');
    expect(info.id).toBe('367596840');
  });

  it('returns null for unknown object type', () => {
    const info = getSelectedInfo({ some: 'random', data: true });
    expect(info).toBeNull();
  });
});

describe('vesselTimeout', () => {
  it('returns 180s for nearby vessels (< 12nm)', () => {
    // Home position itself = 0nm range
    expect(vesselTimeout(HOME_LAT, HOME_LON)).toBe(180000);
  });

  it('returns 90s for mid-range vessels (12-20nm)', () => {
    // ~15nm south
    const lat15nm = HOME_LAT - 15 / NM_PER_DEG_LAT;
    expect(vesselTimeout(lat15nm, HOME_LON)).toBe(90000);
  });

  it('returns 60s for distant vessels (> 20nm)', () => {
    // ~30nm south
    const lat30nm = HOME_LAT - 30 / NM_PER_DEG_LAT;
    expect(vesselTimeout(lat30nm, HOME_LON)).toBe(60000);
  });
});
