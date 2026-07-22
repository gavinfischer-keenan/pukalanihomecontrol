import { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './NWSMap.css';

// ── Constants ──────────────────────────────────────────────────────────
const HI_CENTER   = [20.5, -157.5];
const HI_ZOOM     = 7;
const MAX_BOUNDS  = [[16, -165], [24, -152]];
const OCEAN_TILE  = 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}';
const OCEAN_ATTR  = 'Tiles &copy; Esri &mdash; Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB, National Geographic, DeLorme, NAVTEQ, and Esri';

// ── PacIOOS / NOAA WMS base URLs (from gavinfischer-keenan/Hawaii repo) ─
const PACIOOS_THREDDS = 'https://pae-paha.pacioos.hawaii.edu/thredds/wms';

// ── Temp colour helper ─────────────────────────────────────────────────
function tempColor(tempF) {
  if (tempF == null) return '#78909c';
  if (tempF >= 90) return '#ff1744';
  if (tempF >= 80) return '#ff9100';
  if (tempF >= 70) return '#ffea00';
  if (tempF >= 60) return '#69f0ae';
  if (tempF >= 50) return '#29b6f6';
  return '#7c4dff';
}

function parseTempF(description) {
  if (!description) return null;
  const m = description.match(/[Tt]emp(?:erature)?[:\s]+(-?\d+(?:\.\d+)?)\s*°?\s*F/);
  if (m) return parseFloat(m[1]);
  const mc = description.match(/[Tt]emp(?:erature)?[:\s]+(-?\d+(?:\.\d+)?)\s*°?\s*C/);
  if (mc) return parseFloat(mc[1]) * 9 / 5 + 32;
  return null;
}

function parseWind(description) {
  if (!description) return '';
  const m = description.match(/[Ww]ind[:\s]+(.{0,50}?)(?:\.|;|$)/);
  return m ? m[1].trim() : '';
}

function alertColor(event) {
  if (!event) return '#ff9100';
  const ev = event.toLowerCase();
  if (ev.includes('warning')) return '#ff1744';
  if (ev.includes('watch'))   return '#ff9100';
  if (ev.includes('advisory'))return '#ffea00';
  return '#ff6f00';
}

// ── NWS Obs Layer ──────────────────────────────────────────────────────
function NWSObsLayer({ apiBase, visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  const fetchAndRender = useCallback(async () => {
    if (!visible) return;
    try {
      const res = await fetch(`${apiBase}/api/nws/obs`);
      const geojson = await res.json();

      layerRef.current?.remove();
      layerRef.current = null;

      if (!geojson?.features?.length) return;

      layerRef.current = L.geoJSON(geojson, {
        pointToLayer: (feature, latlng) => {
          const desc  = feature.properties?.description || '';
          const name  = feature.properties?.name || feature.properties?.stationIdentifier || 'Station';
          const tempF = parseTempF(desc);
          const color = tempColor(tempF);
          return L.circleMarker(latlng, {
            radius:      7,
            fillColor:   color,
            color:       '#fff',
            weight:      1,
            opacity:     0.9,
            fillOpacity: 0.85,
          }).bindPopup(`
            <div class="nws-popup">
              <div class="nws-popup-title">🌡️ ${name}</div>
              <div class="nws-popup-row">
                <span class="nws-popup-label">Temp</span>
                <span class="nws-popup-value">${tempF != null ? tempF.toFixed(0) + '°F' : 'N/A'}</span>
              </div>
              <div class="nws-popup-row">
                <span class="nws-popup-label">Wind</span>
                <span class="nws-popup-value">${parseWind(desc) || 'N/A'}</span>
              </div>
              <div class="nws-popup-desc">${desc.slice(0, 200)}${desc.length > 200 ? '…' : ''}</div>
            </div>
          `);
        },
      }).addTo(map);
    } catch (e) {
      console.warn('NWSObsLayer fetch error:', e);
    }
  }, [apiBase, map, visible]);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }
    fetchAndRender();
    const t = setInterval(fetchAndRender, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [visible, fetchAndRender]);

  useEffect(() => () => { layerRef.current?.remove(); }, []);
  return null;
}

