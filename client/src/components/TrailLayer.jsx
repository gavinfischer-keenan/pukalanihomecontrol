import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { altColor } from './AircraftLayer';
import { VESSEL_CLASS_COLOR, classifyVessel } from './VesselLayer';

// ── Constants ─────────────────────────────────────────────────────────────────
const PROJ_HORIZON_SEC = 20 * 60;   // Forward projection: 20 minutes (in seconds)
const ANIM_INTERVAL_MS = 1000;      // Dead-reckoning animation tick (ms)
const TRAIL_REFRESH_MS = 5 * 60 * 1000;  // Re-fetch DB trails every 5 min
const LIVE_BUFFER_MS   = 90 * 1000;      // Live ring buffer window (bridges DB lag)

const HOME_LAT = 21.2855;
const HOME_LON = -157.7969;
const NM_PER_DEG_LAT = 60.0;

// ── Smart vessel timeout ─────────────────────────────────────────────────────
const vesselTimeout = (lat, lon) => {
  const dLat  = (lat - HOME_LAT) * NM_PER_DEG_LAT;
  const dLon  = (lon - HOME_LON) * NM_PER_DEG_LAT * Math.cos(HOME_LAT * Math.PI / 180);
  const range = Math.sqrt(dLat * dLat + dLon * dLon);
  // Keep projection lines visible long enough to match AIS reporting gaps
  // Nearby vessels report frequently but still have gaps; distant ones report less often
  if (range < 12) return 30 * 60 * 1000;   // 30 min for nearby
  if (range < 30) return 20 * 60 * 1000;   // 20 min for mid-range
  return 10 * 60 * 1000;                    // 10 min for distant
};

// ── Dead reckoning ────────────────────────────────────────────────────────────
function deadReckon(lat, lon, speedKt, headingDeg, dtSeconds) {
  if (!speedKt || speedKt < 0.5 || headingDeg == null || headingDeg >= 360) {
    return { lat, lon };
  }
  const dtHours = dtSeconds / 3600;
  const distDeg = (speedKt * dtHours) / NM_PER_DEG_LAT;
  const hdgRad  = headingDeg * (Math.PI / 180);
  const newLat  = lat + distDeg * Math.cos(hdgRad);
  const newLon  = lon + (distDeg * Math.sin(hdgRad)) / Math.cos(lat * Math.PI / 180);
  return { lat: newLat, lon: newLon };
}

// ── Helper to identify selected aircraft or vessel ID/type ────────────────────
function getSelectedInfo(selected) {
  if (!selected) return null;
  // Aircraft selection (hex is unique identifier)
  if (selected._type === 'aircraft' || selected.hex) {
    return { type: 'aircraft', id: selected.hex };
  }
  // Vessel selection (entity_id or mmsi or id is unique identifier)
  if (selected._type === 'vessel' || selected.entity_id || selected.mmsi) {
    return { type: 'vessel', id: selected.entity_id || selected.id || (selected.mmsi ? String(selected.mmsi) : null) };
  }
  return null;
}

// ── Module-level live ring buffer ─────────────────────────────────────────────
const LIVE_CACHE = {};  // { id: [{ lat, lon, altitude, time }] }

// ── Merge DB trail points + live ring buffer ───────────────────────────────────
function mergeTrail(dbPoints, liveBuffer) {
  if (!dbPoints || !dbPoints.length) {
    return (liveBuffer || []).map(p => ({
      lat: p.lat, lon: p.lon, altitude: p.altitude, source_type: 'ais',
    }));
  }
  const lastDbTime = new Date(dbPoints[dbPoints.length - 1].recorded_at).getTime();
  const freshLive  = (liveBuffer || []).filter(p => p.time > lastDbTime + 5000);
  return [
    ...dbPoints.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude, source_type: p.source_type || 'ais' })),
    ...freshLive.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude, source_type: 'ais' })),
  ];
}

