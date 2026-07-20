import { useState } from 'react';
import NWSMap from './NWSMap';
import './NWSPanel.css';

/**
 * NWSPanel — NWS / NOAA information panel for Hawaii Command Center.
 *
 * Tabs:
 *   alerts   — Active NWS alerts & advisories
 *   obs      — Statewide surface observations
 *   maps     — Full Leaflet map (Phase 2: NWSMap)
 *   satellite — NPAC satellite imagery links
 *   outlook  — Long-range outlook
 */
export default function NWSPanel({ apiBase, visible, onClose }) {
  const [tab, setTab] = useState('maps');

  if (!visible) return null;

  return (
    <div className="nws-panel glass">
      {/* Header */}
      <div className="nws-panel-header">
        <span className="nws-panel-title">🌊 NWS / NOAA</span>
        <div className="nws-panel-tabs">
          {[
            { key: 'maps',      label: '🗺 Maps' },
            { key: 'alerts',    label: '⚠️ Alerts' },
            { key: 'obs',       label: '🌡 Obs' },
            { key: 'satellite', label: '🛰 Satellite' },
            { key: 'outlook',   label: '📅 Outlook' },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`nws-tab-btn ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="nws-close-btn" onClick={onClose} title="Close">✕</button>
      </div>

      {/* Body */}
      <div className="nws-panel-body">
        {tab === 'maps' && <NWSMap apiBase={apiBase} />}

        {tab === 'alerts' && (
          <div className="nws-placeholder">
            <span>⚠️ Alerts tab — Phase 3</span>
            <a
              href="https://www.weather.gov/hfo/"
              target="_blank"
              rel="noreferrer"
              className="nws-ext-link"
            >
              weather.gov/hfo →
            </a>
          </div>
        )}

        {tab === 'obs' && (
          <div className="nws-placeholder">
            <span>🌡 Statewide Obs — Phase 3</span>
          </div>
        )}

        {tab === 'satellite' && (
          <div className="nws-placeholder">
            <span>🛰 NPAC Satellite — Phase 3</span>
            <a
              href="https://www.ssd.noaa.gov/goes/west/npac/index.html"
              target="_blank"
              rel="noreferrer"
              className="nws-ext-link"
            >
              NOAA SSD NPAC →
            </a>
          </div>
        )}

        {tab === 'outlook' && (
          <div className="nws-placeholder">
            <span>📅 Long Range Outlook — Phase 3</span>
            <a
              href="https://www.cpc.ncep.noaa.gov/products/predictions/long_range/"
              target="_blank"
              rel="noreferrer"
              className="nws-ext-link"
            >
              CPC Long Range →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