// ── Active Alerts Layer ───────────────────────────────────────────────
function AlertsLayer({ apiBase, visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  const fetchAndRender = useCallback(async () => {
    if (!visible) return;
    try {
      const res = await fetch(`${apiBase}/api/nws/alerts`);
      const data = await res.json();
      const features = Array.isArray(data?.features) ? data.features
                      : Array.isArray(data) ? data : [];

      layerRef.current?.remove();
      layerRef.current = null;
      if (!features.length) return;

      layerRef.current = L.layerGroup();
      features.forEach(f => {
        const props = f.properties || {};
        const event = props.event || 'Alert';
        const color = alertColor(event);
        const geo   = f.geometry;
        if (!geo) return;

        let alertLayer;
        try {
          alertLayer = L.geoJSON(f, {
            style:      { color, weight: 2, fillOpacity: 0.15 },
            pointToLayer: (ft, ll) => L.circleMarker(ll, { radius: 8, color, fillOpacity: 0.7 }),
          }).bindPopup(`
            <div class="nws-popup">
              <div class="nws-popup-title" style="color:${color}">⚠ ${event}</div>
              ${props.headline ? `<div class="nws-popup-row"><span class="nws-popup-value">${props.headline}</span></div>` : ''}
              ${props.areaDesc ? `<div class="nws-popup-row"><span class="nws-popup-label">Area</span><span class="nws-popup-value">${props.areaDesc}</span></div>` : ''}
            </div>
          `);
        } catch (_) { return; }
        alertLayer.addTo(layerRef.current);
      });
      layerRef.current.addTo(map);
    } catch (e) {
      console.warn('AlertsLayer fetch error:', e);
    }
  }, [apiBase, map, visible]);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }
    fetchAndRender();
    const t = setInterval(fetchAndRender, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [visible, fetchAndRender]);

  useEffect(() => () => { layerRef.current?.remove(); }, []);
  return null;
}

// ── NEXRAD Radar Layer (Iowa State Ridge map) ─────────────────────────
function NWSRadarLayer({ visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }
    layerRef.current = L.tileLayer(
      'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png',
      { opacity: 0.7, attribution: 'Iowa State Mesonet NEXRAD' }
    ).addTo(map);
    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, map]);

  return null;
}

