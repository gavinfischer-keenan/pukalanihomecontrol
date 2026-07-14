import { useState, useEffect } from 'react';
import useDraggable from './useDraggable';
import './WindsAloftPanel.css';

// ── FAA Winds Aloft text parser ────────────────────────────
// Raw format:  HNL 9900 2220+15 2315+10 2310+05 2420-03 2430-14 ...
// DDSS = direction tens × wind speed; +TT or -TT = temperature
// If DD > 36: subtract 50 from DD, add 100 to SS (high-speed encoding)

const ALTS = [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000];

function parseWindCode(code, alt) {
  if (!code || code === '9900' || code === 'CALM') {
    return { dir: null, spd: 0, tmp: null, calm: true };
  }
  if (code.length < 4) return null;

  // First 4 chars: DDSSi where DD=dir/10, SS=speed
  let dd = parseInt(code.slice(0, 2), 10);
  let ss = parseInt(code.slice(2, 4), 10);
  let tmp = null;

  // Temperature: rest of string (e.g. "+15", "-03", "15", "-3")
  if (code.length > 4) {
    const tmpStr = code.slice(4).replace(' ', '');
    tmp = parseInt(tmpStr, 10);
    if (isNaN(tmp)) tmp = null;
  }

  // High-speed encoding: if DD > 36, actual dir = (DD-50)×10, speed = SS+100
  if (dd > 36) { dd -= 50; ss += 100; }

  // Above 24000ft, temperatures are assumed negative unless + prefix given
  if (alt >= 24000 && tmp != null && tmp > 0 && !code.includes('+')) tmp = -tmp;

  return { dir: dd * 10, spd: ss, tmp };
}

async function fetchWindsAloft() {
  // Use server-side pre-fetched cache (avoids CORS, pre-fetched every 30 min)
  try {
    const apiBase = window.location.hostname === 'localhost'
      ? 'http://localhost:3001'
      : `http://${window.location.hostname}:3001`;
    const r = await fetch(`${apiBase}/api/winds-aloft-raw`);
    if (!r.ok) return null;
    const json = await r.json();
    if (!json.ok || !json.data) return null;
    // Parse lo then hi and merge
    let result = null;
    for (const level of ['lo', 'hi']) {
      if (json.data[level]) {
        const parsed = parseWindsText(json.data[level], level);
        if (parsed && !result) result = parsed;
        else if (parsed && result) {
          // Merge hi-altitude data into result
          for (const [st, altData] of Object.entries(parsed)) {
            if (!result[st]) result[st] = altData;
            else result[st] = { ...result[st], ...altData };
          }
        }
      }
    }
    return result;
  } catch(e) {
    return null;
  }
}

function parseWindsText(text, level) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let altHeader = null;
  const stations = {};
  let validTime = null;

  for (const line of lines) {
    if (line.startsWith('DATA BASED') || line.startsWith('BASED ON')) {
      validTime = line;
    }
    if (line.startsWith('FT')) {
      // Parse altitude header: "FT  3000   6000   9000..."
      altHeader = line.split(/\s+/).slice(1).map(Number).filter(n => n > 0);
      continue;
    }
    if (!altHeader) continue;

    // Station data line: "HNL 9900 2220+15 ..."
    const parts = line.split(/\s+/);
    const stId = parts[0];
    if (!/^[A-Z]{3}$/.test(stId)) continue;  // 3-char ICAO station code

    stations[stId] = { _validTime: validTime, _level: level };
    for (let i = 1; i < parts.length && i <= altHeader.length; i++) {
      const alt = altHeader[i - 1];
      stations[stId][alt] = parseWindCode(parts[i], alt);
    }
  }
  return stations;
}

// ── Speed color ───────────────────────────────────────────────
function speedColor(spd) {
  if (spd == null) return '#455a64';
  if (spd < 10)  return '#26c6da';
  if (spd < 20)  return '#66bb6a';
  if (spd < 35)  return '#ffa726';
  if (spd < 60)  return '#ef5350';
  return '#e040fb';
}

