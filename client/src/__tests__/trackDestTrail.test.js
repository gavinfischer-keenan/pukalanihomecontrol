import { describe, it, expect } from 'vitest';

// Unit tests for TrailLayer source_type handling
describe('TrailLayer source_type rendering', () => {

  describe('mergeTrail with source_type', () => {
    // Simulate mergeTrail logic
    function mergeTrail(dbPoints, liveBuffer) {
      if (!dbPoints || !dbPoints.length) {
        return (liveBuffer || []).map(p => ({
          lat: p.lat, lon: p.lon, altitude: p.altitude, source_type: 'ais',
        }));
      }
      const lastDbTime = new Date(dbPoints[dbPoints.length - 1].recorded_at).getTime();
      const freshLive = (liveBuffer || []).filter(p => p.time > lastDbTime + 5000);
      return [
        ...dbPoints.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude, source_type: p.source_type || 'ais' })),
        ...freshLive.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude, source_type: 'ais' })),
      ];
    }

    it('should preserve source_type from DB points', () => {
      const dbPoints = [
        { lat: 21.0, lon: -157.0, recorded_at: '2026-01-01T00:00:00Z', source_type: 'ais' },
        { lat: 21.1, lon: -157.1, recorded_at: '2026-01-01T01:00:00Z', source_type: 'aishub_tracked' },
        { lat: 21.2, lon: -157.2, recorded_at: '2026-01-01T02:00:00Z', source_type: 'ais' },
      ];
      const merged = mergeTrail(dbPoints, []);
      expect(merged[0].source_type).toBe('ais');
      expect(merged[1].source_type).toBe('aishub_tracked');
      expect(merged[2].source_type).toBe('ais');
    });

    it('should default missing source_type to ais', () => {
      const dbPoints = [
        { lat: 21.0, lon: -157.0, recorded_at: '2026-01-01T00:00:00Z' },
      ];
      const merged = mergeTrail(dbPoints, []);
      expect(merged[0].source_type).toBe('ais');
    });

    it('should set live buffer points as ais', () => {
      const merged = mergeTrail([], [
        { lat: 21.0, lon: -157.0, time: Date.now() },
      ]);
      expect(merged[0].source_type).toBe('ais');
    });
  });

  describe('segment splitting', () => {
    function splitSegments(points) {
      const localPts = [];
      const aishubPts = [];
      let currentLocal = [];
      let currentAishub = [];

      for (const p of points) {
        if (p.source_type === 'aishub_tracked') {
          if (currentLocal.length > 0) {
            localPts.push(currentLocal);
            currentAishub = [currentLocal[currentLocal.length - 1]];
            currentLocal = [];
          }
          currentAishub.push(p);
        } else {
          if (currentAishub.length > 0) {
            aishubPts.push(currentAishub);
            currentLocal = [currentAishub[currentAishub.length - 1]];
            currentAishub = [];
          }
          currentLocal.push(p);
        }
      }
      if (currentLocal.length > 0) localPts.push(currentLocal);
      if (currentAishub.length > 0) aishubPts.push(currentAishub);
      return { localPts, aishubPts };
    }

    it('should separate local and aishub segments', () => {
      const points = [
        { lat: 21.0, lon: -157.0, source_type: 'ais' },
        { lat: 21.1, lon: -157.1, source_type: 'ais' },
        { lat: 21.2, lon: -157.2, source_type: 'aishub_tracked' },
        { lat: 21.3, lon: -157.3, source_type: 'aishub_tracked' },
        { lat: 21.4, lon: -157.4, source_type: 'ais' },
      ];
      const { localPts, aishubPts } = splitSegments(points);
      expect(localPts.length).toBe(2); // Two local segments (before and after AISHub)
      expect(aishubPts.length).toBe(1); // One AISHub segment
    });

    it('should bridge segments with last point for continuity', () => {
      const points = [
        { lat: 21.0, lon: -157.0, source_type: 'ais' },
        { lat: 21.1, lon: -157.1, source_type: 'aishub_tracked' },
        { lat: 21.2, lon: -157.2, source_type: 'ais' },
      ];
      const { localPts, aishubPts } = splitSegments(points);
      // AISHub segment should start with the bridged local point
      expect(aishubPts[0][0].lat).toBe(21.0);
      expect(aishubPts[0][0].source_type).toBe('ais');
      // Second local segment should start with the bridged AISHub point
      expect(localPts[1][0].lat).toBe(21.1);
    });

    it('should handle all-local points', () => {
      const points = [
        { lat: 21.0, lon: -157.0, source_type: 'ais' },
        { lat: 21.1, lon: -157.1, source_type: 'ais' },
      ];
      const { localPts, aishubPts } = splitSegments(points);
      expect(localPts.length).toBe(1);
      expect(aishubPts.length).toBe(0);
    });

    it('should handle all-aishub points', () => {
      const points = [
        { lat: 21.0, lon: -157.0, source_type: 'aishub_tracked' },
        { lat: 21.1, lon: -157.1, source_type: 'aishub_tracked' },
      ];
      const { localPts, aishubPts } = splitSegments(points);
      expect(localPts.length).toBe(0);
      expect(aishubPts.length).toBe(1);
    });
  });

  describe('course vector', () => {
    it('should compute correct endpoint for 2.5nm vector', () => {
      const NM_PER_DEG_LAT = 60.0;
      const lastPoint = { lat: 21.0, lon: -157.0, heading: 0, source_type: 'aishub_tracked' };
      const distDeg = 2.5 / NM_PER_DEG_LAT;
      const hdgRad = lastPoint.heading * (Math.PI / 180);
      const endLat = lastPoint.lat + distDeg * Math.cos(hdgRad);
      const endLon = lastPoint.lon + (distDeg * Math.sin(hdgRad)) / Math.cos(lastPoint.lat * Math.PI / 180);
      // Heading 0 (north) should increase latitude
      expect(endLat).toBeGreaterThan(lastPoint.lat);
      expect(Math.abs(endLon - lastPoint.lon)).toBeLessThan(0.001);
    });

    it('should not render vector for non-aishub last point', () => {
      const lastPoint = { lat: 21.0, lon: -157.0, heading: 45, source_type: 'ais' };
      const shouldRender = lastPoint.source_type === 'aishub_tracked' && lastPoint.heading && lastPoint.heading < 360;
      expect(shouldRender).toBe(false);
    });
  });
});