// ── FAD Layer — Hawaii DLNR Fish Aggregating Devices ─────────────────
function FADLayer({ apiBase, visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    // Load from static GeoJSON (fishing_areas.geojson holds FAD points)
    fetch(`${apiBase}/static/fishing_areas.geojson`)
      .then(r => r.json())
      .then(data => {
        layerRef.current?.remove();
        layerRef.current = null;

        const features = data?.features || [];
        if (!features.length) return;

        layerRef.current = L.layerGroup();
        features.forEach(f => {
          const coords = f.geometry?.coordinates;
          if (!coords) return;
          const props = f.properties || {};
          const latlng = [coords[1], coords[0]];

          // Bright orange buoy icon
          const icon = L.divIcon({
            className: '',
            html: `<div style="
              width:14px;height:14px;
              background:#ff8c00;
              border:2px solid #fff;
              border-radius:50%;
              box-shadow:0 0 6px #ff8c00aa;
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });

          L.marker(latlng, { icon })
            .bindPopup(`
              <div class="nws-popup">
                <div class="nws-popup-title">🎣 FAD ${props.fad_id || ''} — ${props.name || 'FAD'}</div>
                <div class="nws-popup-row"><span class="nws-popup-label">Island</span><span class="nws-popup-value">${props.island || ''}</span></div>
                ${props.depth_m ? `<div class="nws-popup-row"><span class="nws-popup-label">Depth</span><span class="nws-popup-value">${props.depth_m}m</span></div>` : ''}
                ${props.description ? `<div class="nws-popup-desc">${props.description}</div>` : ''}
              </div>
            `)
            .addTo(layerRef.current);
        });
        layerRef.current.addTo(map);
      })
      .catch(e => console.warn('FAD layer error:', e));

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, apiBase, map]);

  return null;
}



// ── PacIOOS ROMS Sea Surface Temperature ─────────────────────────────
// Source: gavinfischer-keenan/Hawaii repo — roms_hiig, layer 'temp', colorscalerange 24-28°C
function SSTLayer({ visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    layerRef.current = L.tileLayer.wms(
      `${PACIOOS_THREDDS}/roms_hiig/ROMS_Hawaii_Regional_Ocean_Model_best.ncd`,
      {
        layers:         'temp',
        format:         'image/png',
        transparent:    true,
        opacity:        0.65,
        colorscalerange:'24,28',
        styles:         'boxfill/rainbow',
        attribution:    'PacIOOS ROMS Hawaii',
      }
    ).addTo(map);

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, map]);

  return null;
}

// ── PacIOOS SWAN Wave Height ──────────────────────────────────────────
// Three regional SWAN models covering Oahu, Maui, Kauai — layer 'shgt'
// Source: gavinfischer-keenan/Hawaii repo
function WaveHeightLayer({ visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  const WMS_OPTS = {
    layers:         'shgt',
    format:         'image/png',
    transparent:    true,
    opacity:        0.65,
    colorscalerange:'0,2.5',
    styles:         'boxfill/rainbow',
    attribution:    'PacIOOS SWAN',
  };

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    layerRef.current = L.layerGroup([
      L.tileLayer.wms(`${PACIOOS_THREDDS}/swan_oahu/SWAN_Oahu_Regional_Wave_Model_best.ncd`, WMS_OPTS),
      L.tileLayer.wms(`${PACIOOS_THREDDS}/swan_maui/SWAN_Maui_Regional_Wave_Model_best.ncd`, WMS_OPTS),
      L.tileLayer.wms(`${PACIOOS_THREDDS}/swan_kauai/SWAN_Kauai_Regional_Wave_Model_best.ncd`, WMS_OPTS),
    ]).addTo(map);

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, map]);

  return null;
}

// ── Ocean Depth / Bathymetry Overlay ──────────────────────────────────────
// Layer 1: Esri Ocean Reference — depth contour lines (static CDN tiles, browser-cached)
// Layer 2: Local NOAA ETOPO1 soundings from /api/bathymetry — zero ongoing external calls
//          Zoom-adaptive density: stride 30 at zoom 7, all 247k points at zoom 12+
//          Labels styled like official NOAA Raster Nautical Charts (blue italic)
// ─────────────────────────────────────────────────────────────────────────────

const _bathyZoomCache = {};

async function fetchBathyPoints(zoom) {
  const key = String(Math.min(13, Math.max(7, Math.floor(zoom))));
  if (_bathyZoomCache[key]) return _bathyZoomCache[key];
  try {
    const res  = await fetch(`/api/bathymetry?zoom=${key}`);
    const data = await res.json();
    if (data.points) {
      _bathyZoomCache[key] = data.points;
      console.log(`[BATHY] Cached zoom ${key}: ${data.points.length} points`);
    }
    return _bathyZoomCache[key] || [];
  } catch(e) { console.warn('[BATHY] fetch failed:', e.message); return []; }
}

function DepthLayer({ visible }) {
  const map         = useMap();
  const esriRef     = useRef(null);
  const markersRef  = useRef([]);
  const lastZoom    = useRef(null);
  const renderingRef = useRef(false);

  // Esri contour tile layer (isobaths, seafloor names)
  useEffect(() => {
    if (!map.getPane('depthPane')) {
      const p = map.createPane('depthPane');
      p.style.zIndex = 250;
      p.style.pointerEvents = 'none';
    }
    if (!visible) { esriRef.current?.remove(); esriRef.current = null; return; }
    if (!esriRef.current) {
      esriRef.current = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}',
        { pane: 'depthPane', opacity: 0.75, maxNativeZoom: 13, maxZoom: 18,
          attribution: 'Depth contours &copy; Esri, GEBCO, NOAA' }
      ).addTo(map);
    }
    return () => { esriRef.current?.remove(); esriRef.current = null; };
  }, [visible, map]);

  // Sounding labels from local ETOPO1 data
  const renderSoundings = useCallback(async () => {
    if (!visible || renderingRef.current) return;
    renderingRef.current = true;

    const zoom   = Math.floor(map.getZoom());
    const bounds = map.getBounds();

    // On pan (same zoom), just hide/show existing markers by bounds
    if (zoom === lastZoom.current) {
      markersRef.current.forEach(m => {
        const ll = m.getLatLng();
        const op = bounds.contains(ll) ? 1 : 0;
        if (m.options.opacity !== op) m.setOpacity(op);
      });
      renderingRef.current = false;
      return;
    }
    lastZoom.current = zoom;

    // Remove all existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    const points = await fetchBathyPoints(zoom);
    if (!points?.length) { renderingRef.current = false; return; }

    const inView = points.filter(([lat, lon]) => bounds.contains([lat, lon]));
    const newMarkers = [];

    for (const [lat, lon, depth] of inView) {
      // Format: 1k for 1000m+, integer otherwise — matching NOAA chart convention
      const label = depth >= 1000 ? (depth/1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(depth);
      const m = L.marker([lat, lon], {
        pane: 'depthPane',
        icon: L.divIcon({
          className: 'depth-sounding-label',
          html: `<span>${label}</span>`,
          iconSize: null, iconAnchor: [0, 0],
        }),
        interactive: false,
      }).addTo(map);
      newMarkers.push(m);
    }
    markersRef.current = newMarkers;
    renderingRef.current = false;
  }, [visible, map]);

  useEffect(() => {
    if (!visible) {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      lastZoom.current = null;
      return;
    }
    map.on('zoomend moveend', renderSoundings);
    renderSoundings();
    return () => {
      map.off('zoomend moveend', renderSoundings);
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
    };
  }, [visible, map, renderSoundings]);

  return null;
}

// ── Tropical Storm / Hurricane Layer ─────────────────────────────────────
// Shows markers for all active NHC storms on both Air and Water maps.
// Only displays storms within 3000 miles of Hawaii (avoids Atlantic clutter at default zoom).
function StormLayer({ apiBase, visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    const PUKALANI = [20.8783, -156.6825];

    fetch(`${apiBase}/api/hurricanes`)
      .then(r => r.json())
      .then(data => {
        if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
        layerRef.current = L.layerGroup();

        (data.storms || []).forEach(storm => {
          if (!storm.lat || !storm.lon) return;
          if (storm.distanceMi && storm.distanceMi > 3000) return; // skip far Atlantic storms

          const color = storm.intensity >= 64 ? '#ff4500' :
                        storm.intensity >= 34 ? '#ffd700' : '#87ceeb';

          // Draw line from Pukalani to storm
          if (storm.distanceMi && storm.distanceMi < 2000) {
            L.polyline([PUKALANI, [storm.lat, storm.lon]], {
              color: color, opacity: 0.3, weight: 1, dashArray: '4,6'
            }).addTo(layerRef.current);
          }

          // Storm marker
          const icon = L.divIcon({
            className: '',
            html: `<div style="
              width:36px;height:36px;border-radius:50%;
              background:${color}22;border:2px solid ${color};
              display:flex;align-items:center;justify-content:center;
              font-size:16px;cursor:pointer;
              box-shadow:0 0 12px ${color}66;
            ">🌀</div>`,
            iconSize: [36,36], iconAnchor: [18,18]
          });

          L.marker([storm.lat, storm.lon], { icon })
            .bindPopup(`
              <div style="min-width:200px;font-family:sans-serif">
                <b style="font-size:15px">🌀 ${storm.name}</b>
                <div style="color:${color};font-weight:600">${storm.classification} · ${storm.intensity} kt winds</div>
                <hr style="margin:6px 0;opacity:0.3">
                <div>📍 Distance: <b>${storm.distanceMi ? storm.distanceMi.toLocaleString() + ' mi' : 'unknown'}</b></div>
                <div>🧭 Bearing: <b>${storm.bearingDeg ?? '?'}°</b> from Pukalani</div>
                <div>➡ Moving: <b>${storm.movementSpeed} kt ${storm.movementDir ?? ''}°</b></div>
                ${storm.advisoryUrl ? `<div style="margin-top:8px"><a href="${storm.advisoryUrl}" target="_blank">📋 Read Advisory ↗</a></div>` : ''}
              </div>
            `)
            .addTo(layerRef.current);
        });

        layerRef.current.addTo(map);
      })
      .catch(e => console.warn('StormLayer fetch error:', e));

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, apiBase, map]);

  return null;
}

