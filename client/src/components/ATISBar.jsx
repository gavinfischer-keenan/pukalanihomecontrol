import { useEffect, useState } from 'react';
import './ATISBar.css';

// Decode raw METAR string into readable fields
function decodeMetar(raw) {
  if (!raw) return null;
  const parts = raw.split(' ');
  const result = {};

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    // Wind: DDDSSKTs or DDDSSGGGKTs
    if (/^\d{3}\d{2}(G\d{2,3})?KT$/.test(p)) {
      result.wind = p;
      const m = p.match(/^(\d{3})(\d{2})(?:G(\d{2,3}))?KT/);
      if (m) {
        result.windDir = m[1];
        result.windSpd = m[2];
        result.windGst = m[3] || null;
      }
    }
    // Variable wind
    if (/^VRB\d{2}KT$/.test(p)) { result.wind = p; result.windDir = 'VRB'; }

    // Visibility
    if (/^10SM$/.test(p) || /^10\+$/.test(p)) result.vis = '10+ SM';
    if (/^\d\/\d+SM$/.test(p) || /^\d+SM$/.test(p)) result.vis = p;

    // Weather phenomena
    if (/^(-|\+)?(RA|SN|DZ|FG|BR|HZ|TS|SH|GR|GS|PL|IC)/.test(p)) result.wx = (result.wx || '') + ' ' + p;

    // Cloud layers: FEW/SCT/BKN/OVC + height
    if (/^(FEW|SCT|BKN|OVC)\d{3}/.test(p)) {
      result.clouds = result.clouds || [];
      const cover = p.slice(0, 3);
      const base = parseInt(p.slice(3)) * 100;
      result.clouds.push({ cover, base: base.toLocaleString() });
    }
    if (p === 'CLR' || p === 'SKC') result.clouds = [{ cover: p, base: 'clear' }];

    // Temp/Dew: T/T or MM/MM
    if (/^(M?\d{2})\/(M?\d{2})$/.test(p)) {
      const m = p.match(/^(M?)(\d{2})\/(M?)(\d{2})$/);
      if (m) {
        const tc = (m[1] ? -1 : 1) * parseInt(m[2]);
        const td = (m[3] ? -1 : 1) * parseInt(m[4]);
        result.temp = tc;
        result.dew  = td;
        result.tempF = Math.round(tc * 9/5 + 32);
      }
    }

    // Altimeter: A3003
    if (/^A\d{4}$/.test(p)) {
      result.altim = (parseInt(p.slice(1)) / 100).toFixed(2);
    }
  }
  return result;
}

function CloudStr({ clouds }) {
  if (!clouds?.length) return <span>Clear</span>;
  const FULL = { FEW: 'Few', SCT: 'Scattered', BKN: 'Broken', OVC: 'Overcast', CLR: 'Clear', SKC: 'Sky Clear' };
  return (
    <>
      {clouds.map((c, i) => (
        <span key={i} style={{ marginRight: 8 }}>
          {FULL[c.cover] || c.cover} {c.base !== 'clear' ? `@ ${c.base}ft` : ''}
        </span>
      ))}
    </>
  );
}

function WindStr({ dir, spd, gst }) {
  if (!dir) return <span>—</span>;
  if (dir === 'VRB') return <span>Variable @ {spd}kt</span>;
  const arrow = ['↓','↙','←','↖','↑','↗','→','↘'][Math.round(parseInt(dir) / 45) % 8];
  return (
    <span>
      {arrow} {dir}° @ {parseInt(spd)}kt{gst ? ` gust ${gst}kt` : ''}
    </span>
  );
}

export default function ATISBar({ metars, visible }) {
  const [lastFetch, setLastFetch] = useState(null);

  // Force a refresh every 5 minutes to show age
  useEffect(() => {
    const t = setInterval(() => setLastFetch(new Date()), 300000);
    return () => clearInterval(t);
  }, []);

  if (!visible || !metars) return null;

  const hnl = metars.find(m => m.icao === 'PHNL');

  const catColor = { VFR: '#00e676', MVFR: '#2979ff', IFR: '#ff1744', LIFR: '#e040fb' };

  return (
    <div className="atis-bar glass">
      <div className="atis-station-tag">
        <span className="atis-icao">PHNL</span>
        <span className="atis-name">Honolulu Intl — ATIS</span>
      </div>

      {!hnl ? (
        <div className="atis-waiting">⏳ Awaiting PHNL METAR data…</div>
      ) : (() => {
        const d = decodeMetar(hnl.raw_metar);
        const age = hnl.obs_time
          ? `${Math.round((Date.now() - new Date(hnl.obs_time)) / 60000)}m ago`
          : '';
        const color = catColor[hnl.flight_cat] || '#607d8b';
        return (
          <div className="atis-content">
            {/* Flight category badge */}
            <div className="atis-cat" style={{ color, borderColor: color }}>
              {hnl.flight_cat || '—'}
            </div>

            {/* Decoded fields */}
            <div className="atis-fields">
              <div className="atis-field">
                <span className="atis-fl">WIND</span>
                <span className="atis-fv"><WindStr dir={d?.windDir} spd={d?.windSpd} gst={d?.windGst} /></span>
              </div>
              <div className="atis-field">
                <span className="atis-fl">VIS</span>
                <span className="atis-fv">{d?.vis || hnl.vis_sm + ' SM'}</span>
              </div>
              <div className="atis-field">
                <span className="atis-fl">SKY</span>
                <span className="atis-fv"><CloudStr clouds={d?.clouds} /></span>
              </div>
              {d?.wx && (
                <div className="atis-field">
                  <span className="atis-fl">WX</span>
                  <span className="atis-fv wx-str">{d.wx.trim()}</span>
                </div>
              )}
              <div className="atis-field">
                <span className="atis-fl">TEMP</span>
                <span className="atis-fv">{d?.temp != null ? `${d.temp}°C / ${d.tempF}°F` : '—'}</span>
              </div>
              <div className="atis-field">
                <span className="atis-fl">DEW</span>
                <span className="atis-fv">{d?.dew != null ? `${d.dew}°C` : '—'}</span>
              </div>
              <div className="atis-field">
                <span className="atis-fl">ALTIM</span>
                <span className="atis-fv">{d?.altim ? `${d.altim} inHg` : '—'}</span>
              </div>
            </div>

            {/* Raw METAR — scrollable */}
            <div className="atis-raw-wrap">
              <span className="atis-raw-label">RAW</span>
              <div className="atis-raw-text">{hnl.raw_metar}</div>
            </div>

            <div className="atis-age">{age}</div>
          </div>
        );
      })()}
    </div>
  );
}
