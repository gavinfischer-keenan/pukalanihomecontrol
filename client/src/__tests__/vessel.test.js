import { describe, test, expect } from 'vitest';

// ── Inline pure functions from VesselLayer (avoids importing Leaflet) ─────────
const SAR_MMSI = new Set(['303867000','338339871','338926346','367003380','303633000','368897000']);

function classifyVessel(vesselType, mmsi) {
  if (mmsi && /^99\d{7}$/.test(mmsi)) return null; // AtoN
  if (mmsi && SAR_MMSI.has(mmsi)) return 'sar';
  if (!vesselType) return 'unknown';
  const t = Number(vesselType);
  if (t === 35) return 'military';
  if (t >= 30 && t <= 39) return 'fishing';
  if (t >= 50 && t <= 59) {
    if (t === 51) return 'sar';
    if (t === 55) return 'law';
    return 'tug';
  }
  if (t === 36) return 'sailing';
  if (t >= 40 && t <= 49) return 'hsc';
  if (t >= 60 && t <= 69) return 'passenger';
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  return 'other';
}

const VESSEL_CLASS_COLOR = {
  military: '#e53935', fishing: '#43a047', tug: '#8e24aa',
  sailing: '#1e88e5', hsc: '#ffa726', pilot: '#00acc1',
  sar: '#e53935', law: '#e53935', passenger: '#5c6bc0',
  cargo: '#6d4c41', tanker: '#f4511e', other: '#78909c', unknown: '#78909c',
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('classifyVessel', () => {
  test('fishing vessel type 30 -> fishing', () => expect(classifyVessel(30, null)).toBe('fishing'));
  test('tug type 52 -> tug', () => expect(classifyVessel(52, null)).toBe('tug'));
  test('passenger type 60 -> passenger', () => expect(classifyVessel(60, null)).toBe('passenger'));
  test('cargo type 70 -> cargo', () => expect(classifyVessel(70, null)).toBe('cargo'));
  test('tanker type 80 -> tanker', () => expect(classifyVessel(80, null)).toBe('tanker'));
  test('SAR type 51 -> sar', () => expect(classifyVessel(51, null)).toBe('sar'));
  test('USCG KIMBALL MMSI -> sar', () => expect(classifyVessel(null, '303867000')).toBe('sar'));
  test('unknown type -> unknown', () => expect(classifyVessel(null, null)).toBe('unknown'));
  test('AtoN MMSI 99x -> null', () => expect(classifyVessel(null, '990123456')).toBeNull());
});

describe('VESSEL_CLASS_COLOR', () => {
  test('has all required classes', () => {
    const required = ['military','fishing','tug','sailing','hsc','pilot','sar','law','passenger','cargo','tanker','other','unknown'];
    required.forEach(cls => {
      expect(VESSEL_CLASS_COLOR).toHaveProperty(cls);
    });
  });
});
