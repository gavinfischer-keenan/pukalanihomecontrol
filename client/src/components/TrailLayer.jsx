import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { altColor } from './AircraftLayer';
import { VESSEL_CLASS_COLOR, classifyVessel } from './VesselLayer';

// ── Constants ─────────────────────────────────────────────────────────────────
const PROJ_MINUTES     = 30 / 60;   // Forward projection horizon (hours)
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
  if (range < 12) return 180000;
  if (range < 20) return  90000;
  return 60000;
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
      lat: p.lat, lon: p.lon, altitude: p.altitude,
    }));
  }
  const lastDbTime = new Date(dbPoints[dbPoints.length - 1].recorded_at).getTime();
  const freshLive  = (liveBuffer || []).filter(p => p.time > lastDbTime + 5000);
  return [
    ...dbPoints.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude })),
    ...freshLive.map(p => ({ lat: p.lat, lon: p.lon, altitude: p.altitude })),
  ];
}

// ── Build polyline segments from merged point array ───────────────────────────
function buildAndAddSegments(points, colorFn, weight, opacity, map) {
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1], p2 = points[i];
    if (!p1.lat || !p1.lon || !p2.lat || !p2.lon) continue;
    const seg = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
      color: colorFn(p2), weight, opacity, interactive: false,
    });
    seg.addTo(map);
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
  const vAnimRef     = useRef({});
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

    // Vessel anim markers
    Object.entries(vAnimRef.current).forEach(([id, marker]) => {
      const shouldShow = !selInfo || (selInfo.type === 'vessel' && selInfo.id === id);
      if (shouldShow) {
        if (!map.hasLayer(marker)) map.addLayer(marker);
      } else {
        if (map.hasLayer(marker)) map.removeLayer(marker);
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

    // All vessel/boat trails are black — makes them easy to distinguish from aircraft
    vLinesRef.current[id] = buildAndAddSegments(
      points, () => '#000000', 2.5, 0.80, map
    );
    syncTrailVisibility();
  };

  // ── Render aircraft trail from merged data ──────────────────────────────────
  const renderAcTrail = (id, points) => {
    if (acLinesRef.current[id]) {
      acLinesRef.current[id].forEach(l => map.removeLayer(l));
    }
    acLinesRef.current[id] = [];
    if (points.length < 2) return;

    acLinesRef.current[id] = buildAndAddSegments(
      points, p => altColor(p.altitude), 1.5, 0.65, map
    );
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
        if (vAnimRef.current[id]) { map.removeLayer(vAnimRef.current[id]); delete vAnimRef.current[id]; }
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
      // Aircraft
      for (const id of Object.keys(acDbRef.current)) {
        delete acDbRef.current[id];
        await fetchTodayTrail(id, true);
        if (acDbRef.current[id]) {
          const merged = mergeTrail(acDbRef.current[id], LIVE_CACHE[id]);
          renderAcTrail(id, merged);
        }
      }
      // Vessels — DB cache cleared; re-rendered on next vessels prop cycle
      for (const id of Object.keys(vDbRef.current)) {
        delete vDbRef.current[id];
        await fetchTodayTrail(id, false);
      }
    }, TRAIL_REFRESH_MS);

    return () => clearInterval(trailTimerRef.current);
  }, [map, apiBase]);  // eslint-disable-line

  // ── Dead-reckoning animation (vessels) ────────────────────────────────────
  useEffect(() => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);

    animTimerRef.current = setInterval(() => {
      const now = Date.now();

      for (const [id, state] of Object.entries(vStateRef.current)) {
        const { lat, lon, speed, heading, nav_status, lastUpdate, timeout } = state;
        const ageSec = (now - lastUpdate) / 1000;

        if (now - lastUpdate > timeout) {
          if (vProjRef.current[id]) { map.removeLayer(vProjRef.current[id]); delete vProjRef.current[id]; }
          if (vAnimRef.current[id]) { map.removeLayer(vAnimRef.current[id]); delete vAnimRef.current[id]; }
          delete vStateRef.current[id];
          continue;
        }

        const isMooredOrAnchored = nav_status === 1 || nav_status === 5 || nav_status === 6;
        const canProject = speed > 0.5 && heading != null && heading < 360 && !isMooredOrAnchored;

        if (canProject) {
          const endPt = deadReckon(lat, lon, speed, heading, PROJ_MINUTES * 3600);

          if (!vProjRef.current[id]) {
            vProjRef.current[id] = L.polyline([[lat, lon], [endPt.lat, endPt.lon]], {
              color: '#e74c3c', weight: 1.5, opacity: 0.8, dashArray: '4, 6', interactive: false,
            }).addTo(map);
          } else {
            vProjRef.current[id].setLatLngs([[lat, lon], [endPt.lat, endPt.lon]]);
          }

          const animPt  = deadReckon(lat, lon, speed, heading, ageSec);
          const dotHtml = `<div style="width:10px;height:10px;border-radius:50%;background:#e74c3c;border:2px solid white;box-shadow:0 0 6px rgba(231,76,60,0.8);transform:translate(-5px,-5px)"></div>`;
          const dotIcon = L.divIcon({ className: '', html: dotHtml, iconSize: [10, 10] });

          if (!vAnimRef.current[id]) {
            vAnimRef.current[id] = L.marker([animPt.lat, animPt.lon], { icon: dotIcon, interactive: false }).addTo(map);
          } else {
            vAnimRef.current[id].setLatLng([animPt.lat, animPt.lon]).setIcon(dotIcon);
          }
        } else {
          if (vProjRef.current[id]) { map.removeLayer(vProjRef.current[id]); delete vProjRef.current[id]; }
          if (vAnimRef.current[id]) { map.removeLayer(vAnimRef.current[id]); delete vAnimRef.current[id]; }
        }
      }

      // Sync visibility for any newly added projection/anim markers
      syncTrailVisibility();
    }, ANIM_INTERVAL_MS);

    return () => clearInterval(animTimerRef.current);
  }, [map]); // eslint-disable-line

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    const acLines = acLinesRef.current;
    const vLines  = vLinesRef.current;
    const vProj   = vProjRef.current;
    const vAnim   = vAnimRef.current;

    return () => {
      clearInterval(animTimerRef.current);
      clearInterval(trailTimerRef.current);
      Object.values(acLines).flat().forEach(l => map.removeLayer(l));
      Object.values(vLines).flat().forEach(l => map.removeLayer(l));
      Object.values(vProj).forEach(l => map.removeLayer(l));
      Object.values(vAnim).forEach(m => map.removeLayer(m));
      acLinesRef.current = {};
      vLinesRef.current  = {};
      vProjRef.current   = {};
      vAnimRef.current   = {};
      vStateRef.current  = {};
    };
  }, [map]);

  return null;
}
