import { describe, test, expect } from 'vitest';

const BASE = process.env.API_BASE || 'http://localhost:3001';

describe('Dashboard API', () => {
  test('GET /api/health returns 200 or 207', async () => {
    const r = await fetch(`${BASE}/api/health`);
    expect([200, 207]).toContain(r.status);
    const data = await r.json();
    expect(data).toHaveProperty('checks');
  });

  test('GET /api/status has required fields', async () => {
    const r = await fetch(`${BASE}/api/status`);
    const data = await r.json();
    expect(data).toHaveProperty('ok');
  });

  test('GET /api/vessels returns array', async () => {
    const r = await fetch(`${BASE}/api/vessels`);
    const data = await r.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/aircraft returns aircraft data', async () => {
    const r = await fetch(`${BASE}/api/aircraft`);
    const data = await r.json();
    expect(data).toHaveProperty('aircraft');
  });

  test('GET /api/buoys returns array', async () => {
    const r = await fetch(`${BASE}/api/buoys`);
    const data = await r.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/metar returns array', async () => {
    const r = await fetch(`${BASE}/api/metar`);
    const data = await r.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/ecowitt/current returns data object', async () => {
    const r = await fetch(`${BASE}/api/ecowitt/current`);
    const data = await r.json();
    expect(data).toHaveProperty('data');
  });

  test('GET /api/tides returns array', async () => {
    const r = await fetch(`${BASE}/api/tides`);
    const data = await r.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test('GET /api/noaa-tides/1617760 returns predictions', async () => {
    const r = await fetch(`${BASE}/api/noaa-tides/1617760`);
    const data = await r.json();
    expect(data).toBeDefined();
  });
});
