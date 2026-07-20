import { describe, test, expect } from 'vitest';
import { classifyVessel, VESSEL_CLASS_COLOR } from '../components/VesselLayer.jsx';

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

describe('dead-reckoning math', () => {
  test('VESSEL_CLASS_COLOR has all required classes', () => {
    const required = ['military','fishing','tug','sailing','hsc','pilot','sar','law','passenger','cargo','tanker','other','unknown'];
    required.forEach(cls => {
      expect(VESSEL_CLASS_COLOR).toHaveProperty(cls);
    });
  });
});