// ── Build polyline segments from merged point array ───────────────────────────
function buildAndAddSegments(points, colorFn, weight, opacity, map, addToMap = true) {
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1], p2 = points[i];
    if (!p1.lat || !p1.lon || !p2.lat || !p2.lon) continue;
    const seg = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
      color: colorFn(p2), weight, opacity, interactive: false,
    });
    if (addToMap) seg.addTo(map);
    segs.push(seg);
  }
  return segs;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function TrailLayer({ aircraft, vessels, apiBase, selected }) {
  const map = useMap();

  // Layer refs
  const vLinesRef    = useRef({});
  const vProjRef     = useRef({});
  const vProjPastRef = useRef({});
  const vStateRef    = useRef({});

  const acLinesRef   = useRef({});

  // DB trail cache
  const vDbRef       = useRef({});   // { entity_id: [DB points] }
  const acDbRef      = useRef({});   // { hex: [DB points] }

  // Fetch-in-flight guards
  const vFetching    = useRef({});
  const acFetching   = useRef({});

  const animTimerRef  = useRef(null);
  const trailTimerRef = useRef(null);

  // ── Sync trail visibility based on selection ────────────────────────────────
  // When an aircraft or boat is selected, hide all other trails so only the selected vessel/aircraft's track shows.
  // When selection is released (selected is null/cleared), all active trails return.
  const syncTrailVisibility = () => {
    const selInfo = getSelectedInfo(selected);

    // Aircraft trails
    Object.entries(acLinesRef.current).forEach(([id, lines]) => {
      const shouldShow = !selInfo || (selInfo.type === 'aircraft' && selInfo.id === id);
      lines.forEach(l => {
        if (shouldShow) {
          if (!map.hasLayer(l)) map.addLayer(l);
        } else {
          if (map.hasLayer(l)) map.removeLayer(l);
        }
      });
    });

    // Vessel trails
    Object.entries(vLinesRef.current).forEach(([id, lines]) => {
      const shouldShow = !selInfo || (selInfo.type === 'vessel' && selInfo.id === id);
      lines.forEach(l => {
        if (shouldShow) {
          if (!map.hasLayer(l)) map.addLayer(l);
        } else {
          if (map.hasLayer(l)) map.removeLayer(l);
        }
      });
    });

    // Vessel projection lines
    Object.entries(vProjRef.current).forEach(([id, line]) => {
      const shouldShow = !selInfo || (selInfo.type === 'vessel' && selInfo.id === id);
      if (shouldShow) {
        if (!map.hasLayer(line)) map.addLayer(line);
      } else {
        if (map.hasLayer(line)) map.removeLayer(line);
      }
    });

    // Vessel past projection lines
    Object.entries(vProjPastRef.current).forEach(([id, line]) => {
      const shouldShow = !selInfo || (selInfo.type === 'vessel' && selInfo.id === id);
      if (shouldShow) {
        if (!map.hasLayer(line)) map.addLayer(line);
      } else {
        if (map.hasLayer(line)) map.removeLayer(line);
      }
    });
  };

  // Re-sync visibility whenever `selected` prop changes
  useEffect(() => {
    syncTrailVisibility();
  }, [selected, map]); // eslint-disable-line

  // ── Fetch today's DB trail ─────────────────────────────────────────────────
  const fetchTodayTrail = async (id, isAircraft) => {
    const fetching = isAircraft ? acFetching : vFetching;
    const cache    = isAircraft ? acDbRef    : vDbRef;
    if (fetching.current[id]) return null;
    fetching.current[id] = true;
    try {
      const res = await fetch(`${apiBase}/api/trails/${id}?today=true`);
      if (!res.ok) return null;
      const points = await res.json();
      if (Array.isArray(points)) {
        cache.current[id] = points;
        return points;
      }
    } catch (_) { /* network err — keep cache */ }
    finally { fetching.current[id] = false; }
    return null;
  };

  // ── Render vessel trail from merged data ────────────────────────────────────
  const renderVesselTrail = (id, vesselType, points) => {
    if (vLinesRef.current[id]) {
      vLinesRef.current[id].forEach(l => map.removeLayer(l));
    }
    vLinesRef.current[id] = [];
    if (points.length < 2) return;

    // Split into local vs AISHub-tracked segments
    const localPts = [];
    const aishubPts = [];
    let currentLocal = [];
    let currentAishub = [];

    for (const p of points) {
      if (p.source_type === 'aishub_tracked') {
        if (currentLocal.length > 0) {
          localPts.push(currentLocal);
          // Bridge: carry last local point into AISHub segment for continuity
          currentAishub = [currentLocal[currentLocal.length - 1]];
          currentLocal = [];
        }
        currentAishub.push(p);
      } else {
        if (currentAishub.length > 0) {
          aishubPts.push(currentAishub);
          // Bridge: carry last AISHub point into local segment
          currentLocal = [currentAishub[currentAishub.length - 1]];
          currentAishub = [];
        }
        currentLocal.push(p);
      }
    }
    if (currentLocal.length > 0) localPts.push(currentLocal);
    if (currentAishub.length > 0) aishubPts.push(currentAishub);

    const allSegs = [];

    // Render local segments (solid black)
    for (const seg of localPts) {
      if (seg.length >= 2) {
        allSegs.push(...buildAndAddSegments(seg, () => '#000000', 2.5, 0.80, map, true));
      }
    }

    // Render AISHub-tracked segments (dotted light blue)
    for (const seg of aishubPts) {
      if (seg.length >= 2) {
        for (let i = 1; i < seg.length; i++) {
          const p1 = seg[i-1], p2 = seg[i];
          if (!p1.lat || !p1.lon || !p2.lat || !p2.lon) continue;
          const line = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
            color: '#4fc3f7', weight: 2, opacity: 0.7,
            dashArray: '6, 8', interactive: false,
          });
          line.addTo(map);
          allSegs.push(line);
        }
      }
    }

    // Add course vector from last AISHub point (2-3nm dotted line)
    const lastPoint = points[points.length - 1];
    if (lastPoint.source_type === 'aishub_tracked' && lastPoint.heading && lastPoint.heading < 360) {
      const hdgRad = lastPoint.heading * (Math.PI / 180);
      const distDeg = 2.5 / NM_PER_DEG_LAT;  // ~2.5nm
      const endLat = lastPoint.lat + distDeg * Math.cos(hdgRad);
      const endLon = lastPoint.lon + (distDeg * Math.sin(hdgRad)) / Math.cos(lastPoint.lat * Math.PI / 180);
      const courseVec = L.polyline(
        [[lastPoint.lat, lastPoint.lon], [endLat, endLon]],
        { color: '#4fc3f7', weight: 1.5, opacity: 0.6, dashArray: '4, 6', interactive: false }
      );
      courseVec.addTo(map);
      allSegs.push(courseVec);
    }

    vLinesRef.current[id] = allSegs;
    syncTrailVisibility();
  };

  // ── Render aircraft trail from merged data ──────────────────────────────────
  const renderAcTrail = (id, points) => {
    if (acLinesRef.current[id]) {
      acLinesRef.current[id].forEach(l => map.removeLayer(l));
    }
    acLinesRef.current[id] = [];
    if (points.length < 2) return;

    // Always add to map — syncTrailVisibility handles show/hide on selection
    acLinesRef.current[id] = buildAndAddSegments(
      points, p => altColor(p.altitude), 1.5, 0.65, map, true
    );
    // Immediately sync visibility if something is selected
    syncTrailVisibility();
  };

  // ── Aircraft effect ────────────────────────────────────────────────────────
  useEffect(() => {
    const now = Date.now();
    const activeIds = new Set(aircraft.map(a => a.hex));

    // Prune stale aircraft
    for (const id of Object.keys(acLinesRef.current)) {
      if (!activeIds.has(id)) {
        acLinesRef.current[id].forEach(l => map.removeLayer(l));
        delete acLinesRef.current[id];
        delete LIVE_CACHE[id];
        delete acDbRef.current[id];
      }
    }

    for (const ac of aircraft) {
      if (!ac.lat || !ac.lon) continue;
      const id = ac.hex;

      // Update live ring buffer
      if (!LIVE_CACHE[id]) LIVE_CACHE[id] = [];
      const buf  = LIVE_CACHE[id];
      const last = buf[buf.length - 1];
      if (!last || last.lat !== ac.lat || last.lon !== ac.lon) {
        buf.push({ lat: ac.lat, lon: ac.lon, altitude: ac.alt_baro, time: now });
      }
      while (buf.length && now - buf[0].time > LIVE_BUFFER_MS) buf.shift();

      if (!acDbRef.current[id]) {
        // Not cached yet — fetch then render
        fetchTodayTrail(id, true).then(pts => {
          if (pts !== null) {
            const merged = mergeTrail(acDbRef.current[id], LIVE_CACHE[id]);
            renderAcTrail(id, merged);
          }
        });
      } else {
        // Have DB cache — merge and render
        const merged = mergeTrail(acDbRef.current[id], LIVE_CACHE[id]);
        renderAcTrail(id, merged);
      }
    }
  }, [aircraft, map, apiBase]);  // eslint-disable-line

  // ── Vessel effect ──────────────────────────────────────────────────────────
  useEffect(() => {
    const now = Date.now();
    const activeIds = new Set(vessels.map(v => v.entity_id));

    // Prune stale vessels
    for (const id of Object.keys(vLinesRef.current)) {
      if (!activeIds.has(id)) {
        vLinesRef.current[id].forEach(l => map.removeLayer(l));
        delete vLinesRef.current[id];
        if (vProjRef.current[id]) { map.removeLayer(vProjRef.current[id]); delete vProjRef.current[id]; }
        if (vProjPastRef.current[id]) { map.removeLayer(vProjPastRef.current[id]); delete vProjPastRef.current[id]; }
        delete vStateRef.current[id];
        delete LIVE_CACHE[id];
        delete vDbRef.current[id];
      }
    }

    for (const v of vessels) {
      if (!v.lat || !v.lon) continue;
      const id = v.entity_id;

      // Update live ring buffer
      if (!LIVE_CACHE[id]) LIVE_CACHE[id] = [];
      const buf  = LIVE_CACHE[id];
      const last = buf[buf.length - 1];
      if (!last || last.lat !== v.lat || last.lon !== v.lon) {
        buf.push({ lat: v.lat, lon: v.lon, altitude: null, time: now });
      }
      while (buf.length && now - buf[0].time > LIVE_BUFFER_MS) buf.shift();

      if (!vDbRef.current[id]) {
        fetchTodayTrail(id, false).then(pts => {
          if (pts !== null) {
            const merged = mergeTrail(vDbRef.current[id], LIVE_CACHE[id]);
            renderVesselTrail(id, v.vessel_type, merged);
          }
        });
      } else {
        const merged = mergeTrail(vDbRef.current[id], LIVE_CACHE[id]);
        renderVesselTrail(id, v.vessel_type, merged);
      }

      // Update dead-reckoning state
      const prev = vStateRef.current[id];
      if (!prev || prev.lat !== v.lat || prev.lon !== v.lon) {
        vStateRef.current[id] = {
          lat: v.lat, lon: v.lon, speed: v.speed, heading: v.heading,
          nav_status: v.nav_status, lastUpdate: now,
          timeout: vesselTimeout(v.lat, v.lon),
          entity_id: id, vessel_type: v.vessel_type,
        };
      }
    }
  }, [vessels, apiBase, map]);  // eslint-disable-line

  // ── Periodic re-fetch: update DB cache every 5 min ─────────────────────────
  useEffect(() => {
    if (trailTimerRef.current) clearInterval(trailTimerRef.current);

    trailTimerRef.current = setInterval(async () => {
      // Aircraft — refresh DB cache
      for (const id of Object.keys(acDbRef.current)) {
        await fetchTodayTrail(id, true);
        if (acDbRef.current[id]) {
          const merged = mergeTrail(acDbRef.current[id], LIVE_CACHE[id]);
          renderAcTrail(id, merged);
        }
      }
      // Vessels — refresh DB cache
      for (const id of Object.keys(vDbRef.current)) {
        await fetchTodayTrail(id, false);
        if (vDbRef.current[id]) {
          const merged = mergeTrail(vDbRef.current[id], LIVE_CACHE[id]);
          renderVesselTrail(id, null, merged);
        }
      }
    }, TRAIL_REFRESH_MS);

    return () => clearInterval(trailTimerRef.current);
  }, [map, apiBase]);  // eslint-disable-line

  // ── Dead-reckoning animation (vessels) ────────────────────────────────────
  // Draws two-segment projection line:
  //   BLACK dashed = last AIS fix → current dead-reckoned position (past)
  //   RED dashed   = current dead-reckoned position → future projection (ahead)
  useEffect(() => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);

    animTimerRef.current = setInterval(() => {
      const now = Date.now();

      for (const [id, state] of Object.entries(vStateRef.current)) {
        const { lat, lon, speed, heading, nav_status, lastUpdate, timeout } = state;
        const ageSec = (now - lastUpdate) / 1000;

        if (now - lastUpdate > timeout) {
          if (vProjRef.current[id]) { map.removeLayer(vProjRef.current[id]); delete vProjRef.current[id]; }
          if (vProjPastRef.current[id]) { map.removeLayer(vProjPastRef.current[id]); delete vProjPastRef.current[id]; }
          delete vStateRef.current[id];
          continue;
        }

        const isMooredOrAnchored = nav_status === 1 || nav_status === 5 || nav_status === 6;
        const canProject = speed > 0.5 && heading != null && heading < 360 && !isMooredOrAnchored;

        if (canProject) {
          // Current dead-reckoned position (where vessel is NOW)
          const drNow = deadReckon(lat, lon, speed, heading, ageSec);
          // Future projection endpoint
          const endPt = deadReckon(lat, lon, speed, heading, PROJ_HORIZON_SEC);

          // BLACK segment: AIS fix → current DR position (already traveled)
          if (!vProjPastRef.current[id]) {
            vProjPastRef.current[id] = L.polyline([[lat, lon], [drNow.lat, drNow.lon]], {
              color: '#000000', weight: 2, opacity: 0.7, dashArray: '4, 6', interactive: false,
            }).addTo(map);
          } else {
            vProjPastRef.current[id].setLatLngs([[lat, lon], [drNow.lat, drNow.lon]]);
          }

          // RED segment: current DR position → future projection (ahead)
          if (!vProjRef.current[id]) {
            vProjRef.current[id] = L.polyline([[drNow.lat, drNow.lon], [endPt.lat, endPt.lon]], {
              color: '#e74c3c', weight: 1.5, opacity: 0.8, dashArray: '4, 6', interactive: false,
            }).addTo(map);
          } else {
            vProjRef.current[id].setLatLngs([[drNow.lat, drNow.lon], [endPt.lat, endPt.lon]]);
          }
        } else {
          if (vProjRef.current[id]) { map.removeLayer(vProjRef.current[id]); delete vProjRef.current[id]; }
          if (vProjPastRef.current[id]) { map.removeLayer(vProjPastRef.current[id]); delete vProjPastRef.current[id]; }
        }
      }

    }, ANIM_INTERVAL_MS);

    return () => clearInterval(animTimerRef.current);
  }, [map]); // eslint-disable-line

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    const acLines = acLinesRef.current;
    const vLines  = vLinesRef.current;
    const vProj     = vProjRef.current;
    const vProjPast = vProjPastRef.current;

    return () => {
      clearInterval(animTimerRef.current);
      clearInterval(trailTimerRef.current);
      Object.values(acLines).flat().forEach(l => map.removeLayer(l));
      Object.values(vLines).flat().forEach(l => map.removeLayer(l));
      Object.values(vProj).forEach(l => map.removeLayer(l));
      Object.values(vProjPast).forEach(l => map.removeLayer(l));
      acLinesRef.current = {};
      vLinesRef.current  = {};
      vProjRef.current     = {};
      vProjPastRef.current = {};
      vStateRef.current  = {};
    };
  }, [map]);

  return null;
}
