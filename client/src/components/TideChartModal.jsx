import { useState, useEffect, useRef } from 'react';
import './TideChartModal.css';

const NOAA_BASE = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) {
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

async function fetchPredictions(stationId, days = 2) {
  const begin = new Date();
  const end = new Date(begin.getTime() + days * 86400000);
  const url = `${NOAA_BASE}?product=predictions&datum=MLLW&time_zone=lst_ldt&interval=h&units=english&format=json` +
    `&begin_date=${ymd(begin)}&end_date=${ymd(end)}&station=${stationId}`;
  const r = await fetch(url);
  const data = await r.json();
  return (data.predictions || []).map(p => ({
    t: new Date(p.t),
    v: parseFloat(p.v),
  }));
}

// ── SVG Line Chart ──────────────────────────────────────────
function TideChart({ points }) {
  if (!points || points.length < 2) {
    return <div className="tide-chart-loading">Loading tide data…</div>;
  }

  const W = 560, H = 180;
  const PAD = { top: 14, right: 14, bottom: 28, left: 38 };
  const cW = W - PAD.left - PAD.right;
  const cH = H - PAD.top  - PAD.bottom;

  const vals = points.map(p => p.v);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = maxV - minV || 1;

  const xs = points.map((_, i) => PAD.left + (i / (points.length - 1)) * cW);
  const ys = points.map(p => PAD.top + cH - ((p.v - minV) / range) * cH);

  // Bezier path
  function pathD(xs, ys) {
    if (!xs.length) return '';
    let d = `M ${xs[0]},${ys[0]}`;
    for (let i = 1; i < xs.length; i++) {
      const cpx = (xs[i-1] + xs[i]) / 2;
      d += ` C ${cpx},${ys[i-1]} ${cpx},${ys[i]} ${xs[i]},${ys[i]}`;
    }
    return d;
  }

  const linePath  = pathD(xs, ys);
  const areaPath  = `${linePath} L ${xs[xs.length-1]},${PAD.top+cH} L ${xs[0]},${PAD.top+cH} Z`;

  // Current time position
  const now = new Date();
  const firstT = points[0].t.getTime();
  const lastT  = points[points.length-1].t.getTime();
  const nowFrac = (now.getTime() - firstT) / (lastT - firstT);
  const nowX = nowFrac >= 0 && nowFrac <= 1 ? PAD.left + nowFrac * cW : null;

  // Y axis labels (every 0.5ft)
  const yStep = 0.5;
  const yLabels = [];
  const start = Math.ceil(minV / yStep) * yStep;
  for (let v = start; v <= maxV + 0.01; v += yStep) {
    const yy = PAD.top + cH - ((v - minV) / range) * cH;
    yLabels.push({ v, y: yy });
  }

  // X axis labels — every 6 hours
  const xLabels = points
    .map((p, i) => ({ t: p.t, x: xs[i], i }))
    .filter(({ t }) => t.getHours() % 6 === 0 && t.getMinutes() === 0);

  // Local hi/lo peaks
  const peaks = points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return false;
    return (p.v > points[i-1].v && p.v > points[i+1].v) ||
           (p.v < points[i-1].v && p.v < points[i+1].v);
  }).map((p, _, arr) => {
    const i = points.indexOf(p);
    const isHigh = p.v > points[i-1].v;
    return { ...p, x: xs[i], y: ys[i], isHigh };
  }).filter(p => p.x != null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tideGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#29b6f6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#29b6f6" stopOpacity="0.03" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yLabels.map(({ v, y }) => (
        <line key={v} x1={PAD.left} y1={y} x2={W-PAD.right} y2={y}
          stroke="rgba(255,255,255,0.06)" strokeWidth="1" strokeDasharray="3,4" />
      ))}

      {/* Area fill */}
      <path d={areaPath} fill="url(#tideGrad)" />

      {/* Main line */}
      <path d={linePath} fill="none" stroke="#29b6f6" strokeWidth="2.5" strokeLinejoin="round" />

      {/* Current time indicator */}
      {nowX && (
        <>
          <line x1={nowX} y1={PAD.top} x2={nowX} y2={PAD.top+cH}
            stroke="#ffd54f" strokeWidth="1.5" strokeDasharray="4,3" />
          <text x={nowX+4} y={PAD.top+10} fontSize="8" fill="#ffd54f" fontFamily="sans-serif">NOW</text>
        </>
      )}

      {/* Hi/Lo labels */}
      {peaks.slice(0, 12).map((p, i) => {
        const label = p.isHigh ? '▲' : '▼';
        const col   = p.isHigh ? '#64b5f6' : '#ff7043';
        const dy    = p.isHigh ? -10 : 14;
        const hh = p.t.getHours() % 12 || 12;
        const mm = pad(p.t.getMinutes());
        const ap = p.t.getHours() >= 12 ? 'p' : 'a';
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3} fill={col} />
            <text x={p.x} y={p.y + dy - 2} textAnchor="middle" fontSize="7.5" fill={col} fontFamily="monospace">
              {`${p.v.toFixed(2)}ft`}
            </text>
            <text x={p.x} y={p.y + dy + 6} textAnchor="middle" fontSize="7" fill={col} opacity="0.7" fontFamily="monospace">
              {`${hh}:${mm}${ap}`}
            </text>
          </g>
        );
      })}

      {/* Y axis */}
      <line x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top+cH} stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {yLabels.map(({ v, y }) => (
        <text key={v} x={PAD.left-4} y={y+3} textAnchor="end" fontSize="8" fill="#78909c" fontFamily="monospace">
          {v.toFixed(1)}
        </text>
      ))}

      {/* X axis */}
      <line x1={PAD.left} y1={PAD.top+cH} x2={W-PAD.right} y2={PAD.top+cH} stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
      {xLabels.map(({ t, x }) => {
        const dow  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][t.getDay()];
        const hr   = t.getHours();
        const label = hr === 0 ? dow : (hr === 12 ? 'noon' : `${hr % 12}${hr < 12 ? 'a' : 'p'}`);
        const col   = hr === 0 ? '#90caf9' : '#546e7a';
        return (
          <text key={x} x={x} y={PAD.top+cH+14} textAnchor="middle" fontSize="8" fill={col} fontFamily="sans-serif">
            {label}
          </text>
        );
      })}
    </svg>
  );
}

