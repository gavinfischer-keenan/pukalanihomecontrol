import { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import './components/LayerControl.css';

import AircraftLayer      from './components/AircraftLayer';
import VesselLayer        from './components/VesselLayer';
import TrailLayer         from './components/TrailLayer';
import BuoyLayer          from './components/BuoyLayer';
import SurfLayer          from './components/SurfLayer';
import TideLayer          from './components/TideLayer';
import MetarLayer         from './components/MetarLayer';
// HD_RADIO_DISABLED: import HDRadarLayer        from './components/HDRadarLayer';
// HD_RADIO_DISABLED: import HDTrafficLayer      from './components/HDTrafficLayer';
// HD_RADIO_DISABLED: import HDGasLayer          from './components/HDGasLayer';
// HD_RADIO_DISABLED: import HDRadioStatusPanel  from './components/HDRadioStatusPanel';
import SunMoonPanel       from './components/SunMoonPanel';
import TideChartModal     from './components/TideChartModal';
import ATISBar            from './components/ATISBar';
import DetailPanel        from './components/DetailPanel';
import LayerControl       from './components/LayerControl';
import StatusBar          from './components/StatusBar';
import RangeRings         from './components/RangeRings';
import HomeBase           from './components/HomeBase';
import ReferenceObjects   from './components/ReferenceObjects';
import RadarLayer         from './components/RadarLayer';
import './components/RadarLayer.css';
import ForecastPanel      from './components/ForecastPanel';
import EcowittLayer, { EcowittFloatingPanel } from './components/EcowittLayer';
import MapEventTracker    from './components/MapEventTracker';
import Legend             from './components/Legend';
import ErrorBoundary      from './components/ErrorBoundary';
// NWS/NOAA is a fully separate app at /nws/ — no imports here

const OAHU_CENTER = [21.3069, -157.8583];
const HOME_BASE   = { lat: 21.2861516, lon: -157.7935187, label: '3786 Pukalani Pl' };
const API_BASE    = `http://${window.location.hostname}:3001`;

// ── Default layer toggles ─────────────────────────────────────
const DEFAULT_LAYERS = {
  // Aviation
  aircraft:      { label: '✈️ Aircraft',           live: true,  enabled: true  },
  acTrails:      { label: '〰️ A/C Trails',          live: true,  enabled: true  },
  metar:         { label: '🛬 ATIS / Airport Wx',  live: true,  enabled: false },
  // Marine
  vessels:       { label: '⛵ Vessels',             live: true,  enabled: true  },
  vesselTrails:  { label: '〰️ Vessel Trails',       live: true,  enabled: true  },
  surf:          { label: '🏄 Wave Height / Surf',  live: true,  enabled: false },
  tides:         { label: '〰️ Tides',              live: true,  enabled: false },
  // Weather
  sunMoon:       { label: '☀️ Sun & Moon',           live: true,  enabled: false },
  radar:         { label: '🌧️ Radar',               live: true,  enabled: false },
  forecast:      { label: '📅 7-Day Forecast',        live: true,  enabled: false },
  fishing:       { label: '🎣 Fishing Index',         live: true,  enabled: false },
  localWx:       { label: '🌡️ Local Weather / PWS',  live: true,  enabled: false },
  // NWS/NOAA lives at /nws/ — fully separate app, no layer keys here
  // Home
  homeBase:      { label: '🏠 Home Base',           live: true,  enabled: true  },
  reference:     { label: '🧭 Reference Objects',   live: false, enabled: true  },
  rangeRings:    { label: '⊙ Range Rings',          live: true,  enabled: true  },
  cameras:       { label: '📷 Cameras',             live: false, enabled: false },
  poi:           { label: '📍 POI',                 live: false, enabled: false },
  // HD Radio — DISABLED for Hawaii (no data services broadcast).
  // Re-enable for Berkeley CA or other markets with TMC/weather/gas services.
  // hdRadar:    { label: '📡 HD Doppler Radar',  live: true, enabled: true },
  // hdTraffic:  { label: '🚗 HD Traffic',        live: true, enabled: true },
  // hdGas:      { label: '⛽ HD Gas Prices',      live: true, enabled: true },
  // hdRadio:    { label: '📻 HD Radio Status',    live: true, enabled: true },
};

// ── Basemaps ──────────────────────────────────────────────────
const BASE_MAPS = {
  ocean: {
    label: 'Ocean',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    overlay: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png',
    maxNativeZoom: 13,
    attribution: 'Tiles © Esri — Sources: GEBCO, NOAA, CHS, OSU, UNH, CSUMB',
  },
  dark: {
    label: 'Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  },
  streets: {
    label: 'Streets',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    overlay: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png',
    maxNativeZoom: 19,
    attribution: 'Tiles © Esri',
  },
  // ── USGS National Map Topographic ──
  topo: {
    label: 'Topo',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 16,
    attribution: 'USGS National Map',
  },
  // ── OpenTopoMap (OSM-based, hillshade + contours) ──
  otm: {
    label: 'OTM',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxNativeZoom: 17,
    attribution: '© OpenTopoMap contributors (CC-BY-SA)',
  },
  // ── NOAA Seamless Nautical Charts (RNC) ──
  noaa: {
    label: 'NOAA',
    url: 'https://seamlessrnc.nauticalcharts.noaa.gov/arcgis/rest/services/RNC/NOAA_RNC/ImageServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 16,
    attribution: 'NOAA Office of Coast Survey',
  },
};

// ── Polling hook ──────────────────────────────────────────────
function usePollWhenEnabled(url, interval, enabled) {
  const [data, setData] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const go = () =>
      fetch(url).then(r => r.json())
        .then(d => { if (active) setData(Array.isArray(d) ? d : []); })
        .catch(() => {});
    go();
    const t = setInterval(go, interval);
    return () => { active = false; clearInterval(t); };
  }, [url, interval, enabled]);
  return data;
}

