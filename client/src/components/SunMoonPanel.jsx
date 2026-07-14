import { useState, useEffect } from 'react';
import useDraggable from './useDraggable';
import './SunMoonPanel.css';

const HOME = { lat: 21.2855, lon: -157.7969 };

function getMoonData() {
  const now = new Date();
  const daysSince = (now.getTime() / 86400000) - 10592.76;
  const CYCLE = 29.53058867;
  const age = ((daysSince % CYCLE) + CYCLE) % CYCLE;
  const illum = Math.round(50 * (1 - Math.cos((age / CYCLE) * 2 * Math.PI)));
  let phase, emoji;
  if (age < 1.85)       { phase = 'New Moon';        emoji = '🌑'; }
  else if (age < 5.54)  { phase = 'Waxing Crescent'; emoji = '🌒'; }
  else if (age < 9.22)  { phase = 'First Quarter';   emoji = '🌓'; }
  else if (age < 12.91) { phase = 'Waxing Gibbous';  emoji = '🌔'; }
  else if (age < 16.61) { phase = 'Full Moon';        emoji = '🌕'; }
  else if (age < 20.30) { phase = 'Waning Gibbous';  emoji = '🌖'; }
  else if (age < 23.99) { phase = 'Last Quarter';    emoji = '🌗'; }
  else if (age < 27.68) { phase = 'Waning Crescent'; emoji = '🌘'; }
  else                  { phase = 'New Moon';         emoji = '🌑'; }
  const daysToFull = age < 14.77 ? (14.77 - age) : (CYCLE - age + 14.77);
  const nextFull = new Date(now.getTime() + daysToFull * 86400000);
  const daysToNew = (CYCLE - age) % CYCLE;
  const nextNew = new Date(now.getTime() + daysToNew * 86400000);
  return { age, phase, emoji, illum, nextFull, nextNew };
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

async function fetchSunTimes() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${HOME.lat}&longitude=${HOME.lon}` +
    `&daily=sunrise,sunset&timezone=Pacific%2FHonolulu&forecast_days=2`;
  const r = await fetch(url);
  const data = await r.json();
  const d = data.daily || {};
  return {
    today:    { sunrise: d.sunrise?.[0], sunset: d.sunset?.[0],  date: d.time?.[0] },
    tomorrow: { sunrise: d.sunrise?.[1], sunset: d.sunset?.[1],  date: d.time?.[1] },
  };
}

function SunBar({ sunrise, sunset }) {
  const now = new Date();
  const sr = sunrise ? new Date(sunrise) : null;
  const ss = sunset  ? new Date(sunset)  : null;
  if (!sr || !ss) return null;
  const pct = Math.max(0, Math.min(100, ((now - sr) / (ss - sr)) * 100));
  const isDaytime = now >= sr && now <= ss;
  return (
    <div className="sm-sun-bar">
      <div className="sm-sun-track">
        <div className="sm-sun-fill" style={{ width: `${pct}%` }} />
        {isDaytime && <div className="sm-sun-cursor" style={{ left: `${pct}%` }}>☀️</div>}
      </div>
    </div>
  );
}

export default function SunMoonPanel({ visible }) {
  const [sun, setSun] = useState(null);
  const moon = getMoonData();
  
  // Default position: top right, beside the layer panel
  const dragProps = useDraggable('sunmoon', { x: window.innerWidth - 500, y: 12 });

  useEffect(() => {
    if (!visible) return;
    fetchSunTimes().then(setSun).catch(() => {});
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="sunmoon-panel glass" {...dragProps}>
      <div className="sm-header">
        <span className="sm-title">☀️ SUN &amp; 🌙 MOON</span>
      </div>

      {/* Moon — single compact row */}
      <div className="sm-moon-row">
        <span className="sm-moon-emoji">{moon.emoji}</span>
        <div className="sm-moon-info">
          <div className="sm-phase">{moon.phase} <span className="sm-illum">{moon.illum}%</span></div>
          <div className="sm-next-row">
            <span className="sm-next-full">🌕 {fmtDate(moon.nextFull)}</span>
            <span className="sm-next-new">🌑 {fmtDate(moon.nextNew)}</span>
          </div>
        </div>
      </div>

      {/* Sun bar */}
      <SunBar sunrise={sun?.today?.sunrise} sunset={sun?.today?.sunset} />

      {/* Today + Tomorrow in one compact row */}
      <div className="sm-times-grid">
        <div className="sm-times-col">
          <div className="sm-day-label">TODAY</div>
          <div className="sm-rise">🌅 {fmtTime(sun?.today?.sunrise)}</div>
          <div className="sm-set">🌆 {fmtTime(sun?.today?.sunset)}</div>
        </div>
        <div className="sm-divider-v" />
        <div className="sm-times-col">
          <div className="sm-day-label">TOMORROW</div>
          <div className="sm-rise">🌅 {fmtTime(sun?.tomorrow?.sunrise)}</div>
          <div className="sm-set">🌆 {fmtTime(sun?.tomorrow?.sunset)}</div>
        </div>
      </div>
    </div>
  );
}
