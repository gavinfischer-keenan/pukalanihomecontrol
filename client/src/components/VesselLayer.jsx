import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

// ─── AIS vessel type → display class ────────────────────────────────────────
// AIS Type codes are 0–99, grouped by tens digit:
// https://www.maritec.co.za/tools/aisvdmvdodecoding/
//   0x = not available / reserved
//   1x = reserved
//   2x = Wing in ground
//   3x = Fishing / SAR / Tug / Port
//   4x = High speed / HSC
//   5x = Pilot / SAR / Tug / Port Tender / Anti-pollution / Law enforcement
//   6x = Passenger
//   7x = Cargo
//   8x = Tanker
//   9x = Other

// Known specific vessels by MMSI (hard-coded for Hawaii area regulars)
// vclass = icon shape/color class
// vtype  = human-readable type line shown below the name
// prefix = label prefix shown above the name (for CG/military)
const KNOWN_VESSELS = {
  '303867000': { vclass: 'sar',     name: 'USCGC KIMBALL',        vtype: 'Natl. Security Cutter', prefix: 'USCG Cutter' },
  '367151310': { vclass: 'tug',     name: 'AMERICAN CONTENDER',   vtype: 'Harbor Tug' },
  '367396410': { vclass: 'fishing', name: 'LADY MARIA',            vtype: 'Commercial Fishing' },
  '338XXXXXX': { vclass: 'sar',     name: 'USCG',                  prefix: 'USCG' },
};

// MMSI-based classification — fallback when vessel_type is null (no Type 5 msg yet)
// MID (Maritime Identification Digits) reference:
//   338, 303, 366-369 = USA
function classifyByMmsi(mmsi) {
  if (!mmsi) return null;
  const m = String(mmsi);

  // Specific known vessels first
  if (KNOWN_VESSELS[m]) return KNOWN_VESSELS[m].vclass;

  // AtoN buoys — don't show vessel marker
  if (m.startsWith('99')) return null;

  // SAR aircraft MMSI (usually starts with 111, but leaving 970 if it was used for something specific)
  if (m.startsWith('970')) return 'sar';

  return null;  // fall through to vessel_type
}

export function classifyVessel(typeCode, mmsi) {
  if (mmsi && String(mmsi).startsWith('99')) return null;
  const byMmsi = classifyByMmsi(mmsi);
  if (byMmsi) return byMmsi;

  if (typeCode === null || typeCode === undefined) return 'unknown';
  const t = parseInt(typeCode);
  if (isNaN(t)) return 'unknown';
  if (t === 30)                     return 'fishing';
  if (t === 31 || t === 32)         return 'tug';      // towing
  if (t === 33 || t === 34)         return 'tug';      // towing/dredging
  if (t === 35)                     return 'military';  // military operations
  if (t === 36)                     return 'sailing';
  if (t === 37)                     return 'sailing';  // pleasure craft
  if (t >= 40 && t <= 49)           return 'hsc';      // high speed craft
  if (t === 50)                     return 'pilot';
  if (t === 51)                     return 'sar';      // SAR
  if (t === 52)                     return 'tug';
  if (t === 55)                     return 'law';      // law enforcement
  if (t >= 60 && t <= 69)           return 'passenger';
  if (t >= 70 && t <= 79)           return 'cargo';
  if (t >= 80 && t <= 89)           return 'tanker';
  if (t >= 90 && t <= 99)           return 'other';
  return 'unknown';
}


// Color per vessel class
export const VESSEL_CLASS_COLOR = {
  military:  '#c0392b',   // dark red (military/navy)
  fishing:   '#2ecc71',   // green
  tug:       '#e67e22',   // orange
  sailing:   '#9b59b6',   // purple
  hsc:       '#e67e22',   // orange (high speed craft)
  pilot:     '#2c3e50',   // dark grey/blue
  sar:       '#e74c3c',   // red (Search and Rescue / Military / Gov)
  law:       '#e74c3c',   // red
  passenger: '#f1c40f',   // yellow
  cargo:     '#34495e',   // dark grey
  tanker:    '#3498db',   // blue
  other:     '#2c3e50',   // dark grey
  unknown:   '#2c3e50',   // dark grey
};