// ── Ocean Currents Layer (PacIOOS ROMS Hawaii) ────────────────────────────
// WMS tile overlay showing surface current speed/direction.
// Source: ROMS Hawaii Island Grid (roms_hiig) via PacIOOS THREDDS.
// Coverage: 163.8°W–152.5°W, 17°N–24°N (all main Hawaiian islands)
function CurrentsLayer({ visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    // PacIOOS Near-Real-Time HF Radar Surface Currents
    // Dataset: hfradar_ushi_2km — measured currents (~2km resolution, ~hourly)
    // Good citizen: tiles served via PacIOOS CDN, cached by browser
    //
    // WMS rendering fix: ERDDAP requires explicit STYLES and COLORSCALERANGE
    // vendor parameters to render u/v velocity components with visible colours.
    // 'boxfill/occam' is a diverging blue-red palette ideal for ±velocity data.
    // COLORSCALERANGE '-0.8,0.8' covers typical nearshore current speeds (m/s).
    const HF_WMS = 'https://pae-paha.pacioos.hawaii.edu/erddap/wms/hfradar_ushi_2km/request';

    // Build a tile URL with an hourly cache-bust so stale tiles refresh ~hourly
    // (Rounds current time to the nearest hour so we don't hammer the server)
    const hourKey = Math.floor(Date.now() / 3600000);

    const uLayer = L.tileLayer.wms(HF_WMS, {
      layers:         'hfradar_ushi_2km:u',
      styles:         'boxfill/occam',
      format:         'image/png',
      transparent:    true,
      opacity:        0.80,
      COLORSCALERANGE: '-0.8,0.8',
      BELOWMINCOLOR:  'extend',
      ABOVEMAXCOLOR:  'extend',
      _cache:         hourKey,   // hourly tile cache-bust — not sent to WMS
      attribution:    'PacIOOS HF Radar — Near Real-Time Surface Currents',
    });

    const vLayer = L.tileLayer.wms(HF_WMS, {
      layers:         'hfradar_ushi_2km:v',
      styles:         'boxfill/occam_r',   // reversed palette for N component
      format:         'image/png',
      transparent:    true,
      opacity:        0.50,
      COLORSCALERANGE: '-0.8,0.8',
      BELOWMINCOLOR:  'extend',
      ABOVEMAXCOLOR:  'extend',
      _cache:         hourKey,
      attribution:    '',
    });

    uLayer.addTo(map);
    vLayer.addTo(map);

    layerRef.current = uLayer;
    const origRemove = uLayer.remove.bind(uLayer);
    layerRef.current.remove = () => { origRemove(); vLayer.remove(); };

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, map]);

  return null;
}

