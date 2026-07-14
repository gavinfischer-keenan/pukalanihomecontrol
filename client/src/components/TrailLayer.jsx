import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import { altColor } from './AircraftLayer';
import { VESSEL_CLASS_COLOR, classifyVessel } from './VesselLayer';

// ─── Constants ───────────────────────────────────────────────────────────────
const AIRCRAFT_TRAIL_MINUTES  = 10;         // client-side ring buffer
const VESSEL_TRAIL_MINUTES    = 60;         // DB-backed historical trail
const PROJ_MINUTES            = 30 / 60;    // 30-minute dead reckoning projection (in hours)
const ANIM_INTERVAL_MS        = 1000;       // animate vessel position every second

// AIS antenna effective range is ~20-25nm from Pukalani elevation.
// The further a vessel is, the shorter we wait for a stale update.
const HOME_LAT = 21.2855;
const HOME_LON = -157.7969;
const NM_PER_DEG_LAT = 60.0;

// --- Smart expiry: timeout depends on how far out the vessel is ---
// Close in (<12nm): generous timeout — could be in a cove, temp shadow
// 12-20nm: moderate — likely still in range but starting to fade
// >20nm: tight — probably at range limit, don't linger
const vesselTimeout = (lat, lon, speedKt) => {
  const dLat = (lat - HOME_LAT) * NM_PER_DEG_LAT;
  const dLon = (lon - HOME_LON) * NM_PER_DEG_LAT * Math.cos(HOME_LAT * Math.PI / 180);
  const rangeNm = Math.sqrt(dLat * dLat + dLon * dLon);

  if (rangeNm < 12) return 180000;   // 3 min — in harbor or sheltered
  if (rangeNm < 20) return 90000;    // 90s — mid-range
  return 60000;                       // 1 min — near antenna limit, fail fast
};

// ─── Dead reckoning: advance lat/lon by (speed kt, heading deg, dtSeconds) ──
function deadReckon(lat, lon, speedKt, headingDeg, dtSeconds) {
  if (!speedKt || speedKt < 0.5 || headingDeg == null || headingDeg >= 360) {
    return { lat, lon };
  }
  const dtHours   = dtSeconds / 3600;
  const distDeg   = (speedKt * dtHours) / NM_PER_DEG_LAT;
  const hdgRad    = headingDeg * (Math.PI / 180);
  const newLat    = lat + distDeg * Math.cos(hdgRad);
  const newLon    = lon + (distDeg * Math.sin(hdgRad)) / Math.cos(lat * Math.PI / 180);
  return { lat: newLat, lon: newLon };
}

// Aircraft trail: client-side ring buffer keyed by hex
const AC_TRAIL_CACHE = {};