// ── Modal component ─────────────────────────────────────────
export default function TideChartModal({ station, onClose }) {
  const [points, setPoints] = useState(null);
  const [error,  setError]  = useState(null);

  useEffect(() => {
    if (!station) return;
    setPoints(null);
    setError(null);
    fetchPredictions(station.station_id)
      .then(setPoints)
      .catch(e => setError(e.message));
  }, [station]);

  if (!station) return null;

  return (
    <div className="tide-modal-overlay" onClick={onClose}>
      <div className="tide-modal glass" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="tide-modal-header">
          <div className="tide-modal-title">
            〰️ {station.name || station.station_id}
          </div>
          <div className="tide-modal-sub">
            CO-OPS {station.station_id} · MLLW datum · 48-hr prediction
          </div>
          <button className="tide-modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Current level badge */}
        <div className="tide-modal-current">
          {station.current_ft != null && (
            <>
              <span className="tide-modal-level">{Number(station.current_ft).toFixed(2)}ft</span>
              <span className="tide-modal-label">current level</span>
            </>
          )}
        </div>

        {/* Chart */}
        <div className="tide-chart-wrap">
          {error  && <div className="tide-chart-err">Failed to load: {error}</div>}
          {!error && <TideChart points={points} />}
        </div>

        {/* Legend */}
        <div className="tide-modal-legend">
          <span className="legend-high">▲ High tide</span>
          <span className="legend-now">— Now</span>
          <span className="legend-low">▼ Low tide</span>
        </div>
      </div>
    </div>
  );
}