// ── PacIOOS Buoy Marker Layer ─────────────────────────────────────────────
// Shows water quality and wave buoys as clickable map markers.
// Data sourced from PacIOOS ERDDAP, cached 6h server-side.
function BuoyMarkerLayer({ apiBase, visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    fetch(`${apiBase}/api/pacioos/buoys`)
      .then(r => r.json())
      .then(data => {
        if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
        layerRef.current = L.layerGroup();

        (data.buoys || []).forEach(buoy => {
          if (!buoy.lat || !buoy.lon) return;

          const isWave = buoy.type === 'wave';
          const emoji  = isWave ? '🌊' : '💧';
          const color  = isWave ? '#38bdf8' : '#34d399';
          const reading = buoy.reading || {};

          // Reading summary line
          let readingHtml = '';
          if (isWave) {
            const ht  = reading.sea_surface_wave_significant_height;
            const per = reading.sea_surface_wave_peak_period;
            const dir = reading.sea_surface_wave_from_direction;
            const sst = reading.sea_surface_temperature;
            if (ht != null)  readingHtml += `<div>Wave height: <b>${ht.toFixed(1)} m</b></div>`;
            if (per != null) readingHtml += `<div>Wave period: <b>${per.toFixed(0)} s</b></div>`;
            if (dir != null) readingHtml += `<div>Wave direction: <b>${Math.round(dir)}°</b></div>`;
            if (sst != null) readingHtml += `<div>SST: <b>${sst.toFixed(1)}°C</b></div>`;
          } else {
            const temp = reading.sea_water_temperature;
            const sal  = reading.sea_water_practical_salinity;
            const turb = reading.turbidity;
            const chl  = reading.mass_concentration_of_chlorophyll_in_sea_water;
            if (temp != null) readingHtml += `<div>Temperature: <b>${temp.toFixed(1)}°C</b></div>`;
            if (sal != null)  readingHtml += `<div>Salinity: <b>${sal.toFixed(1)} PSU</b></div>`;
            if (turb != null) readingHtml += `<div>Turbidity: <b>${turb.toFixed(1)} NTU</b></div>`;
            if (chl != null)  readingHtml += `<div>Chlorophyll: <b>${chl.toFixed(2)} µg/L</b></div>`;
          }

          const staleNote = buoy.isStale ? '<div style="color:#f97316;margin-top:6px">⚠ Data may be stale</div>' : '';
          const ageNote   = buoy.ageMinutes ? `<div style="color:#888;font-size:11px">Updated ${buoy.ageMinutes}m ago</div>` : '';

          const icon = L.divIcon({
            className: '',
            html: `<div style="
              width:28px;height:28px;border-radius:50%;
              background:${color}22;border:2px solid ${color};
              display:flex;align-items:center;justify-content:center;
              font-size:13px;cursor:pointer;
            ">${emoji}</div>`,
            iconSize: [28,28], iconAnchor: [14,14]
          });

          L.marker([buoy.lat, buoy.lon], { icon })
            .bindPopup(`
              <div style="min-width:180px;font-family:sans-serif">
                <b>${emoji} ${buoy.name}</b>
                <div style="color:#888;font-size:12px">${buoy.island} · ${isWave ? 'Wave Buoy' : 'Water Quality Buoy'}</div>
                <hr style="margin:6px 0;opacity:0.3">
                ${readingHtml || '<div style="color:#888">No data available</div>'}
                ${ageNote}${staleNote}
                <div style="margin-top:8px;font-size:11px;color:#888">PacIOOS / ${buoy.id}</div>
              </div>
            `)
            .addTo(layerRef.current);
        });

        layerRef.current.addTo(map);
      })
      .catch(e => console.warn('BuoyMarkerLayer error:', e));

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, apiBase, map]);

  return null;
}

