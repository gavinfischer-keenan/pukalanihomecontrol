import React, { useState, useEffect } from 'react';

const CLASSIFICATION = {
  TD: { label: 'Tropical Depression', color: '#5b9bd5', icon: '🌀' },
  TS: { label: 'Tropical Storm',     color: '#ffc000', icon: '🌀' },
  HU: { label: 'Hurricane',          color: '#ff4444', icon: '🌪️' },
  MH: { label: 'Major Hurricane',    color: '#cc00cc', icon: '🌪️' },
  TY: { label: 'Typhoon',            color: '#ff4444', icon: '🌪️' },
  STY:{ label: 'Super Typhoon',      color: '#cc00cc', icon: '🌪️' },
  PTC:{ label: 'Post-Tropical',      color: '#888',    icon: '🌧️' },
};

const THREAT_COLORS = {
  none:    '#4a5568',
  watch:   '#ffc000',
  warning: '#ff4444',
};

function compassDir(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function timeAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

export default function NWSStormsPanel({ apiBase }) {
  const [storms, setStorms] = useState([]);
  const [meta, setMeta]     = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    const base = apiBase || `http://${window.location.hostname}:3001`;
    fetch(`${base}/api/hurricanes`)
      .then(r => r.json())
      .then(d => {
        setStorms(d.storms || []);
        setMeta({ fetchedAt: d.fetchedAt, home: d.home, error: d.error });
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [apiBase]);

  if (loading) return <div className="storms-loading">Loading storm data...</div>;
  if (error) return <div className="storms-error">⚠️ {error}</div>;

  return (
    <div className="storms-panel">
      <div className="storms-header">
        <h2>🌀 Active Pacific Storms</h2>
        <span className="storms-meta">
          {storms.length === 0 ? 'No active storms' : `${storms.length} active`}
          {meta.fetchedAt && ` · Updated ${timeAgo(meta.fetchedAt)}`}
        </span>
      </div>

      {storms.length === 0 && (
        <div className="storms-empty">
          <div className="storms-empty-icon">☀️</div>
          <p>No active tropical cyclones in the Pacific basin</p>
          <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener noreferrer"
             className="storms-link">NHC Pacific Overview →</a>
        </div>
      )}

      <div className="storms-grid">
        {storms.map(s => {
          const cls = CLASSIFICATION[s.classification] || CLASSIFICATION.TS;
          const threat = THREAT_COLORS[s.threatLevel] || THREAT_COLORS.none;
          const windKt = s.intensity;
          const cat = s.classification === 'HU'
            ? (windKt >= 137 ? 'Cat 5' : windKt >= 113 ? 'Cat 4' : windKt >= 96 ? 'Cat 3' : windKt >= 83 ? 'Cat 2' : 'Cat 1')
            : null;

          return (
            <div key={s.id} className="storm-card" style={{ borderLeftColor: cls.color }}>
              {/* Cone image as mini-map */}
              <div className="storm-cone">
                <img src={s.conePng} alt={`${s.name} forecast cone`}
                     onError={e => { e.target.style.display='none'; }} />
              </div>

              <div className="storm-info">
                <div className="storm-name-row">
                  <span className="storm-icon" style={{ color: cls.color }}>{cls.icon}</span>
                  <h3 className="storm-name">{s.name}</h3>
                  <span className="storm-class" style={{ background: cls.color }}>
                    {cat || cls.label}
                  </span>
                </div>

                <div className="storm-stats">
                  <div className="storm-stat">
                    <span className="storm-stat-label">Winds</span>
                    <span className="storm-stat-value">{windKt} kt</span>
                  </div>
                  <div className="storm-stat">
                    <span className="storm-stat-label">Pressure</span>
                    <span className="storm-stat-value">{s.pressure} mb</span>
                  </div>
                  <div className="storm-stat">
                    <span className="storm-stat-label">Movement</span>
                    <span className="storm-stat-value">{compassDir(s.movementDir)} {s.movementSpeed} mph</span>
                  </div>
                  <div className="storm-stat">
                    <span className="storm-stat-label">Position</span>
                    <span className="storm-stat-value">{s.lat.toFixed(1)}°N {Math.abs(s.lon).toFixed(1)}°W</span>
                  </div>
                </div>

                <div className="storm-distance" style={{ borderColor: threat }}>
                  <span className="storm-dist-value">{s.distanceMi.toLocaleString()} mi</span>
                  <span className="storm-dist-dir">{compassDir(s.bearingDeg)} of {meta.home?.name || 'home'}</span>
                  {s.threatLevel !== 'none' && (
                    <span className="storm-threat" style={{ background: threat }}>
                      {s.threatLevel.toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="storm-links">
                  <a href={s.advisoryUrl} target="_blank" rel="noopener noreferrer">Advisory</a>
                  <a href={s.graphicsUrl} target="_blank" rel="noopener noreferrer">Graphics</a>
                  <a href={`https://www.nhc.noaa.gov/refresh/graphics_ep${s.id.slice(-5,-4)}+shtml/`}
                     target="_blank" rel="noopener noreferrer">NHC Page</a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="storms-footer">
        <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener noreferrer">
          National Hurricane Center
        </a>
        <span>·</span>
        <a href="https://www.prh.noaa.gov/cphc/" target="_blank" rel="noopener noreferrer">
          Central Pacific Hurricane Center
        </a>
      </div>
    </div>
  );
}
