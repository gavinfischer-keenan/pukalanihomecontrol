import { useState, useEffect } from 'react';
import { Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import './EcowittPanel.css';

const PWS_LAT =  21.2855;
const PWS_LON = -157.7969;

// ─── Map marker icon ─────────────────────────────────────────────────────────
function makePWSIcon(data, open) {
  const temp  = data?.temp_out_f   != null ? `${Math.round(data.temp_out_f)}°` : '--°';
  const wind  = data?.wind_spd_mph != null ? `${Math.round(data.wind_spd_mph)}` : '--';
  const rain  = data?.rain_daily_in != null && data.rain_daily_in > 0 ? '💧' : '';
  const stale = data?._stale;

  const html = `
    <div class="pws-icon${stale ? ' pws-stale' : ''}${open ? ' pws-icon-open' : ''}">
      <div class="pws-icon-temp">${temp}</div>
      <div class="pws-icon-row">
        <span class="pws-icon-wind">💨${wind}</span>
        <span class="pws-icon-rain">${rain}</span>
      </div>
    </div>`;

  return L.divIcon({
    html,
    className: '',
    iconSize:   [58, 42],
    iconAnchor: [29, 42],
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function windDir(deg) {
  if (deg == null) return '--';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function uvLevel(idx) {
  if (idx == null) return { label: '--', color: '#78909c' };
  if (idx >= 11)   return { label: 'Extreme',   color: '#9c27b0' };
  if (idx >= 8)    return { label: 'Very High',  color: '#ef5350' };
  if (idx >= 6)    return { label: 'High',       color: '#ff9800' };
  if (idx >= 3)    return { label: 'Moderate',   color: '#ffd54f' };
  return               { label: 'Low',       color: '#66bb6a' };
}

function safeFixed(val, decimals = 1) {
  if (val == null) return null;
  const num = Number(val);
  if (isNaN(num)) return '--';
  return num.toFixed(decimals);
}

function Row({ label, value, unit, color }) {
  return (
    <div className="pws-row">
      <span className="pws-row-label">{label}</span>
      <span className="pws-row-value" style={color ? { color } : {}}>
        {value ?? '--'}{unit ? <span className="pws-unit"> {unit}</span> : null}
      </span>
    </div>
  );
}

// ─── Floating panel (rendered by App, outside MapContainer) ──────────────────
export function EcowittFloatingPanel({ data, stale, onClose }) {
  const d   = data;
  const uv  = uvLevel(d?.uv_index);

  return (
    <div className="pws-floating-panel glass">
      {/* Header */}
      <div className="pws-popup-header">
        <span className="pws-popup-title">🏠 Pukalani Ecowitt</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {stale && <span className="pws-popup-stale">⚠ stale</span>}
          {d?.obs_time && (
            <span className="pws-popup-time">
              {new Date(d.obs_time).toLocaleTimeString('en-US', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Honolulu'
              })} HST
            </span>
          )}
          <button className="pws-close-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="pws-popup-inner">
        {!d && <div className="pws-loading">Waiting for reading…<br/><small>Device uploads every 60s</small></div>}

        {d && (
          <>
            <div className="pws-section-label">TEMPERATURE</div>
            <Row label="Outdoor"  value={safeFixed(d.temp_out_f, 1)} unit="°F" />
            <Row label="Dew Point" value={safeFixed(d.dew_point_f, 1)} unit="°F" />
            <Row label="Humidity" value={d.humidity_out != null ? Math.round(d.humidity_out) : null} unit="%" />
            <Row label="Indoor"   value={safeFixed(d.temp_in_f, 1)} unit="°F" />
            <Row label="Pressure" value={safeFixed(d.baro_rel_inhg, 2)} unit="inHg" />

            <div className="pws-section-label">WIND (WS90 Ultrasonic)</div>
            <Row label="Speed"     value={safeFixed(d.wind_spd_mph, 1)} unit="mph" />
            <Row label="Gust"      value={safeFixed(d.wind_gust_mph, 1)} unit="mph" />
            <Row label="Direction" value={d.wind_dir != null ? `${windDir(d.wind_dir)} (${d.wind_dir}°)` : null} />

            <div className="pws-section-label">RAIN (WS90 Piezo)</div>
            <Row label="Rate"       value={safeFixed(d.rain_rate_in, 3)} unit="in/hr" />
            <Row label="Today"      value={safeFixed(d.rain_daily_in, 2)} unit="in" />
            <Row label="This Month" value={safeFixed(d.rain_monthly_in, 2)} unit="in" />

            <div className="pws-section-label">SOLAR &amp; UV</div>
            <Row label="Solar Radiation" value={d.solar_rad != null ? Math.round(d.solar_rad) : null} unit="W/m²" />
            <Row label="UV Index"  value={safeFixed(d.uv_index, 1)} color={uv.color} />
            <Row label="UV Level"  value={uv.label} color={uv.color} />

            {d.lightning_count != null && d.lightning_count > 0 && (
              <>
                <div className="pws-section-label">LIGHTNING</div>
                <Row label="Strikes today"  value={d.lightning_count} color="#ffd54f" />
                {d.lightning_dist != null && d.lightning_dist < 40 && (
                  <Row label="Last distance" value={`${safeFixed(d.lightning_dist, 0)} mi`} color="#ff9800" />
                )}
              </>
            )}

            {d.ws90_batt != null && (
              <div className="pws-batt">WS90 cap: {safeFixed(d.ws90_batt, 2)}V</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Map marker layer (no Popup — triggers onOpen via click) ─────────────────
export default function EcowittLayer({ visible, apiBase, onOpen }) {
  const [data,  setData]  = useState(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let active = true;

    const go = async () => {
      try {
        const r = await fetch(`${apiBase}/api/ecowitt/current`);
        const j = await r.json();
        if (active) { setData(j.data); setStale(j.stale || !j.data); }
      } catch { if (active) setStale(true); }
    };

    go();
    const t = setInterval(go, 60000);
    return () => { active = false; clearInterval(t); };
  }, [visible, apiBase]);

  if (!visible) return null;

  const icon = makePWSIcon({ ...data, _stale: stale });

  return (
    <Marker
      position={[PWS_LAT, PWS_LON]}
      icon={icon}
      zIndexOffset={800}
      eventHandlers={{ click: onOpen }}
    />
  );
}