// ── Sidebar helpers ────────────────────────────────────────────────────
function LayerGroup({ label, children }) {
  return (
    <div className="nws-layer-group">
      <div className="nws-layer-group-label">{label}</div>
      {children}
    </div>
  );
}

function LayerToggle({ id, label, checked, onChange }) {
  return (
    <label className={`nws-layer-toggle ${checked ? 'active' : ''}`}>
      <input type="checkbox" id={id} checked={checked} onChange={onChange} />
      <label htmlFor={id}>{label}</label>
    </label>
  );
}

// ── Main NWSMap component ─────────────────────────────────────────────
// subtab: 'air' | 'water' — controlled by NWSApp top nav.
// The duplicate sub-tabs have been removed; NWSApp handles Air/Water routing.
export default function NWSMap({ apiBase, subtab = 'air' }) {

  // AIR layer toggles
  const [showObs,    setShowObs]    = useState(true);
  const [showAlerts, setShowAlerts] = useState(true);
  const [showRadar,  setShowRadar]  = useState(false);

  // WATER layer toggles
  const [showFADs,    setShowFADs]    = useState(true);
  const [showDepth,   setShowDepth]   = useState(false);
  const [showSST,     setShowSST]     = useState(false);
  const [showWaves,   setShowWaves]   = useState(false);

  // Shared layers (visible on both Air and Water)
  const [showStorms,   setShowStorms]   = useState(true);   // show by default — always good to know

  // New Water-only layers
  const [showCurrents, setShowCurrents] = useState(false);
  const [showBuoys,    setShowBuoys]    = useState(true);   // buoys default on


  return (
    <div className="nws-map-container">
      {/* Map area — no sub-tabs (NWSApp top nav handles Air vs Water) */}
      <div className="nws-map-area">
        {/* Left sidebar */}
        <div className="nws-map-sidebar">
          {subtab === 'air' && (
            <>
              <LayerGroup label="Weather Systems">
                <LayerToggle id="nws-storms" label="🌀 Tropical Storms" checked={showStorms} onChange={e => setShowStorms(e.target.checked)} />
              </LayerGroup>
              <LayerGroup label="Observations">
                <LayerToggle id="nws-obs"    label="NWS Station Obs"  checked={showObs}    onChange={e => setShowObs(e.target.checked)} />
                <LayerToggle id="nws-alerts" label="Active Alerts"    checked={showAlerts} onChange={e => setShowAlerts(e.target.checked)} />
              </LayerGroup>
              <LayerGroup label="Radar">
                <LayerToggle id="nws-radar"  label="NEXRAD Radar"    checked={showRadar}  onChange={e => setShowRadar(e.target.checked)} />
              </LayerGroup>
            </>
          )}
          {subtab === 'water' && (
            <>
              <LayerGroup label="Weather Systems">
                <LayerToggle id="nws-storms-water" label="🌀 Tropical Storms" checked={showStorms} onChange={e => setShowStorms(e.target.checked)} />
              </LayerGroup>
              <LayerGroup label="Fishing">
                <LayerToggle id="nws-fads"    label="FAD Locations"    checked={showFADs}   onChange={e => setShowFADs(e.target.checked)} />
              </LayerGroup>
              <LayerGroup label="Navigation">
              </LayerGroup>
              <LayerGroup label="Currents &amp; Buoys">
                <LayerToggle id="nws-currents" label="🌊 Ocean Currents" checked={showCurrents} onChange={e => setShowCurrents(e.target.checked)} />
                <LayerToggle id="nws-buoys"    label="💧 Water Quality Buoys" checked={showBuoys} onChange={e => setShowBuoys(e.target.checked)} />
              </LayerGroup>
              <LayerGroup label="Ocean Data">
                <LayerToggle id="nws-depth" label="Depth (GEBCO)"     checked={showDepth}  onChange={e => setShowDepth(e.target.checked)} />
                <LayerToggle id="nws-sst"   label="Sea Surface Temp"  checked={showSST}    onChange={e => setShowSST(e.target.checked)} />
                <LayerToggle id="nws-waves" label="Wave Height (SWAN)"checked={showWaves}  onChange={e => setShowWaves(e.target.checked)} />
              </LayerGroup>
            </>
          )}
        </div>

        {/* Leaflet map */}
        <MapContainer
          className="nws-leaflet-container"
          center={HI_CENTER}
          zoom={HI_ZOOM}
          maxBounds={MAX_BOUNDS}
          maxBoundsViscosity={0.85}
          minZoom={6}
          maxZoom={14}
          zoomControl={true}
          scrollWheelZoom={true}
        >
          <TileLayer
            url={OCEAN_TILE}
            attribution={OCEAN_ATTR}
            subdomains="abcd"
            maxZoom={19}
          />

          {/* ── Shared layers (both Air & Water) ── */}
          <StormLayer apiBase={apiBase} visible={showStorms} />

          {/* ── AIR layers ── */}
          <NWSObsLayer   apiBase={apiBase} visible={subtab === 'air' && showObs} />
          <AlertsLayer   apiBase={apiBase} visible={subtab === 'air' && showAlerts} />
          <NWSRadarLayer visible={subtab === 'air' && showRadar} />

          {/* ── WATER layers ── */}
          <FADLayer    apiBase={apiBase} visible={subtab === 'water' && showFADs} />
          <DepthLayer      visible={subtab === 'water' && showDepth} />
          <SSTLayer        visible={subtab === 'water' && showSST} />
          <WaveHeightLayer visible={subtab === 'water' && showWaves} />

          {/* ── Additional WATER layers ── */}
          <CurrentsLayer visible={subtab === 'water' && showCurrents} />
          <BuoyMarkerLayer apiBase={apiBase} visible={subtab === 'water' && showBuoys} />
        </MapContainer>
      </div>
    </div>
  );
}
