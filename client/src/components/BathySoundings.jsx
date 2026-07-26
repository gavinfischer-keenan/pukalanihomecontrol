import { useEffect, useRef, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// ─────────────────────────────────────────────────────────────────────
// BathySoundings — NOAA-chart-style depth labels on the main map
//
// Renders depth soundings from /api/bathymetry with zoom-adaptive
// density and font sizing, matching NOAA Raster Nautical Chart style.
// ─────────────────────────────────────────────────────────────────────

const _cache = {};

async function fetchPoints(zoom) {
  const key = String(Math.min(13, Math.max(7, Math.floor(zoom))));
  if (_cache[key]) return _cache[key];
  try {
    const res = await fetch(`http://${window.location.hostname}:3001/api/bathymetry?zoom=${key}`);
    const data = await res.json();
    if (data.points) {
      _cache[key] = data.points;
      console.log(`[BATHY] Main map cached zoom ${key}: ${data.points.length} pts`);
    }
    return _cache[key] || [];
  } catch { return []; }
}

// Zoom-dependent font size — smaller at overview, larger when zoomed in
function fontSize(zoom) {
  if (zoom <= 7) return 8;
  if (zoom <= 8) return 9;
  if (zoom <= 9) return 9;
  if (zoom <= 10) return 10;
  if (zoom <= 11) return 10;
  return 11;
}

// Zoom-dependent opacity
function labelOpacity(zoom) {
  if (zoom <= 7) return 0.45;
  if (zoom <= 8) return 0.5;
  if (zoom <= 9) return 0.55;
  if (zoom <= 10) return 0.6;
  return 0.7;
}

export default function BathySoundings() {
  const map = useMap();
  const markersRef = useRef([]);
  const lastZoomRef = useRef(null);
  const renderingRef = useRef(false);
  const paneCreated = useRef(false);

  const renderSoundings = useCallback(async () => {
    if (renderingRef.current) return;
    renderingRef.current = true;

    if (!paneCreated.current) {
      if (!map.getPane('bathyPane')) {
        const p = map.createPane('bathyPane');
        p.style.zIndex = 260;
        p.style.pointerEvents = 'none';
      }
      paneCreated.current = true;
    }

    const zoom = Math.floor(map.getZoom());
    const bounds = map.getBounds();

    // Pan only (same zoom) — just toggle visibility
    if (zoom === lastZoomRef.current) {
      for (const m of markersRef.current) {
        const inView = bounds.contains(m.getLatLng());
        if (m._inView !== inView) {
          m.setOpacity(inView ? labelOpacity(zoom) : 0);
          m._inView = inView;
        }
      }
      renderingRef.current = false;
      return;
    }

    lastZoomRef.current = zoom;

    // Remove old markers
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    const points = await fetchPoints(zoom);
    if (!points?.length) { renderingRef.current = false; return; }

    const fs = fontSize(zoom);
    const op = labelOpacity(zoom);
    const inView = points.filter(([lat, lon]) => bounds.contains([lat, lon]));

    // Cap visible markers for performance (important at high zoom)
    const maxMarkers = 8000;
    const stride = inView.length > maxMarkers ? Math.ceil(inView.length / maxMarkers) : 1;
    const newMarkers = [];

    for (let i = 0; i < inView.length; i += stride) {
      const [lat, lon, depth] = inView[i];
      const label = depth >= 1000
        ? (depth / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
        : String(depth);
      const m = L.marker([lat, lon], {
        pane: 'bathyPane',
        icon: L.divIcon({
          className: 'bathy-sounding',
          html: `<span style="font-size:${fs}px">${label}</span>`,
          iconSize: null,
          iconAnchor: [0, 0],
        }),
        interactive: false,
        opacity: op,
      }).addTo(map);
      m._inView = true;
      newMarkers.push(m);
    }
    markersRef.current = newMarkers;
    renderingRef.current = false;
  }, [map]);

  useEffect(() => {
    renderSoundings();
    map.on('moveend', renderSoundings);
    map.on('zoomend', renderSoundings);
    return () => {
      map.off('moveend', renderSoundings);
      map.off('zoomend', renderSoundings);
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
    };
  }, [map, renderSoundings]);

  return null;
}