function altLabel(ft) {
  if (ft >= 18000) return `FL${ft / 100}`;
  return `${ft / 1000}k`;
}

function WindArrow({ dir, spd }) {
  if (dir == null || spd == null) return <span style={{ color: '#455a64' }}>—</span>;
  return (
    <span style={{ display: 'inline-block', transform: `rotate(${dir}deg)`, fontSize: 14, lineHeight: 1 }}>
      ↑
    </span>
  );
}

// ── Panel component ──────────────────────────────────────────
export default function WindsAloftPanel({ visible }) {
  const [stations, setStations] = useState(null);
  const [station,  setStation]  = useState('HNL');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  
  // Winds panel default position: bottom left
  const dragProps = useDraggable('windsAloft', { x: 12, y: window.innerHeight - 300 });

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    fetchWindsAloft()
      .then(data => {
        setStations(data);
        if (data && !data[station]) {
          const first = Object.keys(data).find(k => !k.startsWith('_'));
          if (first) setStation(first);
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
    // Refresh every 30 min
    const t = setInterval(() => {
      fetchWindsAloft().then(setStations).catch(() => {});
    }, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [visible]);

  if (!visible) return null;

  const stationIds = stations
    ? Object.keys(stations).filter(k => !k.startsWith('_'))
    : [];
  const data = stations?.[station] || {};
  const altKeys = ALTS.filter(a => data[a] != null);
  const validTime = data._validTime || '';

  return (
    <div className="winds-panel glass" {...dragProps}>
      <div className="winds-panel-header">
        <span className="winds-panel-title">💨 WINDS ALOFT</span>
        {validTime && (
          <span className="winds-valid-time" title={validTime}>
            {validTime.replace('DATA BASED ON ', '').slice(0, 16)}
          </span>
        )}
        <div className="winds-station-tabs">
          {stationIds.length > 0 ? stationIds.map(s => (
            <button
              key={s}
              className={`winds-station-btn ${station === s ? 'active' : ''}`}
              onClick={() => setStation(s)}
            >
              {s}
            </button>
          )) : loading ? (
            <span className="winds-no-data">Fetching…</span>
          ) : (
            <span className="winds-no-data">No data</span>
          )}
        </div>
      </div>

      {loading && !stations && (
        <div className="winds-no-data-msg">
          <div className="winds-spinner" />
          <span>Fetching FAA winds aloft…</span>
        </div>
      )}

      {error && (
        <div className="winds-no-data-msg" style={{ color: '#ef5350' }}>
          ⚠️ {error}
        </div>
      )}

      {!loading && !error && altKeys.length === 0 && (
        <div className="winds-no-data-msg">
          <div className="winds-spinner" />
          <span>Waiting for forecast cycle…</span>
        </div>
      )}

      {altKeys.length > 0 && (
        <table className="winds-table">
          <thead>
            <tr>
              <th>Alt</th>
              <th>Dir</th>
              <th>Kts</th>
              <th>Tmp</th>
            </tr>
          </thead>
          <tbody>
            {altKeys.map(ft => {
              const w = data[ft];
              if (!w) return null;
              return (
                <tr key={ft} className="winds-row">
                  <td className="winds-alt">{altLabel(ft)}</td>
                  <td className="winds-dir">
                    {w.calm ? (
                      <span style={{ color: '#455a64' }}>calm</span>
                    ) : (
                      <>
                        <WindArrow dir={w.dir} spd={w.spd} />
                        <span className="winds-deg">{w.dir != null ? `${w.dir}°` : '—'}</span>
                      </>
                    )}
                  </td>
                  <td className="winds-spd" style={{ color: speedColor(w.spd) }}>
                    {w.calm ? '—' : (w.spd ?? '—')}
                  </td>
                  <td className="winds-tmp">
                    {w.tmp != null ? `${w.tmp > 0 ? '+' : ''}${w.tmp}°` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
