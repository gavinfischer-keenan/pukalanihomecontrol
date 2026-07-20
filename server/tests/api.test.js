const request = require('supertest');
const BASE = 'http://localhost:3001';
const axios = require('axios');

describe('Dashboard API', () => {
  test('GET /api/health returns 200 or 207', async () => {
    const r = await axios.get(`${BASE}/api/health`);
    expect([200, 207]).toContain(r.status);
    expect(r.data).toHaveProperty('checks');
  });
  
  test('GET /api/status has required fields', async () => {
    const r = await axios.get(`${BASE}/api/status`);
    expect(r.data).toHaveProperty('ok');
  });
  
  test('GET /api/vessels returns array', async () => {
    const r = await axios.get(`${BASE}/api/vessels`);
    expect(Array.isArray(r.data)).toBe(true);
  });
  
  test('GET /api/aircraft returns aircraft data', async () => {
    const r = await axios.get(`${BASE}/api/aircraft`);
    expect(r.data).toHaveProperty('aircraft');
  });
  
  test('GET /api/buoys returns array', async () => {
    const r = await axios.get(`${BASE}/api/buoys`);
    expect(Array.isArray(r.data)).toBe(true);
  });
  
  test('GET /api/metar returns array', async () => {
    const r = await axios.get(`${BASE}/api/metar`);
    expect(Array.isArray(r.data)).toBe(true);
  });
  
  test('GET /api/ecowitt/current returns data object', async () => {
    const r = await axios.get(`${BASE}/api/ecowitt/current`);
    expect(r.data).toHaveProperty('data');
  });
  
  test('GET /api/tides returns array', async () => {
    const r = await axios.get(`${BASE}/api/tides`);
    expect(Array.isArray(r.data)).toBe(true);
  });
  
  test('GET /api/noaa-tides/1617760 returns predictions', async () => {
    const r = await axios.get(`${BASE}/api/noaa-tides/1617760`);
    expect(r.data).toBeDefined();
  });
});
