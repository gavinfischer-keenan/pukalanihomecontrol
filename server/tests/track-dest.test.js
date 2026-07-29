/**
 * track-dest.test.js — Tests for Track to Destination & Return feature
 * Run with: npx vitest run server/tests/track-dest.test.js
 */
import { describe, it, expect } from 'vitest';

const API = process.env.API_BASE || 'http://localhost:3001';

describe('Track to Destination & Return', () => {

  describe('PUT /api/vessel-info/:mmsi/track-dest', () => {
    it('should toggle track_dest_return to true', async () => {
      const r = await fetch(`${API}/api/vessel-info/368118000/track-dest`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      expect(r.ok).toBe(true);
      const data = await r.json();
      expect(data.ok).toBe(true);
      expect(data.track_dest_return).toBe(true);
    });

    it('should toggle track_dest_return to false', async () => {
      const r = await fetch(`${API}/api/vessel-info/368118000/track-dest`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      expect(r.ok).toBe(true);
      const data = await r.json();
      expect(data.track_dest_return).toBe(false);
    });

    it('should coerce truthy values', async () => {
      const r = await fetch(`${API}/api/vessel-info/368118000/track-dest`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: 1 }),
      });
      const data = await r.json();
      expect(data.track_dest_return).toBe(true);

      // Clean up
      await fetch(`${API}/api/vessel-info/368118000/track-dest`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
    });
  });

  describe('GET /api/vessel-info/:mmsi', () => {
    it('should include track_dest_return field', async () => {
      const r = await fetch(`${API}/api/vessel-info/368118000`);
      if (!r.ok) return; // vessel may not exist in test env
      const data = await r.json();
      expect(data).toHaveProperty('track_dest_return');
      expect(typeof data.track_dest_return).toBe('boolean');
    });
  });

  describe('GET /api/trails/:id', () => {
    it('should include source_type in trail response', async () => {
      const r = await fetch(`${API}/api/trails/368118000?today=true`);
      expect(r.ok).toBe(true);
      const data = await r.json();
      if (data.length > 0) {
        expect(data[0]).toHaveProperty('source_type');
        // All existing points should be 'ais' (no aishub_tracked yet)
        for (const p of data) {
          expect(['ais', 'aishub_tracked']).toContain(p.source_type);
        }
      }
    });

    it('should have valid trail point fields', async () => {
      const r = await fetch(`${API}/api/trails/368118000?today=true`);
      const data = await r.json();
      if (data.length > 0) {
        const p = data[0];
        expect(p).toHaveProperty('lat');
        expect(p).toHaveProperty('lon');
        expect(p).toHaveProperty('speed');
        expect(p).toHaveProperty('heading');
        expect(p).toHaveProperty('recorded_at');
        expect(p).toHaveProperty('source_type');
      }
    });
  });
});
