import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PANE_NAME = 'routeCorridorPane';
const PANE_Z_INDEX = 350;
const MAX_SESSIONS = 150;

const COLORS = {
  vessel:   { color: '#00c97a', opacity: 0.20, weight: 4 },
  aircraft: { color: '#3b9eff', opacity: 0.18, weight: 3 },
};

// ---------------------------------------------------------------------------
// RouteCorridorLayer
// ---------------------------------------------------------------------------
// A render-less react-leaflet component. Returns null — all map interaction
// goes through the Leaflet L API directly.

export default function RouteCorridorLayer({ entity, apiBase, visible }) {
  const map = useMap();
  const layerGroupRef = useRef(null);
  const infoControlRef = useRef(null);
  const abortRef = useRef(null);

  // ── Ensure custom pane exists ─────────────────────────────────────────────
  useEffect(() => {
    if (!map.getPane(PANE_NAME)) {
      map.createPane(PANE_NAME);
      map.getPane(PANE_NAME).style.zIndex = String(PANE_Z_INDEX);
      // Pane should receive pointer events so tooltips work, but not block map clicks
      map.getPane(PANE_NAME).style.pointerEvents = 'none';
    }
  }, [map]);

  // ── Cleanup helper ────────────────────────────────────────────────────────
  function clearLayers() {
    if (layerGroupRef.current) {
      layerGroupRef.current.clearLayers();
      map.removeLayer(layerGroupRef.current);
      layerGroupRef.current = null;
    }
    if (infoControlRef.current) {
      infoControlRef.current.remove();
      infoControlRef.current = null;
    }
  }

  // ── Add info control ──────────────────────────────────────────────────────
  function addInfoLabel(count, entityName) {
    if (infoControlRef.current) {
      infoControlRef.current.remove();
    }
    const ctrl = L.control({ position: 'bottomleft' });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create('div', 'route-corridor-info');
      div.style.cssText = [
        'background: rgba(10,14,22,0.80)',
        'backdrop-filter: blur(8px)',
        'color: rgba(255,255,255,0.85)',
        'border: 1px solid rgba(255,255,255,0.10)',
        'border-radius: 8px',
        'padding: 6px 11px',
        'font-family: Inter, Segoe UI, system-ui, sans-serif',
        'font-size: 12px',
        'font-weight: 500',
        'pointer-events: none',
        'white-space: nowrap',
        'box-shadow: 0 4px 16px rgba(0,0,0,0.45)',
      ].join(';');
      div.innerHTML = `📍 Route history: <strong style="color:#fff">${count} track${count !== 1 ? 's' : ''}</strong>${entityName ? ` · ${entityName}` : ''}`;
      return div;
    };
    ctrl.addTo(map);
    infoControlRef.current = ctrl;
  }

  // ── Main fetch + render effect ────────────────────────────────────────────
  useEffect(() => {
    // Remove previous layers whenever entity or visibility changes
    clearLayers();

    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    if (!entity || !visible) return;

    const controller = new AbortController();
    abortRef.current = controller;

    const url = `${apiBase}/api/known-entities/${entity.entity_type}/${entity.identifier}/track-history?days=90`;

    async function fetchAndRender() {
      let data;
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        data = await res.json();
      } catch (err) {
        if (err.name === 'AbortError') return; // cancelled — do nothing
        console.error('[RouteCorridorLayer] fetch error:', err);
        return;
      }

      const sessions = (data.sessions || []).slice(0, MAX_SESSIONS);
      if (sessions.length === 0) return;

      const style = COLORS[entity.entity_type] ?? COLORS.vessel;
      const layerGroup = L.layerGroup([], { pane: PANE_NAME });

      for (const session of sessions) {
        if (!Array.isArray(session.points) || session.points.length < 2) continue;

        // Decode [[lat, lon, epoch], ...] → [[lat, lon], ...]
        const latlngs = session.points.map(([lat, lon]) => [lat, lon]);

        const polyline = L.polyline(latlngs, {
          color:   style.color,
          opacity: style.opacity,
          weight:  style.weight,
          pane:    PANE_NAME,
          interactive: false,
        });

        // Optional tooltip with date on hover (uses map-level pointer events via pane)
        if (session.track_date) {
          polyline.bindTooltip(
            `<span style="font-size:11px;font-family:Inter,sans-serif">${session.track_date}</span>`,
            { sticky: true, opacity: 0.85, className: 'route-corridor-tooltip' }
          );
        }

        layerGroup.addLayer(polyline);
      }

      layerGroup.addTo(map);
      layerGroupRef.current = layerGroup;

      const displayName = entity.friendly_name || entity.name || entity.identifier;
      addInfoLabel(sessions.length, displayName);
    }

    fetchAndRender();

    // Cleanup on unmount or before next run
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      clearLayers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, visible, apiBase]);

  // This component renders nothing — all interaction is via the Leaflet API.
  return null;
}
