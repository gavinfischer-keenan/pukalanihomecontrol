import { useState } from 'react';
import './LayerControl.css';

const SECTIONS = [
  {
    id: 'aviation',
    label: 'Aviation',
    icon: '✈️',
    keys: ['aircraft', 'acTrails', 'airportStatus', 'metar', 'windsAloft', 'approaches'],
  },
  {
    id: 'marine',
    label: 'Integrated Vessel',
    icon: '⚓',
    keys: ['vessels', 'vesselTrails', 'surf', 'tides', 'harbor'],
  },
  {
    id: 'map',
    label: 'Map',
    icon: '🗺️',
    keys: ['homeBase', 'rangeRings', 'radar'],
  },
  // NWS/NOAA is its own standalone app at /nws/ — not a layer in this map
  // HD Radio section — DISABLED for Hawaii. Re-enable for Berkeley CA.
  // { id: 'hdradio', label: 'HD Radio', icon: '📻',
  //   keys: ['hdRadar', 'hdTraffic', 'hdGas', 'hdRadio'] },
];

// Extra airports available to configure — KHNL is always on
const EXTRA_AIRPORTS = [
  { code: 'KSFO', name: 'San Francisco' },
  { code: 'KOAK', name: 'Oakland' },
  { code: 'KPDX', name: 'Portland' },
  { code: 'KLAX', name: 'Los Angeles' },
  { code: 'KSEA', name: 'Seattle' },
  { code: 'KLAS', name: 'Las Vegas' },
  { code: 'KPHX', name: 'Phoenix' },
  { code: 'KLGB', name: 'Long Beach' },
];

function LayerBtn({ layerKey, layer, onToggle }) {
  const isLive = layer.live;
  return (
    <button
      className={`layer-btn ${layer.enabled ? 'layer-btn-active' : ''} ${!isLive ? 'layer-btn-stub' : ''}`}
      onClick={() => isLive && onToggle(layerKey)}
      title={isLive ? (layer.enabled ? 'Click to hide' : 'Click to show') : 'Coming soon'}
    >
      <span className="layer-btn-label">{layer.label}</span>
      {layer.enabled && isLive && <span className="layer-btn-dot live" />}
      {!isLive && <span className="layer-btn-soon">soon</span>}
    </button>
  );
}

function Section({ section, layers, onToggleLayer, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const sectionLayers = section.keys.filter(k => layers[k]);
  const activeCount   = sectionLayers.filter(k => layers[k]?.enabled).length;

  return (
    <div className={`layer-section ${open ? 'layer-section-open' : ''}`}>
      <button className="layer-section-header" onClick={() => setOpen(o => !o)}>
        <span className="layer-section-icon">{section.icon}</span>
        <span className="layer-section-label">{section.label}</span>
        {activeCount > 0 && <span className="layer-section-badge">{activeCount}</span>}
        <span className="layer-section-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="layer-section-items">
          {sectionLayers.map(key => (
            <LayerBtn key={key} layerKey={key} layer={layers[key]} onToggle={onToggleLayer} />
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsSection({ airportSettings, onToggleAirport, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const activeCount = Object.values(airportSettings || {}).filter(Boolean).length;

  return (
    <div className={`layer-section ${open ? 'layer-section-open' : ''}`}>
      <button className="layer-section-header" onClick={() => setOpen(o => !o)}>
        <span className="layer-section-icon">⚙️</span>
        <span className="layer-section-label">Settings</span>
        {activeCount > 0 && <span className="layer-section-badge">{activeCount}</span>}
        <span className="layer-section-chevron">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="layer-section-items">
          <div className="settings-group-label">AIRPORT STATUS — ADDITIONAL</div>

          {/* KHNL — always on, not editable */}
          <div className="settings-airport-row settings-apt-locked">
            <span className="settings-check locked">✓</span>
            <span className="settings-apt-code">HNL</span>
            <span className="settings-apt-name">Honolulu — always on</span>
          </div>

          {EXTRA_AIRPORTS.map(({ code, name }) => {
            const shortCode = code.replace(/^K/, '');
            const checked = airportSettings?.[code] ?? false;
            return (
              <label key={code} className="settings-airport-row settings-apt-toggle">
                <input
                  type="checkbox"
                  className="settings-checkbox"
                  checked={checked}
                  onChange={() => onToggleAirport(code)}
                />
                <span className="settings-apt-code">{shortCode}</span>
                <span className="settings-apt-name">{name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LayerControl({
  layers, onToggleLayer,
  showLabels, onToggleLabels,
  showLegend, onToggleLegend,
  baseMap, onSetBaseMap, baseMaps,
  airportSettings, onToggleAirport,
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`layer-panel glass ${collapsed ? 'layer-panel-collapsed' : ''}`}>
      <div className="layer-panel-titlebar" style={collapsed ? { justifyContent: 'center', padding: '10px 0 8px' } : {}}>
        {!collapsed && <span className="layer-panel-title">LAYERS</span>}
        <button className="layer-collapse-btn" onClick={() => setCollapsed(c => !c)}>
          {collapsed ? '◀' : '▶'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Map Controls */}
          <div className="layer-controls-group">
            <div className="layer-group-label">MAP CONTROLS</div>
            <button
              className={`layer-btn ${showLabels ? 'layer-btn-active' : ''}`}
              onClick={onToggleLabels}
              title={showLabels ? 'Hide labels' : 'Show labels'}
            >
              🏷️ Labels {showLabels ? '●' : '○'}
            </button>
            <button
              className={`layer-btn ${showLegend ? 'layer-btn-active' : ''}`}
              onClick={onToggleLegend}
              title={showLegend ? 'Hide legend' : 'Show legend'}
            >
              📖 Legend {showLegend ? '●' : '○'}
            </button>
          </div>

          {/* Base Map */}
          <div className="layer-controls-group">
            <div className="layer-group-label">BASE MAP</div>
            <div className="basemap-buttons">
              {Object.entries(baseMaps).map(([key, val]) => (
                <button
                  key={key}
                  className={`basemap-btn ${baseMap === key ? 'basemap-btn-active' : ''}`}
                  onClick={() => onSetBaseMap(key)}
                  title={val.label}
                >
                  {val.label}
                </button>
              ))}
            </div>
          </div>

          <div className="layer-divider" />

          {/* Layer sections */}
          <div className="layer-sections">
            {SECTIONS.map((section, i) => (
              <Section
                key={section.id}
                section={section}
                layers={layers}
                onToggleLayer={onToggleLayer}
                defaultOpen={i < 2}
              />
            ))}

            {/* Settings section at bottom */}
            <SettingsSection
              airportSettings={airportSettings}
              onToggleAirport={onToggleAirport}
              defaultOpen={false}
            />
          </div>
        </>
      )}
    </div>
  );
}
