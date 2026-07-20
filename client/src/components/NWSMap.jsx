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

// ── Harbor Approaches Layer ───────────────────────────────────────────
function HarborLayer({ apiBase, visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    fetch(`${apiBase}/static/harbor_approaches.geojson`)
      .then(r => r.json())
      .then(data => {
        layerRef.current?.remove();
        layerRef.current = L.geoJSON(data, {
          style: f => ({
            color:   f.properties?.color || '#0077ff',
            weight:  3,
            opacity: 0.85,
            dashArray: f.properties?.type === 'restricted' ? '6,4' : null,
          }),
          onEachFeature: (f, l) => {
            const p = f.properties || {};
            l.bindPopup(`
              <div class="nws-popup">
                <div class="nws-popup-title">⚓ ${p.name || 'Harbor'}</div>
                <div class="nws-popup-row"><span class="nws-popup-label">Island</span><span class="nws-popup-value">${p.island || ''}</span></div>
                <div class="nws-popup-row"><span class="nws-popup-label">Type</span><span class="nws-popup-value">${p.type || ''}</span></div>
                ${p.note ? `<div class="nws-popup-desc">${p.note}</div>` : ''}
              </div>
            `);
          },
        }).addTo(map);
      })
      .catch(e => console.warn('HarborLayer error:', e));

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, apiBase, map]);

  return null;
}

// ── Trade Routes Layer ────────────────────────────────────────────────
function TradeRouteLayer({ apiBase, visible, enabledRoutes, setEnabledRoutes, onRoutesLoaded }) {
  const map = useMap();
  const layerRef = useRef({});
  const [allRoutes, setAllRoutes] = useState([]);

  useEffect(() => {
    fetch(`${apiBase}/static/trade_routes.geojson`)
      .then(r => r.json())
      .then(data => {
        const features = data?.features || [];
        setAllRoutes(features);
        onRoutesLoaded?.(features);
        const init = {};
        features.forEach((f, i) => {
          const id = f.properties?.id || String(i);
          init[id] = true;
        });
        setEnabledRoutes(prev => ({ ...init, ...prev }));
      })
      .catch(e => console.warn('TradeRouteLayer load error:', e));
  }, [apiBase, onRoutesLoaded, setEnabledRoutes]);

  useEffect(() => {
    // Remove all existing route layers
    Object.values(layerRef.current).forEach(l => l.remove());
    layerRef.current = {};

    if (!visible || !allRoutes.length) return;

    allRoutes.forEach((feature, i) => {
      const p     = feature.properties || {};
      const id    = p.id || String(i);
      const color = p.color || '#2196F3';
      const weight = p.weight || 2;

      if (enabledRoutes[id] === false) return;

      const layer = L.geoJSON(feature, {
        style: { color, weight, opacity: 0.75 },
        onEachFeature: (f, l) => {
          const fp = f.properties || {};
          l.bindPopup(`
            <div class="nws-popup">
              <div class="nws-popup-title">🚢 ${fp.name || 'Trade Route'}</div>
              ${fp.operators    ? `<div class="nws-popup-row"><span class="nws-popup-label">Operators</span><span class="nws-popup-value">${fp.operators}</span></div>` : ''}
              ${fp.vessel_types ? `<div class="nws-popup-row"><span class="nws-popup-label">Vessels</span><span class="nws-popup-value">${fp.vessel_types}</span></div>` : ''}
            </div>
          `);
        },
      }).addTo(map);
      layerRef.current[id] = layer;
    });
  }, [visible, allRoutes, enabledRoutes, map]);

  useEffect(() => () => { Object.values(layerRef.current).forEach(l => l.remove()); }, []);
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

// ── GEBCO Bathymetry Depth Tiles ──────────────────────────────────────
// GEBCO is a free, global ocean depth tileserver — works reliably
function DepthLayer({ visible }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!visible) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }

    layerRef.current = L.tileLayer(
      'https://tiles.gebco.net/tiles/gebco_latest/{z}/{x}/{y}.png',
      {
        opacity:     0.55,
        attribution: '<a href="https://www.gebco.net/">GEBCO</a>',
        maxZoom:     10,
      }
    ).addTo(map);

    return () => { layerRef.current?.remove(); layerRef.current = null; };
  }, [visible, map]);

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
  const [showHarbor,  setShowHarbor]  = useState(true);
  const [showRoutes,  setShowRoutes]  = useState(true);
  const [showDepth,   setShowDepth]   = useState(false);
  const [showSST,     setShowSST]     = useState(false);
  const [showWaves,   setShowWaves]   = useState(false);

  const [enabledRoutes, setEnabledRoutes] = useState({});
  const [routeFeatures, setRouteFeatures] = useState([]);

  const handleRoutesLoaded = useCallback((features) => setRouteFeatures(features), []);

  return (
    <div className="nws-map-container">
      {/* Map area — no sub-tabs (NWSApp top nav handles Air vs Water) */}
      <div className="nws-map-area">
        {/* Left sidebar */}
        <div className="nws-map-sidebar">
          {subtab === 'air' && (
            <>
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
              <LayerGroup label="Fishing">
                <LayerToggle id="nws-fads"    label="FAD Locations"    checked={showFADs}   onChange={e => setShowFADs(e.target.checked)} />
              </LayerGroup>
              <LayerGroup label="Navigation">
                <LayerToggle id="nws-harbor" label="Harbor Approaches" checked={showHarbor} onChange={e => setShowHarbor(e.target.checked)} />
                <LayerToggle id="nws-routes" label="Trade Routes"      checked={showRoutes} onChange={e => setShowRoutes(e.target.checked)} />
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

          {/* ── AIR layers ── */}
          <NWSObsLayer   apiBase={apiBase} visible={subtab === 'air' && showObs} />
          <AlertsLayer   apiBase={apiBase} visible={subtab === 'air' && showAlerts} />
          <NWSRadarLayer visible={subtab === 'air' && showRadar} />

          {/* ── WATER layers ── */}
          <FADLayer    apiBase={apiBase} visible={subtab === 'water' && showFADs} />
          <HarborLayer apiBase={apiBase} visible={subtab === 'water' && showHarbor} />
          <TradeRouteLayer
            apiBase={apiBase}
            visible={subtab === 'water' && showRoutes}
            enabledRoutes={enabledRoutes}
            setEnabledRoutes={setEnabledRoutes}
            onRoutesLoaded={handleRoutesLoaded}
          />
          <DepthLayer      visible={subtab === 'water' && showDepth} />
          <SSTLayer        visible={subtab === 'water' && showSST} />
          <WaveHeightLayer visible={subtab === 'water' && showWaves} />
        </MapContainer>

        {/* Right panel: per-route toggles */}
        {subtab === 'water' && showRoutes && routeFeatures.length > 0 && (
          <div className="nws-route-panel">
            <div className="nws-route-panel-label">Routes</div>
            {routeFeatures.map((f, i) => {
              const p     = f.properties || {};
              const id    = p.id || String(i);
              const name  = p.name || `Route ${i + 1}`;
              const color = p.color || '#29b6f6';
              const checked = enabledRoutes[id] !== false;
              return (
                <label key={id} className="nws-route-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => setEnabledRoutes(prev => ({ ...prev, [id]: e.target.checked }))}
                  />
                  <div className="nws-route-swatch" style={{ background: color }} />
                  <span className="nws-route-name">{name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