// ─── SVG shapes by vessel class ─────────────────────────────────────────────
export function makeVesselSvg(vclass, color, heading, isSelected) {
  const rot  = (heading === 511 || heading == null) ? 0 : heading;
  const sel  = isSelected ? `stroke="#ffaa00" stroke-width="1.5"` : '';
  const glow = isSelected
    ? `filter: drop-shadow(0 0 8px ${color});`
    : `filter: drop-shadow(0 0 3px ${color}88);`;
  const wrap = (inner, w=28, h=28) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="-14 -14 28 28" style="transform:rotate(${rot}deg); ${glow}">${inner}</svg>`;

  switch (vclass) {
    // ── Cargo / Tanker: wide boxy ship silhouette ─────────────────────────
    case 'cargo':
    case 'tanker':
      return wrap(
        `<polygon points="0,-12 6,-4 6,10 3,12 -3,12 -6,10 -6,-4" fill="${color}" ${sel}/>
         <rect x="-3" y="-6" width="6" height="5" rx="0.5" fill="#000" opacity="0.3"/>`,
      );

    // ── Passenger: slightly wider, rounded  ───────────────────────────────
    case 'passenger':
    case 'hsc':
      return wrap(
        `<polygon points="0,-13 5,-2 5,10 2,12 -2,12 -5,10 -5,-2" fill="${color}" ${sel}/>
         <rect x="-3" y="-5" width="6" height="4" rx="1" fill="#fff" opacity="0.2"/>`,
      );

    // ── Tug: short and wide ───────────────────────────────────────────────
    case 'tug':
      return wrap(
        `<polygon points="0,-8 6,-2 7,8 4,11 -4,11 -7,8 -6,-2" fill="${color}" ${sel}/>
         <circle cx="0" cy="1" r="3" fill="#000" opacity="0.25"/>`,
      );

    // ── Fishing: triangular with outriggers ───────────────────────────────
    case 'fishing':
      return wrap(
        `<polygon points="0,-12 4,8 0,6 -4,8" fill="${color}" ${sel}/>
         <line x1="-9" y1="1" x2="9" y2="1" stroke="${color}" stroke-width="1.5"/>
         <circle cx="-9" cy="1" r="2" fill="${color}"/>
         <circle cx="9"  cy="1" r="2" fill="${color}"/>`,
      );

    // ── Sailing: tall mast silhouette ─────────────────────────────────────
    case 'sailing':
      return wrap(
        `<polygon points="0,-13 3,8 0,6 -3,8" fill="${color}" ${sel}/>
         <polygon points="0,-12 7,2 0,2" fill="${color}" opacity="0.6"/>
         <line x1="0" y1="-13" x2="0" y2="10" stroke="${color}" stroke-width="1.2"/>`,
      );

    // ── SAR / Law / Pilot: arrow with badge ───────────────────────────────
    case 'sar':
    case 'law':
    case 'pilot':
      return wrap(
        `<polygon points="0,-13 5,4 0,2 -5,4" fill="${color}" ${sel}/>
         <circle cx="0" cy="6" r="4.5" fill="${color}" opacity="0.8"/>
         <text x="0" y="9" text-anchor="middle" font-size="5" fill="#fff" font-weight="bold">!</text>`,
      );

    // ── Military / Warship: angular destroyer shape with helipad ─────────
    case 'military':
      return wrap(
        `<polygon points="0,-13 5,-2 7,8 5,11 -5,11 -7,8 -5,-2" fill="${color}" ${sel}/>
         <rect x="-5" y="7" width="10" height="4" rx="0.5" fill="#fff" opacity="0.25"/>
         <line x1="-4" y1="9" x2="4" y2="9" stroke="#fff" stroke-width="0.8" opacity="0.5"/>
         <circle cx="0" cy="9" r="2" fill="none" stroke="#fff" stroke-width="0.7" opacity="0.5"/>`,
      );

    // ── Unknown / Other: standard ship arrow ─────────────────────────────
    case 'other':
    case 'unknown':
    default:
      return wrap(
        `<polygon points="0,-12 4,-5 4,8 0,10 -4,8 -4,-5" fill="${color}" stroke="#333" stroke-width="1.5" ${sel}/>
         <circle cx="0" cy="0" r="2" fill="#333" opacity="0.6"/>`,
      );
  }
}

// ─── Friendly type name from vclass ──────────────────────────────────────────────
const VCLASS_LABEL = {
  military:  'Military Vessel',
  fishing:   'Commercial Fishing',
  tug:       'Harbor Tug',
  sailing:   'Sailing Vessel',
  hsc:       'High Speed Craft',
  pilot:     'Pilot Vessel',
  sar:       'Search & Rescue',
  law:       'Law Enforcement',
  passenger: 'Passenger',
  cargo:     'Cargo',
  tanker:    'Tanker',
  other:     'Unknown Type',
  unknown:   '',
};

// ─── Label ───────────────────────────────────────────────────────────────────
function makeVesselLabel(vessel, color, vclass, prediction) {
  const mmsi      = String(vessel.entity_id || '');
  const known     = KNOWN_VESSELS[mmsi];
  const knownName = known ? known.name : null;
  const name      = (vessel.vessel_name || knownName || vessel.callsign || '???').trim().toUpperCase();
  const isMmsi    = /^\d+$/.test(name);

  // Two-line header for military / coast guard
  const prefix = known?.prefix || null;

  // Type line: prefer known.vtype, fall back to vclass label, omit 'unknown'
  const vtype  = known?.vtype || VCLASS_LABEL[vclass] || '';

  const spd    = vessel.speed != null ? `${Math.round(vessel.speed)}kt` : '';
  const nav    = vessel.nav_status;
  const navLabels = { 0: 'UW', 1: 'ANCHOR', 5: 'MOORED', 6: 'AGROUND', 15: '' };
  const navStr = nav != null ? (navLabels[nav] ?? '') : '';

  // Destination: prefer AIS-declared, fall back to predictor
  const aisDest   = vessel.destination ? vessel.destination.trim() : '';
  const predDest  = prediction?.predicted_dest || '';
  const predConf  = prediction?.confidence || 0;
  const predMethod = prediction?.method || '';

  // Show AIS dest always; show predicted only if no AIS dest and confidence > 0.3
  const showAisDest  = !!aisDest;
  const showPredDest = !aisDest && predDest && predConf > 0.3;

  let lines = '';
  if (prefix) {
    lines += `<div class="ac-label-line" style="font-size:9px;opacity:0.7;letter-spacing:0.5px">${prefix}</div>`;
  }
  if (isMmsi) {
    lines += `<div class="ac-label-line" style="font-size:10px;opacity:0.6">${name}</div>`;
  } else {
    lines += `<div class="ac-label-line">${name}</div>`;
  }
  if (vtype) {
    lines += `<div class="ac-label-line" style="font-size:9px;opacity:0.75">${vtype}</div>`;
  }
  if (spd || navStr) {
    lines += `<div class="ac-label-line">${[spd, navStr].filter(Boolean).join(' · ')}</div>`;
  }
  if (showAisDest) {
    lines += `<div class="ac-label-line">→ ${aisDest}</div>`;
  } else if (showPredDest) {
    const pct = Math.round(predConf * 100);
    const icon = predMethod === 'historical' ? '📊' : predMethod === 'ais_declared' ? '📡' : '🧭';
    lines += `<div class="ac-label-line" style="opacity:0.75;font-style:italic">${icon} ~${predDest} (${pct}%)</div>`;
  }
  return `<div class="ac-label">${lines}</div>`;
}

// ─── Dead-reckoning helpers ───────────────────────────────────────────────────
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_R_NM = 3440.065; // nautical miles
// Max projection: 5 minutes. Beyond that, a stale fix is better kept in place.
const MAX_DR_SECONDS = 300;
// Min speed threshold: below 0.3 kt a vessel is effectively stationary
const MIN_MOVING_KT = 0.3;

/**
 * Project a lat/lon forward using great-circle dead-reckoning.
 * @param {number} lat0   - starting latitude  (degrees)
 * @param {number} lon0   - starting longitude (degrees)
 * @param {number} cogDeg - course over ground  (degrees true, 0=N)
 * @param {number} sogKt  - speed over ground   (knots)
 * @param {number} elapsedSec - seconds to project forward
 * @returns {{ lat: number, lon: number }}
 */
function deadReckon(lat0, lon0, cogDeg, sogKt, elapsedSec) {
  if (sogKt < MIN_MOVING_KT || elapsedSec <= 0) return { lat: lat0, lon: lon0 };

  const distNm    = (sogKt * elapsedSec) / 3600;
  const angDist   = distNm / EARTH_R_NM;   // radians
  const bearingR  = cogDeg * DEG_TO_RAD;
  const lat0R     = lat0   * DEG_TO_RAD;
  const lon0R     = lon0   * DEG_TO_RAD;

  const lat1R = Math.asin(
    Math.sin(lat0R) * Math.cos(angDist) +
    Math.cos(lat0R) * Math.sin(angDist) * Math.cos(bearingR)
  );
  const lon1R = lon0R + Math.atan2(
    Math.sin(bearingR) * Math.sin(angDist) * Math.cos(lat0R),
    Math.cos(angDist) - Math.sin(lat0R) * Math.sin(lat1R)
  );

  return {
    lat: lat1R * RAD_TO_DEG,
    lon: lon1R * RAD_TO_DEG,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function VesselLayer({ vessels, selected, showLabels, onSelect, predictions }) {
  const map = useMap();
  const markersRef  = useRef({});
  const labelsRef   = useRef({});
  // Store per-vessel AIS fix data for dead-reckoning animation
  const fixDataRef  = useRef({});
  const rafRef      = useRef(null);

  // ── Static render: update icons/labels when props change ──────────────────
  useEffect(() => {
    const currentIds = new Set(vessels.map(v => v.entity_id));

    // Remove stale
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        map.removeLayer(markersRef.current[id]);
        delete markersRef.current[id];
        if (labelsRef.current[id]) {
          map.removeLayer(labelsRef.current[id]);
          delete labelsRef.current[id];
        }
        delete fixDataRef.current[id];
      }
    }

    for (const vessel of vessels) {
      const { entity_id, lat, lon } = vessel;
      if (!lat || !lon) continue;

      const isSelected = selected?.entity_id === entity_id;
      const heading    = vessel.heading ?? vessel.course ?? 0;
      const vclass     = classifyVessel(vessel.vessel_type, entity_id);
      const color      = VESSEL_CLASS_COLOR[vclass] || '#aaaaaa';

      // Server already filters out vessels > 30 min old.
      // Fade: fresh=1.0, 15min=0.75, 29min=0.55 (gentle visual cue for ageing)
      const ageSec  = vessel.age_seconds || 0;
      const opacity = Math.max(0.55, 1.0 - (ageSec / 1800) * 0.45);

      // Store fix data for the animation loop
      // recorded_at comes from the API as an ISO string; convert to ms epoch
      const fixTime = vessel.recorded_at
        ? new Date(vessel.recorded_at).getTime()
        : (Date.now() - ageSec * 1000);

      fixDataRef.current[entity_id] = {
        lat,
        lon,
        cog:       vessel.course  ?? null,   // course over ground
        sog:       vessel.speed   ?? 0,       // speed over ground (knots)
        heading:   heading,
        fixTimeMs: fixTime,
        vclass,
        color,
        opacity,
        isSelected,
      };

      const iconHtml = makeVesselSvg(vclass, color, heading, isSelected);
      const icon     = L.divIcon({ className: '', html: iconHtml, iconSize: [28, 28], iconAnchor: [14, 14] });

      if (markersRef.current[entity_id]) {
        markersRef.current[entity_id].setLatLng([lat, lon]).setIcon(icon).setOpacity(opacity);
        if (isSelected) markersRef.current[entity_id].setZIndexOffset(1000);
      } else {
        const marker = L.marker([lat, lon], { icon, zIndexOffset: isSelected ? 1000 : 0, opacity });
        marker.on('click', () => onSelect({ ...vessel, _type: 'vessel' }));
        marker.addTo(map);
        markersRef.current[entity_id] = marker;
      }

      if (showLabels) {
        const pred = (predictions || {})[entity_id];
        const labelHtml = makeVesselLabel(vessel, color, vclass, pred);
        const labelIcon = L.divIcon({
          className: '',
          html: `<div style="opacity:${opacity}">${labelHtml}</div>`,
          iconSize: [0, 0], iconAnchor: [0, 0]
        });
        if (labelsRef.current[entity_id]) {
          labelsRef.current[entity_id].setLatLng([lat, lon]).setIcon(labelIcon);
        } else {
          const label = L.marker([lat, lon], { icon: labelIcon, interactive: false });
          label.addTo(map);
          labelsRef.current[entity_id] = label;
        }
      } else if (labelsRef.current[entity_id]) {
        map.removeLayer(labelsRef.current[entity_id]);
        delete labelsRef.current[entity_id];
      }
    }
  }, [vessels, selected, showLabels, map, onSelect]);

  // ── Animation loop: dead-reckon positions each frame ──────────────────────
  useEffect(() => {
    let running = true;

    function animate() {
      if (!running) return;

      const nowMs = Date.now();

      for (const [id, fix] of Object.entries(fixDataRef.current)) {
        const marker = markersRef.current[id];
        const label  = labelsRef.current[id];
        if (!marker) continue;

        // Only dead-reckon moving vessels with a valid COG
        const { lat, lon, cog, sog, fixTimeMs } = fix;
        if (cog == null || sog < MIN_MOVING_KT) continue;

        const elapsedSec = Math.min((nowMs - fixTimeMs) / 1000, MAX_DR_SECONDS);
        if (elapsedSec <= 0) continue;

        const { lat: drLat, lon: drLon } = deadReckon(lat, lon, cog, sog, elapsedSec);

        marker.setLatLng([drLat, drLon]);
        if (label) label.setLatLng([drLat, drLon]);
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [map]); // run once per map mount — the loop reads fixDataRef which is always current

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    const markers = markersRef.current;
    const labels  = labelsRef.current;

    return () => {
      Object.values(markers).forEach(m => map.removeLayer(m));
      Object.values(labels).forEach(m => map.removeLayer(m));
      markersRef.current = {};
      labelsRef.current  = {};
      fixDataRef.current = {};
    };
  }, [map]);

  return null;
}
