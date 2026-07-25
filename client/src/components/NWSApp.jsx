import { useState } from 'react';
import NWSLoopsGrid      from './NWSLoopsGrid';
import NWSForecastPanel  from './NWSForecastPanel';
import NWSMap            from './NWSMap';
import './NWSApp.css';

const API_BASE = `http://${window.location.hostname}:3001`;

// Top-level tabs
const TABS = [
  { key: 'loops',     label: '🛰️ Loops',    desc: 'Satellite & radar loop imagery' },
  { key: 'air',       label: '🌬️ Air',      desc: 'Winds, temps, radar, alerts'    },
  { key: 'water',     label: '🌊 Water',    desc: 'SST, waves, FADs, tides'        },
  { key: 'storms',    label: '🌀 Storms',   desc: 'Tropical storm & hurricane tracker' },
  { key: 'forecasts', label: '📅 Forecasts', desc: 'NWS text products & outlooks'  },
];

export default function NWSApp() {
  const [tab, setTab] = useState(null); // null = home/menu

  return (
    <div className="nwsapp-root">
      {/* ── Top nav bar ─────────────────────────────────── */}
      <nav className="nwsapp-nav">
        <button
          className="nwsapp-home-btn"
          onClick={() => setTab(null)}
          title="NWS/NOAA Home"
        >
          🌺 <span>NWS / NOAA</span>
        </button>

        <div className="nwsapp-nav-tabs">
          {TABS.map(t => (
            <button
              key={t.key}
              className={`nwsapp-nav-tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* ← Maps button removed per user request */}
      </nav>

      {/* ── Content area ───────────────────────────────── */}
      <main className="nwsapp-body">

        {/* HOME — big menu tiles */}
        {tab === null && (
          <div className="nwsapp-home">
            <div className="nwsapp-home-title">Hawaii NWS / NOAA</div>
            <div className="nwsapp-home-sub">Select a section below</div>
            <div className="nwsapp-home-grid">
              {TABS.map(t => (
                <button
                  key={t.key}
                  className="nwsapp-home-tile"
                  onClick={() => setTab(t.key)}
                >
                  <span className="nwsapp-tile-icon">{t.label.split(' ')[0]}</span>
                  <span className="nwsapp-tile-name">{t.label.split(' ').slice(1).join(' ')}</span>
                  <span className="nwsapp-tile-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* LOOPS */}
        {tab === 'loops' && (
          <div className="nwsapp-content nwsapp-content-loops">
            <NWSLoopsGrid apiBase={API_BASE} />
          </div>
        )}

        {/* AIR MAP */}
        {tab === 'air' && (
          <div className="nwsapp-content nwsapp-content-map">
            <NWSMap apiBase={API_BASE} subtab="air" />
          </div>
        )}

        {/* WATER MAP */}
        {tab === 'water' && (
          <div className="nwsapp-content nwsapp-content-map">
            <NWSMap apiBase={API_BASE} subtab="water" />
          </div>
        )}

        {/* STORMS */}
        {tab === 'storms' && (
          <div className="nwsapp-content">
            {/* HurricanePanel removed - not applicable to Hawaii */}
          </div>
        )}

        {/* FORECASTS */}
        {tab === 'forecasts' && (
          <div className="nwsapp-content nwsapp-content-forecasts">
            <NWSForecastPanel apiBase={API_BASE} />
          </div>
        )}
      </main>
    </div>
  );
}
