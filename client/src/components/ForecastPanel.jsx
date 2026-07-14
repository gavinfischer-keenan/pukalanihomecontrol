import { useState, useEffect } from 'react';
import useDraggable from './useDraggable';
import './ForecastPanel.css';

const HOME = { lat: 21.2855, lon: -157.7969 };

// WMO weather code → emoji + description
function wmoInfo(code) {
  if (code == null) return { emoji: '❓', label: 'Unknown' };
  if (code === 0)              return { emoji: '☀️',  label: 'Clear' };
  if (code <= 3)               return { emoji: '⛅',  label: code === 1 ? 'Mostly Clear' : code === 2 ? 'Partly Cloudy' : 'Overcast' };
  if (code <= 49)              return { emoji: '🌫️',  label: 'Fog' };
  if (code <= 59)              return { emoji: '🌦️',  label: 'Drizzle' };
  if (code <= 69)              return { emoji: '🌧️',  label: 'Rain' };
  if (code <= 79)              return { emoji: '❄️',  label: 'Snow' };
  if (code <= 82)              return { emoji: '🌦️',  label: 'Showers' };
  if (code <= 84)              return { emoji: '🌨️',  label: 'Heavy Showers' };
  if (code <= 94)              return { emoji: '⛈️',  label: 'Thunderstorm' };
  return                              { emoji: '⛈️',  label: 'Severe Storm' };
}

function cToF(c) { return c != null ? Math.round(c * 9/5 + 32) : null; }