export default function TrailLayer({ aircraft, vessels, apiBase }) {
  const map          = useMap();
  const acLinesRef   = useRef({});    // hex → [L.Polyline, ...]
  const vLinesRef    = useRef({});    // mmsi → [L.Polyline, ...]   (solid historical)
  const vProjRef     = useRef({});    // mmsi → L.Polyline           (dotted projected)
  const vAnimRef     = useRef({});    // mmsi → L.Marker             (animated dot on proj line)
  const vStateRef    = useRef({});    // mmsi → { lat, lon, speed, heading, lastUpdate, timeout }
  const fetchingRef  = useRef({});
  const animTimerRef = useRef(null);

  // ── Aircraft trails (client-side, altitude-colored) ──────────────────────
  useEffect(() => {
    const now = Date.now();
    const activeAcIds = new Set(aircraft.map(a => a.hex));

    // Prune stale aircraft lines
    for (const id of Object.keys(acLinesRef.current)) {
      if (!activeAcIds.has(id)) {
        acLinesRef.current[id].forEach(l => map.removeLayer(l));
        delete acLinesRef.current[id];
        delete AC_TRAIL_CACHE[id];
      }
    }

    for (const ac of aircraft) {
      if (!ac.lat || !ac.lon) continue;
      if (!AC_TRAIL_CACHE[ac.hex]) AC_TRAIL_CACHE[ac.hex] = [];
      const tr   = AC_TRAIL_CACHE[ac.hex];
      const last = tr[tr.length - 1];

      if (!last || last.lat !== ac.lat || last.lon !== ac.lon) {
        tr.push({ lat: ac.lat, lon: ac.lon, altitude: ac.alt_baro, time: now });
      }
      // Trim ring buffer to window
      while (tr.length > 0 && now - tr[0].time > AIRCRAFT_TRAIL_MINUTES * 60000) tr.shift();

      if (tr.length >= 2) {
        if (acLinesRef.current[ac.hex]) {
          acLinesRef.current[ac.hex].forEach(l => map.removeLayer(l));
        }
        acLinesRef.current[ac.hex] = [];
        for (let i = 1; i < tr.length; i++) {
          const p1 = tr[i - 1], p2 = tr[i];
          const seg = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
            color: altColor(p2.altitude), weight: 1.5, opacity: 0.6, interactive: false,
          });
          seg.addTo(map);
          acLinesRef.current[ac.hex].push(seg);
        }
      }
    }
  }, [aircraft, map]);

  // ── Vessel solid historical trails (from DB) ──────────────────────────────
  useEffect(() => {
    const activeVIds = new Set(vessels.map(v => v.entity_id));

    // Remove stale vessel lines, projected paths, and animation states
    for (const id of Object.keys(vLinesRef.current)) {
      if (!activeVIds.has(id)) {
        vLinesRef.current[id].forEach(l => map.removeLayer(l));
        delete vLinesRef.current[id];
        
        // Also clear projections and animations if they exist
        if (vProjRef.current[id]) {
          map.removeLayer(vProjRef.current[id]);
          delete vProjRef.current[id];
        }
        if (vAnimRef.current[id]) {
          map.removeLayer(vAnimRef.current[id]);
          delete vAnimRef.current[id];
        }
        delete vStateRef.current[id];
      }
    }

    const fetchSolidTrail = async (v) => {
      const id = v.entity_id;
      if (fetchingRef.current[id]) return;
      fetchingRef.current[id] = true;
      try {
        const res    = await fetch(`${apiBase}/api/trails/${id}?minutes=${VESSEL_TRAIL_MINUTES}`);
        const points = await res.json();
        if (!Array.isArray(points) || points.length < 2) return;

        if (vLinesRef.current[id]) {
          vLinesRef.current[id].forEach(l => map.removeLayer(l));
        }
        vLinesRef.current[id] = [];

        const vclass = classifyVessel(v.vessel_type, id);
        const color  = VESSEL_CLASS_COLOR[vclass] || '#ffffff';

        for (let i = 1; i < points.length; i++) {
          const p1 = points[i - 1], p2 = points[i];
          const seg = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
            color, weight: 2, opacity: 0.55, interactive: false,
          });
          seg.addTo(map);
          vLinesRef.current[id].push(seg);
        }
      } finally {
        fetchingRef.current[id] = false;
      }
    };

    for (const v of vessels) {
      if (!v.lat || !v.lon) continue;
      fetchSolidTrail(v);

      // Update dead-reckoning state
      const prev = vStateRef.current[v.entity_id];
      const now  = Date.now();
      if (!prev || prev.lat !== v.lat || prev.lon !== v.lon) {
        // Real position update received → reset state
        const timeout = vesselTimeout(v.lat, v.lon, v.speed);
        vStateRef.current[v.entity_id] = {
          lat:        v.lat,
          lon:        v.lon,
          speed:      v.speed,
          heading:    v.heading,
          nav_status: v.nav_status,
          lastUpdate: now,
          timeout,
          entity_id:  v.entity_id,
          vessel_type: v.vessel_type,
        };
      }
    }
  }, [vessels, apiBase, map]);

  // ── Projected path + animated dot (runs every second) ────────────────────
  useEffect(() => {
    if (animTimerRef.current) clearInterval(animTimerRef.current);

    animTimerRef.current = setInterval(() => {
      const now = Date.now();

      for (const [id, state] of Object.entries(vStateRef.current)) {
        const { lat, lon, speed, heading, nav_status, lastUpdate, timeout } = state;
        const ageSec = (now - lastUpdate) / 1000;

        // ── Expiry: remove vessel if stale beyond smart timeout ──────────
        if (now - lastUpdate > timeout) {
          // Clean up projected line and animated dot
          if (vProjRef.current[id]) { map.removeLayer(vProjRef.current[id]); delete vProjRef.current[id]; }
          if (vAnimRef.current[id]) { map.removeLayer(vAnimRef.current[id]); delete vAnimRef.current[id]; }
          delete vStateRef.current[id];
          continue;
        }

        const isMooredOrAnchored = nav_status === 1 || nav_status === 5 || nav_status === 6;
        const canProject = speed > 0.5 && heading != null && heading < 360 && !isMooredOrAnchored;

        // ── Draw / update projected dotted line ───────────────────────────
        if (canProject) {
          const endPt = deadReckon(lat, lon, speed, heading, PROJ_MINUTES * 3600);

          if (!vProjRef.current[id]) {
            vProjRef.current[id] = L.polyline([[lat, lon], [endPt.lat, endPt.lon]], {
              color: '#e74c3c', weight: 1.5, opacity: 0.8, dashArray: '4, 6', interactive: false,
            }).addTo(map);
          } else {
            vProjRef.current[id].setLatLngs([[lat, lon], [endPt.lat, endPt.lon]]);
          }

          // ── Animated dot: slide vessel along projected line ───────────
          const animPt = deadReckon(lat, lon, speed, heading, ageSec);
          const dotHtml = `<div style="
            width:10px; height:10px; border-radius:50%;
            background:#e74c3c; border:2px solid white;
            box-shadow:0 0 6px rgba(231,76,60,0.8);
            transform:translate(-5px,-5px);
          "></div>`;
          const dotIcon = L.divIcon({ className: '', html: dotHtml, iconSize: [10, 10] });

          if (!vAnimRef.current[id]) {
            vAnimRef.current[id] = L.marker([animPt.lat, animPt.lon], { icon: dotIcon, interactive: false }).addTo(map);
          } else {
            vAnimRef.current[id].setLatLng([animPt.lat, animPt.lon]).setIcon(dotIcon);
          }
        } else {
          // No valid heading — remove projection artifacts
          if (vProjRef.current[id]) { map.removeLayer(vProjRef.current[id]); delete vProjRef.current[id]; }
          if (vAnimRef.current[id]) { map.removeLayer(vAnimRef.current[id]); delete vAnimRef.current[id]; }
        }
      }
    }, ANIM_INTERVAL_MS);

    return () => clearInterval(animTimerRef.current);
  }, [map]); // Only depends on map — state is managed via ref

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    // Capture refs for reliable cleanup when React unmounts
    const acLines = acLinesRef.current;
    const vLines = vLinesRef.current;
    const vProj = vProjRef.current;
    const vAnim = vAnimRef.current;

    return () => {
      clearInterval(animTimerRef.current);
      Object.values(acLines).flat().forEach(l => map.removeLayer(l));
      Object.values(vLines).flat().forEach(l => map.removeLayer(l));
      Object.values(vProj).forEach(l => map.removeLayer(l));
      Object.values(vAnim).forEach(m => map.removeLayer(m));
      
      acLinesRef.current = {};
      vLinesRef.current = {};
      vProjRef.current = {};
      vAnimRef.current = {};
      vStateRef.current = {};
    };
  }, [map]);

  return null;
}