// ── App ───────────────────────────────────────────────────────
function App() {
  const [aircraft,       setAircraft]       = useState([]);
  const [vessels,        setVessels]        = useState([]);
  const [selected,       setSelected]       = useState(null);
  const [tideStation,    setTideStation]    = useState(null);
  const [layers, setLayers] = useState(DEFAULT_LAYERS);
  const [showLabels,     setShowLabels]     = useState(true);
  const [showLegend,     setShowLegend]     = useState(false);
  const [mapBounds,      setMapBounds]      = useState(null);
  const [showPws,        setShowPws]        = useState(false);
  const [pwsData,        setPwsData]        = useState(null);
  const [pwsStale,       setPwsStale]       = useState(false);
  const [baseMap,        setBaseMap]        = useState('ocean');
  const [status,         setStatus]         = useState({ ok: false });
  const [lastUpdate,     setLastUpdate]     = useState(null);
  // Radar frame state — lifted up so RadarControls bar can render outside MapContainer
  const [radarFrames,    setRadarFrames]    = useState([]);
  const [radarFrameIdx,  setRadarFrameIdx]  = useState(0);
  const [radarAnimating, setRadarAnimating] = useState(false);
  const [radarHost,      setRadarHost]      = useState('');

  const buoys      = usePollWhenEnabled(`${API_BASE}/api/buoys`,       60000,  layers.surf?.enabled);
  const tides      = usePollWhenEnabled(`${API_BASE}/api/tides`,       120000, layers.tides.enabled);
  const metars     = usePollWhenEnabled(`${API_BASE}/api/metar`,       300000, layers.metar.enabled);
  // HD_RADIO_DISABLED: const hdRadarData   = usePollWhenEnabled(`${API_BASE}/api/hdradio/radar`,   300000, layers.hdRadar?.enabled);
  // HD_RADIO_DISABLED: const hdTrafficData = usePollWhenEnabled(`${API_BASE}/api/hdradio/traffic`, 120000, layers.hdTraffic?.enabled);
  // HD_RADIO_DISABLED: const hdGasData     = usePollWhenEnabled(`${API_BASE}/api/hdradio/gas`,     300000, layers.hdGas?.enabled);
  // HD_RADIO_DISABLED: const hdHealth      = usePollWhenEnabled(`${API_BASE}/api/hdradio/health`,   60000, layers.hdRadio?.enabled);

  // Aircraft — 2s poll
  useEffect(() => {
    const go = async () => {
      try {
        const data = await fetch(`${API_BASE}/api/aircraft`).then(r => r.json());
        setAircraft((data.aircraft || []).filter(a => a.lat != null && a.lon != null));
        setLastUpdate(new Date());
      } catch {}
    };
    go();
    const t = setInterval(go, 2000);
    return () => clearInterval(t);
  }, []);

  // Vessels — 10s poll with client-side dedup guard (most recent position per MMSI wins)
  useEffect(() => {
    const go = async () => {
      try {
        const data = await fetch(`${API_BASE}/api/vessels`).then(r => r.json());
        const raw = Array.isArray(data) ? data : [];
        // Belt-and-suspenders: deduplicate by entity_id, keep most recent recorded_at
        const seen = new Map();
        for (const v of raw) {
          const existing = seen.get(v.entity_id);
          if (!existing || new Date(v.recorded_at) > new Date(existing.recorded_at)) {
            seen.set(v.entity_id, v);
          }
        }
        setVessels([...seen.values()]);
      } catch {}
    };
    go();
    const t = setInterval(go, 10000);
    return () => clearInterval(t);
  }, []);

  // Vessel predictions — 60s poll (predictor runs every 10 min, no need to hammer)
  const [vesselPredictions, setVesselPredictions] = useState({});
  useEffect(() => {
    const go = async () => {
      try {
        const rows = await fetch(`${API_BASE}/api/vessel-predictions`).then(r => r.json());
        // Index by MMSI for O(1) lookup in VesselLayer
        const map = {};
        (rows || []).forEach(p => { map[p.mmsi] = p; });
        setVesselPredictions(map);
      } catch {}
    };
    go();
    const t = setInterval(go, 60000);
    return () => clearInterval(t);
  }, []);

  // Status — 30s
  useEffect(() => {
    const go = async () => {
      try { setStatus(await fetch(`${API_BASE}/api/status`).then(r => r.json())); } catch {}
    };
    go();
    const t = setInterval(go, 30000);
    return () => clearInterval(t);
  }, []);

  const toggleLayer = useCallback((key) => {
    setLayers(prev => {
      const isDisabling = prev[key].enabled;
      if (isDisabling) {
        setSelected(curr => {
          if (key === 'vessels' && curr?._type === 'vessel') return null;
          if (key === 'aircraft' && curr?._type === 'aircraft') return null;
          return curr;
        });
      }
      return { ...prev, [key]: { ...prev[key], enabled: !isDisabling } };
    });
  }, []);


  const handleSelectEntity = useCallback((e) => {
    if (e._type === 'tide') setTideStation(e);
    else setSelected(e);
  }, []);

  const bm = BASE_MAPS[baseMap];

  return (
    <div className="app-root">
      <MapContainer
        center={OAHU_CENTER} zoom={10} className="main-map"
        zoomControl={false} maxBounds={[[17.5,-163],[25,-152]]} minZoom={7} maxZoom={17}
      >
        <MapEventTracker onBoundsChange={setMapBounds} />
        {/* Base tile layer */}
        <TileLayer
          key={baseMap + '-base'}
          url={bm.url}
          attribution={bm.attribution || '&copy; OpenStreetMap &copy; CARTO'}
          maxZoom={17}
          maxNativeZoom={bm.maxNativeZoom || 19}
          subdomains={bm.subdomains || 'abcd'}
        />
        {/* Label overlay (ocean / satellite) */}
        {bm.overlay && (
          <TileLayer
            key={baseMap + '-labels'}
            url={bm.overlay}
            subdomains="abcd"
            maxZoom={17}
            opacity={0.92}
            attribution=""
          />
        )}

        {/* Depth contours — always on with Ocean base map. Esri Ocean Reference
            shows isobaths, seafloor feature names, and depth contour lines.
            No toggle: depth context is always useful for marine operations. */}
        {baseMap === 'ocean' && (
          <TileLayer
            key="ocean-depth-contours"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}"
            opacity={0.75}
            maxNativeZoom={13}
            maxZoom={17}
            attribution=""
          />
        )}

        {layers.rangeRings.enabled && <RangeRings center={[HOME_BASE.lat, HOME_BASE.lon]} rings={[1, 2.5, 5, 10, 25, 50, 100]} />}
        {layers.homeBase.enabled   && <HomeBase position={HOME_BASE} />}
        {layers.reference?.enabled && <ReferenceObjects position={HOME_BASE} />}

        {(layers.acTrails?.enabled || layers.vesselTrails?.enabled) && (
          <ErrorBoundary>
            <TrailLayer
              aircraft={layers.acTrails?.enabled && layers.aircraft?.enabled ? aircraft : []}
              vessels={layers.vesselTrails?.enabled && layers.vessels?.enabled ? vessels : []}
              apiBase={API_BASE}
            />
          </ErrorBoundary>
        )}

        {/* Marine */}
        {layers.surf?.enabled && <ErrorBoundary><BuoyLayer buoys={buoys} selected={selected} onSelect={handleSelectEntity} /></ErrorBoundary>}
        {layers.surf?.enabled && <ErrorBoundary><SurfLayer selected={selected} onSelect={handleSelectEntity} /></ErrorBoundary>}
        {layers.tides.enabled && <ErrorBoundary><TideLayer tides={tides} selected={tideStation} onSelect={handleSelectEntity} /></ErrorBoundary>}

        {/* Aviation */}
        {layers.metar.enabled && <ErrorBoundary><MetarLayer metars={metars} selected={selected} onSelect={handleSelectEntity} /></ErrorBoundary>}
        {layers.vessels.enabled && (
          <ErrorBoundary><VesselLayer vessels={vessels} selected={selected} showLabels={showLabels} onSelect={handleSelectEntity} predictions={vesselPredictions} /></ErrorBoundary>
        )}
        {layers.aircraft.enabled && (
          <ErrorBoundary><AircraftLayer aircraft={aircraft} selected={selected} showLabels={showLabels} onSelect={handleSelectEntity} /></ErrorBoundary>
        )}

        {/* Radar overlay */}
        {layers.radar.enabled && (
          <ErrorBoundary>
            <RadarLayer
              visible={layers.radar.enabled}
              radarFrames={radarFrames}    setRadarFrames={setRadarFrames}
              radarFrameIdx={radarFrameIdx} setRadarFrameIdx={setRadarFrameIdx}
              radarAnimating={radarAnimating}
              radarHost={radarHost}        setRadarHost={setRadarHost}
            />
          </ErrorBoundary>
        )}

        {/* Ecowitt PWS marker — click opens floating panel, no Popup */}
        {layers.localWx.enabled && (
          <ErrorBoundary>
            <EcowittLayer
              visible={layers.localWx.enabled}
              apiBase={API_BASE}
              onOpen={() => {
                // Fetch fresh data then show panel
                fetch(`${API_BASE}/api/ecowitt/current`)
                  .then(r => r.json())
                  .then(j => { setPwsData(j.data); setPwsStale(j.stale || !j.data); })
                  .catch(() => setPwsStale(true));
                setShowPws(true);
              }}
            />
          </ErrorBoundary>
        )}
      </MapContainer>

      {/* ── Floating panels ── */}
      <SunMoonPanel    visible={layers.sunMoon?.enabled} />


      {/* ATIS bottom bar */}
      <ATISBar metars={metars} visible={layers.metar.enabled} />

      {/* Forecast + fishing panel */}
      <ForecastPanel 
        visible={layers.forecast.enabled || layers.fishing.enabled} 
        onClose={() => setLayers(prev => ({
          ...prev, 
          forecast: { ...prev.forecast, enabled: false },
          fishing: { ...prev.fishing, enabled: false }
        }))} 
      />

      {/* Tide chart modal */}
      <TideChartModal station={tideStation} onClose={() => setTideStation(null)} apiBase={API_BASE} />

      {/* PWS floating panel — rendered outside MapContainer, no dark overlay */}
      {showPws && (
        <EcowittFloatingPanel
          data={pwsData}
          stale={pwsStale}
          onClose={() => setShowPws(false)}
        />
      )}

      {/* Detail panel */}
      <DetailPanel entity={selected} onClose={() => setSelected(null)} apiBase={API_BASE} />

      {/* Layer control */}
      <LayerControl
        layers={layers}               onToggleLayer={toggleLayer}
        showLabels={showLabels}       onToggleLabels={() => setShowLabels(p => !p)}
        showLegend={showLegend}       onToggleLegend={() => setShowLegend(p => !p)}
        baseMap={baseMap}             onSetBaseMap={setBaseMap}
        baseMaps={BASE_MAPS}
      />



      <Legend 
        aircraft={layers.aircraft.enabled ? aircraft : []} 
        vessels={layers.vessels.enabled ? vessels : []} 
        bounds={mapBounds} 
        visible={showLegend} 
        layers={layers}
      />

      <StatusBar aircraft={aircraft} vessels={vessels} lastUpdate={lastUpdate} status={status} />
    </div>
  );
}

export default App;