async function fetchForecast() {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${HOME.lat}&longitude=${HOME.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,` +
    `precipitation_sum,weathercode,windspeed_10m_max,winddirection_10m_dominant` +
    `&timezone=Pacific%2FHonolulu&forecast_days=7&temperature_unit=celsius&windspeed_unit=mph`;
  const r = await fetch(url);
  const data = await r.json();
  return data.daily;
}

// ── Solunar Fishing Index ───────────────────────────────────────────────
const CYCLE     = 29.53058867;   // lunar cycle in days
const EPOCH_NEW = 2459198.177;   // Julian Date of known new moon (Jan 13 2021 ~04:14 UTC)
const J2000     = 2451545.0;

function julianDate(d = new Date()) {
  return (d.getTime() / 86400000) + 2440587.5;
}

function getMoonAge(d = new Date()) {
  const jd  = julianDate(d);
  const age = ((jd - EPOCH_NEW) % CYCLE + CYCLE) % CYCLE;
  return age;
}

function solunarScore(d = new Date()) {
  const age = getMoonAge(d);
  // Phase score: peaks at 0 (new) and ~14.77 (full)
  const theta = (age / CYCLE) * 2 * Math.PI;
  const phase = (1 + Math.cos(2 * theta)) / 2; // 0-1, peaks at new+full

  // Moon transit major/minor times (approximate, local)
  // Upper transit offset: at new moon (~day 0), upper transit ≈ local noon (12:00)
  // Each day the moon rises ~50min later
  const transitHour = (12 + (age * 24.84 / 24)) % 24;   // upper transit
  const antiHour    = (transitHour + 12) % 24;           // lower transit (underfoot)
  const riseHour    = (transitHour - 6 + 24) % 24;       // moonrise
  const setHour     = (transitHour + 6) % 24;            // moonset

  return {
    score: phase,
    rating: phase > 0.75 ? 'Excellent' : phase > 0.5 ? 'Good' : phase > 0.25 ? 'Fair' : 'Poor',
    stars:  phase > 0.75 ? 4 : phase > 0.5 ? 3 : phase > 0.25 ? 2 : 1,
    major: [transitHour, antiHour],
    minor: [riseHour, setHour],
    age,
  };
}

function fmtHour(h) {
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  const period = hrs >= 12 ? 'PM' : 'AM';
  const h12 = hrs === 0 ? 12 : hrs > 12 ? hrs - 12 : hrs;
  return `${h12}:${String(mins).padStart(2,'0')} ${period}`;
}

function StarRating({ stars }) {
  return (
    <span className="fp-stars">
      {[1,2,3,4].map(s => (
        <span key={s} style={{ opacity: s <= stars ? 1 : 0.2 }}>★</span>
      ))}
    </span>
  );
}

// ── Main component ──────────────────────────────────────────────────────
export default function ForecastPanel({ visible, onClose }) {
  const [daily,   setDaily]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab,     setTab]     = useState('forecast'); // 'forecast' | 'fishing'

  const dragProps = useDraggable('forecast', {
    x: window.innerWidth - 330,
    y: window.innerHeight - 520,
  });

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    fetchForecast().then(setDaily).catch(console.warn).finally(() => setLoading(false));
    const t = setInterval(() => fetchForecast().then(setDaily).catch(() => {}), 60 * 60 * 1000);
    return () => clearInterval(t);
  }, [visible]);

  if (!visible) return null;

  const fish = solunarScore();

  return (
    <div className="fp-panel glass" {...dragProps}>
      <div className="fp-header">
        <div className="fp-tabs">
          <button className={`fp-tab ${tab === 'forecast' ? 'active' : ''}`} onClick={() => setTab('forecast')}>
            📅 7-Day
          </button>
          <button className={`fp-tab ${tab === 'fishing' ? 'active' : ''}`} onClick={() => setTab('fishing')}>
            🎣 Fishing
          </button>
        </div>
        <button className="fp-close-btn" onClick={onClose} title="Close">✕</button>
      </div>

      {/* ── 7-Day Forecast ── */}
      {tab === 'forecast' && (
        <div className="fp-body">
          {loading && !daily && <div className="fp-loading">Loading forecast…</div>}
          {daily && daily.time.map((date, i) => {
            const wmo   = wmoInfo(daily.weathercode?.[i]);
            const hi    = cToF(daily.temperature_2m_max?.[i]);
            const lo    = cToF(daily.temperature_2m_min?.[i]);
            const pop   = daily.precipitation_probability_max?.[i] ?? 0;
            const precip= (daily.precipitation_sum?.[i] ?? 0).toFixed(2);
            const wind  = Math.round(daily.windspeed_10m_max?.[i] ?? 0);
            const dow   = new Date(date + 'T12:00:00-10:00').toLocaleDateString('en-US', { weekday: 'short' });
            const isToday = i === 0;
            return (
              <div key={date} className={`fp-day ${isToday ? 'fp-day-today' : ''}`}>
                <div className="fp-dow">{isToday ? 'Today' : dow}</div>
                <div className="fp-icon" title={wmo.label}>{wmo.emoji}</div>
                <div className="fp-temps">
                  <span className="fp-hi">{hi}°</span>
                  <span className="fp-lo">/{lo}°</span>
                </div>
                <div className="fp-details">
                  {pop > 0 && <span className="fp-pop">💧{pop}%</span>}
                  <span className="fp-wind">💨{wind}mph</span>
                </div>
              </div>
            );
          })}
          <div className="fp-footer">
            <a
              className="fp-climate-link"
              href="https://www.cpc.ncep.noaa.gov/products/predictions/long_range/"
              target="_blank"
              rel="noreferrer"
            >
              📊 Extended Outlook &amp; Climate Commentary →
            </a>
            <a
              className="fp-climate-link"
              href="https://www.cpc.ncep.noaa.gov/products/predictions/ONI/ONI_change.shtml"
              target="_blank"
              rel="noreferrer"
            >
              🌊 El Niño / La Niña Status →
            </a>
          </div>
        </div>
      )}

      {/* ── Fishing Index ── */}
      {tab === 'fishing' && (
        <div className="fp-body fp-fishing">
          <div className="fp-fish-rating">
            <StarRating stars={fish.stars} />
            <span className={`fp-fish-label fp-fish-${fish.rating.toLowerCase()}`}>
              {fish.rating}
            </span>
          </div>
          <div className="fp-fish-meta">
            Moon age: {fish.age.toFixed(1)} days
          </div>

          <div className="fp-fish-times">
            <div className="fp-ft-section">
              <div className="fp-ft-label">MAJOR PERIODS (2hr windows)</div>
              {fish.major.map((h, i) => (
                <div key={i} className="fp-ft-row">
                  <span className="fp-ft-icon">🌙</span>
                  <span className="fp-ft-time">{fmtHour(h)}</span>
                  <span className="fp-ft-desc">{i === 0 ? 'Moon overhead' : 'Moon underfoot'}</span>
                </div>
              ))}
            </div>
            <div className="fp-ft-section">
              <div className="fp-ft-label">MINOR PERIODS (1hr windows)</div>
              {fish.minor.map((h, i) => (
                <div key={i} className="fp-ft-row">
                  <span className="fp-ft-icon">🎣</span>
                  <span className="fp-ft-time">{fmtHour(h)}</span>
                  <span className="fp-ft-desc">{i === 0 ? 'Moonrise' : 'Moonset'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="fp-fish-note">
            Solunar theory: fish feeding peaks near major periods,
            especially during new &amp; full moon phases.
          </div>
        </div>
      )}
    </div>
  );
}
