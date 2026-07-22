import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// ── FlightRouteLayer ──────────────────────────────────────────────────────────
// When a commercial aircraft with a known flight number is selected, draws a
// great-circle arc from its origin airport to destination airport.
//
// Props:
//   selectedEntity – the entity selected in the sidebar { entity_type, identifier, callsign, flight }
//                    OR null
//   apiBase        – e.g. "http://192.168.1.108:3001"
//   visible        – if false, route is hidden

const ROUTE_CACHE = new Map(); // flight_number → route data, cached for session lifetime

const PANE_NAME = 'flightRoutePane';

// Interpolate great-circle points between two lat/lon pairs.
// Uses simple spherical linear interpolation (adequate for display).
function greatCirclePoints(lat1, lon1, lat2, lon2, n = 50) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    // Linear interpolation — adequate for distances < 5000 nm
    const lat = lat1 + f * (lat2 - lat1);
    const lon = lon1 + f * (lon2 - lon1);
    pts.push([lat, lon]);
  }
  return pts;
}

function airportIcon(iata) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background: rgba(255,159,28,0.18);
      border: 1.5px solid #ff9f1c;
      border-radius: 4px;
      padding: 2px 5px;
      font: bold 11px/1.3 sans-serif;
      color: #ff9f1c;
      white-space: nowrap;
      pointer-events: none;
    ">${iata}</div>`,
    iconSize: [36, 20],
    iconAnchor: [18, 10],
  });
}

export default function FlightRouteLayer({ selectedEntity, apiBase, visible }) {
  const map      = useMap();
  const layerRef = useRef(null);

  // Ensure custom pane
  useEffect(() => {
    if (!map.getPane(PANE_NAME)) {
      const pane = map.createPane(PANE_NAME);
      pane.style.zIndex = '360';
      pane.style.pointerEvents = 'none';
    }
  }, [map]);

  function clearLayers() {
    if (layerRef.current) {
      layerRef.current.clearLayers();
      layerRef.current.remove();
      layerRef.current = null;
    }
  }

  useEffect(() => {
    clearLayers();

    // Only draw for aircraft with a flight number
    if (!visible || !selectedEntity) return;
    if (selectedEntity.entity_type !== 'aircraft') return;

    // Extract flight number from the entity (may be stored in callsign or identifier fields)
    // The sidebar entity has: entity_type, identifier (icao_hex), name (registration/icao)
    // But when selected via VesselLayer click, it may have callsign/flight attached
    const flightNumber = selectedEntity.flight || selectedEntity.callsign;
    if (!flightNumber) return;

    // Filter out non-commercial identifiers (pure ICAO hex, N-numbers without letters beyond N)
    if (/^[0-9a-f]{6}$/i.test(flightNumber)) return;  // raw ICAO hex — not a flight number
    if (/^N\d{1,5}[A-Z]?$/i.test(flightNumber)) return; // N-number — not a flight number

    const fn = flightNumber.toUpperCase().replace(/\s/g, '');

    let cancelled = false;

    async function fetchAndDraw() {
      try {
        // Check cache first
        let route = ROUTE_CACHE.get(fn);
        if (!route) {
          const res = await fetch(`${apiBase}/api/flight-route/${fn}`);
          if (!res.ok) return; // 404 = not found, silently skip
          route = await res.json();
          ROUTE_CACHE.set(fn, route);
        }

        if (cancelled) return;
        if (!route.origin_lat || !route.dest_lat) return;

        layerRef.current = L.layerGroup([], { pane: PANE_NAME });

        // Great-circle arc
        const pts = greatCirclePoints(
          route.origin_lat, route.origin_lon,
          route.dest_lat,   route.dest_lon,
          60
        );

        L.polyline(pts, {
          color:     '#ff9f1c',
          weight:    2,
          opacity:   0.75,
          dashArray: '8 6',
          pane:      PANE_NAME,
          interactive: false,
        }).addTo(layerRef.current);

        // Origin marker
        L.marker([route.origin_lat, route.origin_lon], {
          icon:        airportIcon(route.origin_iata || '?'),
          pane:        PANE_NAME,
          interactive: false,
        }).addTo(layerRef.current);

        // Destination marker
        L.marker([route.dest_lat, route.dest_lon], {
          icon:        airportIcon(route.dest_iata || '?'),
          pane:        PANE_NAME,
          interactive: false,
        }).addTo(layerRef.current);

        layerRef.current.addTo(map);
      } catch (err) {
        if (!cancelled) console.warn('[FlightRouteLayer] error:', err);
      }
    }

    fetchAndDraw();

    return () => {
      cancelled = true;
      clearLayers();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntity?.entity_type, selectedEntity?.identifier, selectedEntity?.flight,
      selectedEntity?.callsign, visible, apiBase]);

  return null;
}
