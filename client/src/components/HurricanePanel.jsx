import { useState, useEffect, useCallback } from 'react';
import './HurricanePanel.css';

const POLL_MS = 5 * 60 * 1000;

const CATEGORY_LABELS = {
  'TD': { label: 'Tropical Depression', color: '#6b93d6', emoji: '🌀' },
  'TS': { label: 'Tropical Storm',      color: '#f5d300', emoji: '🌀' },
  'HU': { label: 'Hurricane',           color: '#ff6600', emoji: '🌀' },
  'STD': { label: 'Subtropical Depression', color: '#aaa', emoji: '〰️' },
  'STS': { label: 'Subtropical Storm',      color: '#aaa', emoji: '〰️' },
};

const THREAT_CONFIG = {
  none:     { label: 'No Threat',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   emoji: '🟢' },
  watch:    { label: 'Watch Zone',  color: '#eab308', bg: 'rgba(234,179,8,0.12)',   emoji: '🟡' },
  warning:  { label: 'Warning',     color: '#f97316', bg: 'rgba(249,115,22,0.12)',  emoji: '🟠' },
  imminent: { label: 'Imminent',    color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   emoji: '🔴' },
  unknown:  { label: 'Unknown',     color: '#6b7280', bg: 'rgba(107,114,128,0.1)',  emoji: '⬜' },
};

function windCategory(kt) {
  if (kt >= 137) return 'Cat 5';
  if (kt >= 113) return 'Cat 4';
  if (kt >= 96)  return 'Cat 3';
  if (kt >= 83)  return 'Cat 2';
  if (kt >= 64)  return 'Cat 1';
  if (kt >= 34)  return 'TS';
  return 'TD';
}

