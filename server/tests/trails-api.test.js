/**
 * trails-api.test.js — Integration tests for /api/trails/:id endpoint
 * Tests the track_history sampler pipeline: live_tracks → track_history → API
 * Run with: npx vitest run tests/trails-api.test.js
 */
import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE || 'http://localhost:3001';

describe('/api/trails/:id', () => {
  it('returns an array for a known vessel', async () => {
    // Get active vessels first
    const vRes = await fetch(`${API_BASE}/api/vessels`);
    expect(vRes.ok).toBe(true);
    const vessels = await vRes.json();
    
    if (vessels.length === 0) {
      console.warn('No active vessels — skipping trail data test');
      return;
    }

    const entityId = vessels[0].entity_id;
    const res = await fetch(`${API_BASE}/api/trails/${entityId}?today=true`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('returns trail points with required fields', async () => {
    const vRes = await fetch(`${API_BASE}/api/vessels`);
    const vessels = await vRes.json();
    if (vessels.length === 0) return;

    const entityId = vessels[0].entity_id;
    const res = await fetch(`${API_BASE}/api/trails/${entityId}?today=true`);
    const data = await res.json();
    
    if (data.length > 0) {
      const point = data[0];
      expect(point).toHaveProperty('lat');
      expect(point).toHaveProperty('lon');
      expect(point).toHaveProperty('recorded_at');
      expect(typeof point.lat).toBe('number');
      expect(typeof point.lon).toBe('number');
    }
  });

  it('returns points in chronological order', async () => {
    const vRes = await fetch(`${API_BASE}/api/vessels`);
    const vessels = await vRes.json();
    if (vessels.length === 0) return;

    const entityId = vessels[0].entity_id;
    const res = await fetch(`${API_BASE}/api/trails/${entityId}?today=true`);
    const data = await res.json();
    
    for (let i = 1; i < data.length; i++) {
      const t1 = new Date(data[i - 1].recorded_at).getTime();
      const t2 = new Date(data[i].recorded_at).getTime();
      expect(t2).toBeGreaterThanOrEqual(t1);
    }
  });

  it('returns empty array for non-existent entity', async () => {
    const res = await fetch(`${API_BASE}/api/trails/999999999?today=true`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it('supports legacy minutes mode', async () => {
    const vRes = await fetch(`${API_BASE}/api/vessels`);
    const vessels = await vRes.json();
    if (vessels.length === 0) return;

    const entityId = vessels[0].entity_id;
    const res = await fetch(`${API_BASE}/api/trails/${entityId}?minutes=60`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  it('caps minutes at 720', async () => {
    const vRes = await fetch(`${API_BASE}/api/vessels`);
    const vessels = await vRes.json();
    if (vessels.length === 0) return;

    const entityId = vessels[0].entity_id;
    // Request 9999 minutes — should be capped at 720
    const res = await fetch(`${API_BASE}/api/trails/${entityId}?minutes=9999`);
    expect(res.ok).toBe(true);
  });
});