function bearingLabel(deg) {
  if (deg == null) return '?';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function timeSince(isoStr) {
  if (!isoStr) return null;
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return '< 1 min ago';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export default function HurricanePanel({ apiBase }) {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [selected, setSelected] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const d = await fetch(`${apiBase}/api/hurricanes`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      setData(d);
      if (!selected && d.storms?.length > 0) setSelected(d.storms[0].id);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase, selected]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, POLL_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  if (loading) return <div className="hp-status">Loading storm data…</div>;
  if (error && !data) return <div className="hp-status hp-error">⚠ {error}</div>;

  const storms = data?.storms || [];
  const activeStorm = storms.find(s => s.id === selected) || storms[0];

  return (
    <div className="hp-root">
      {/* ── Left sidebar: storm list ── */}
      <div className="hp-sidebar">
        <div className="hp-sidebar-title">
          🌀 Active Tropical Systems
          {data?.fetchedAt && <span className="hp-sidebar-age">Updated {timeSince(data.fetchedAt)}</span>}
        </div>

        {storms.length === 0 ? (
          <div className="hp-no-storms">
            <div className="hp-no-storms-icon">🌤️</div>
            <div>No active tropical systems</div>
            <div className="hp-no-storms-sub">All Pacific basins clear</div>
            <div className="hp-no-storms-time">
              {data?.fetchedAt ? `Checked ${timeSince(data.fetchedAt)}` : 'Awaiting data…'}
            </div>
          </div>
        ) : (
          <div className="hp-storm-list">
            {storms.map(s => {
              const threat = THREAT_CONFIG[s.threatLevel] || THREAT_CONFIG.unknown;
              const cat    = CATEGORY_LABELS[s.classification] || CATEGORY_LABELS.TS;
              return (
                <button
                  key={s.id}
                  className={`hp-storm-item${selected === s.id ? ' active' : ''}`}
                  style={{ '--threat-color': threat.color }}
                  onClick={() => setSelected(s.id)}
                >
                  <div className="hp-storm-item-top">
                    <span className="hp-storm-name">{s.name}</span>
                    <span className="hp-storm-cat" style={{ color: cat.color }}>{windCategory(s.intensity)}</span>
                    <span className="hp-threat-badge" style={{ color: threat.color, background: threat.bg }}>
                      {threat.emoji} {threat.label}
                    </span>
                  </div>
                  <div className="hp-storm-meta">
                    <span>💨 {s.intensity} kt</span>
                    <span>📍 {s.distanceMi ? `${s.distanceMi.toLocaleString()} mi ${bearingLabel(s.bearingDeg)}` : 'unknown dist'}</span>
                    <span>➡ {s.movementSpeed} kt {bearingLabel(s.movementDir)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {data?.isStale && (
          <div className="hp-stale-note">⚠ Data may be delayed — NHC server unreachable</div>
        )}
      </div>

      {/* ── Right: selected storm detail ── */}
      <div className="hp-detail">
        {!activeStorm ? (
          <div className="hp-no-storms" style={{margin: 'auto'}}>
            <div className="hp-no-storms-icon" style={{fontSize: 64}}>🌤️</div>
            <div style={{fontSize: 20, fontWeight: 600}}>All Basins Clear</div>
            <div className="hp-no-storms-sub" style={{marginTop: 8}}>
              No active tropical depressions, tropical storms, or hurricanes<br/>in the Atlantic, Eastern Pacific, or Central Pacific.
            </div>
            {data?.fetchedAt && (
              <div className="hp-no-storms-time" style={{marginTop: 16}}>Last checked: {timeSince(data.fetchedAt)}</div>
            )}
          </div>
        ) : (() => {
          const threat = THREAT_CONFIG[activeStorm.threatLevel] || THREAT_CONFIG.unknown;
          const cat    = CATEGORY_LABELS[activeStorm.classification] || CATEGORY_LABELS.TS;
          return (
            <>
              <div className="hp-detail-header" style={{ borderColor: threat.color }}>
                <div className="hp-detail-name">
                  <span className="hp-detail-emoji">{cat.emoji}</span>
                  {activeStorm.name}
                </div>
                <div className="hp-detail-subtitle">
                  {cat.label} · {windCategory(activeStorm.intensity)}
                  <span className="hp-threat-badge" style={{ color: threat.color, background: threat.bg }}>
                    {threat.emoji} {threat.label}
                  </span>
                </div>
              </div>

              {/* Stats grid */}
              <div className="hp-stats">
                <div className="hp-stat">
                  <div className="hp-stat-label">Distance from Pukalani</div>
                  <div className="hp-stat-value">{activeStorm.distanceMi ? `${activeStorm.distanceMi.toLocaleString()} mi` : '—'}</div>
                </div>
                <div className="hp-stat">
                  <div className="hp-stat-label">Bearing from Pukalani</div>
                  <div className="hp-stat-value">{activeStorm.bearingDeg != null ? `${bearingLabel(activeStorm.bearingDeg)} (${activeStorm.bearingDeg}°)` : '—'}</div>
                </div>
                <div className="hp-stat">
                  <div className="hp-stat-label">Max Sustained Winds</div>
                  <div className="hp-stat-value">{activeStorm.intensity} kt ({Math.round(activeStorm.intensity * 1.15)} mph)</div>
                </div>
                <div className="hp-stat">
                  <div className="hp-stat-label">Central Pressure</div>
                  <div className="hp-stat-value">{activeStorm.pressure ? `${activeStorm.pressure} mb` : '—'}</div>
                </div>
                <div className="hp-stat">
                  <div className="hp-stat-label">Movement</div>
                  <div className="hp-stat-value">{bearingLabel(activeStorm.movementDir)} at {activeStorm.movementSpeed} kt</div>
                </div>
                <div className="hp-stat">
                  <div className="hp-stat-label">Position</div>
                  <div className="hp-stat-value">
                    {activeStorm.lat ? `${activeStorm.lat}°N ${Math.abs(activeStorm.lon)}°W` : '—'}
                  </div>
                </div>
                <div className="hp-stat">
                  <div className="hp-stat-label">Last Advisory</div>
                  <div className="hp-stat-value">{timeSince(activeStorm.lastUpdate) || '—'}</div>
                </div>
                <div className="hp-stat">
                  <div className="hp-stat-label">Storm ID</div>
                  <div className="hp-stat-value" style={{fontSize:11, color:'rgba(255,255,255,0.4)'}}>{activeStorm.id.toUpperCase()}</div>
                </div>
              </div>

              {/* 5-day cone graphic */}
              <div className="hp-cone-section">
                <div className="hp-cone-title">NHC 5-Day Forecast Cone</div>
                <div className="hp-cone-wrap">
                  <img
                    src={activeStorm.conePng}
                    alt={`${activeStorm.name} 5-day forecast cone`}
                    className="hp-cone-img"
                    onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='block'; }}
                  />
                  <div className="hp-cone-fallback" style={{display:'none'}}>
                    📡 Cone graphic not yet available · <a href={activeStorm.graphicsUrl} target="_blank" rel="noreferrer">View on NHC ↗</a>
                  </div>
                </div>
                <div className="hp-cone-links">
                  {activeStorm.advisoryUrl && (
                    <a href={activeStorm.advisoryUrl} target="_blank" rel="noreferrer" className="hp-advisory-link">
                      📋 Read Advisory
                    </a>
                  )}
                  {activeStorm.graphicsUrl && (
                    <a href={activeStorm.graphicsUrl} target="_blank" rel="noreferrer" className="hp-advisory-link">
                      🗺 NHC Graphics
                    </a>
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
