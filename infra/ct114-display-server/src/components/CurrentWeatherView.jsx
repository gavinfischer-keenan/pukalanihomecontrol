import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * CurrentWeatherView — Container-Aware Auto-Adapting Weather Dashboard.
 * 
 * Includes:
 *  - Box 1: Temp, Atmosphere & Integrated Humidity.
 *  - Box 2: Wind & Rain Station.
 *  - Box 3: Animated Wave & Sea State.
 *  - Box 4 (SIMPLIFIED ROWS): 7-Day NWS Forecast in ultra-clean horizontal rows with full day names ("TONIGHT", "FRIDAY"), HI/LO temps, SVG icons, description in parentheses, and wind speed.
 *  - Box 5: Marine Box (Advisories & Tides).
 *  - Box 6: Sky and Fish Panel (Balanced Arcs & Moon Phase Slider).
 */

// ── Inline Vector SVG Icons ────────────────────────────────────────────────
const IconThermometer = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
  </svg>
);

const IconWind = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
  </svg>
);

const IconCalendar = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const IconWave = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  </svg>
);

const IconFish = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 12c.94-2.07 2.96-3.5 5.3-3.5 3.5 0 6.5 2.5 8.2 3.5-1.7 1-4.7 3.5-8.2 3.5-2.34 0-4.36-1.43-5.3-3.5zm0 0L2 8.5v7l4.5-3.5z"/>
    <circle cx="14" cy="11" r="1" fill="#34d399"/>
  </svg>
);

const IconSun = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
);

const IconMoon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#cbd5e1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const IconCloudRain = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 13v6m-4-4v6m-4-5v6M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
  </svg>
);

const IconCloudSun = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v2m-7.1 2.9l1.4 1.4M2 12h2m15.4-7.1l-1.4 1.4M17 18a5 5 0 0 0-3-9.26 8 8 0 0 0-11.7 8.26"/>
    <path d="M20 16.58A5 5 0 0 0 18 7h-1.26" stroke="#38bdf8" strokeWidth="2" />
  </svg>
);

const IconThunder = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#eab308" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/>
    <polygon points="13 11 9 17 13 17 11 23 17 15 13 15" fill="#f59e0b" stroke="none"/>
  </svg>
);

const IconCloud = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#cbd5e1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
  </svg>
);

const IconArrowUp = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5m-7 7l7-7 7 7"/>
  </svg>
);

const IconArrowDown = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14m7-7l-7 7-7-7"/>
  </svg>
);

function getWeatherGraphic(forecastText = '') {
  const t = forecastText.toLowerCase();
  if (t.includes('thunder') || t.includes('tstorm')) return <IconThunder />;
  if (t.includes('heavy rain') || t.includes('showers') || t.includes('rain')) return <IconCloudRain />;
  if (t.includes('partly') || t.includes('few clouds') || t.includes('scattered')) return <IconCloudSun />;
  if (t.includes('sunny') || t.includes('clear')) return <IconSun />;
  return <IconCloud />;
}

// ── Solunar Fishing Index Math ─────────────────────────────────────────────
const LUNAR_CYCLE  = 29.53058867;
const EPOCH_NEW_JD = 2459198.177;

function julianDate(d = new Date()) {
  return (d.getTime() / 86400000) + 2440587.5;
}

function getMoonAge(d = new Date()) {
  const jd  = julianDate(d);
  return ((jd - EPOCH_NEW_JD) % LUNAR_CYCLE + LUNAR_CYCLE) % LUNAR_CYCLE;
}

function solunarScore(d = new Date()) {
  const age = getMoonAge(d);
  const theta = (age / LUNAR_CYCLE) * 2 * Math.PI;
  const phase = (1 + Math.cos(2 * theta)) / 2;

  const transitHour = (12 + (age * 24.84 / 24)) % 24;
  const antiHour    = (transitHour + 12) % 24;
  const riseHour    = (transitHour - 6 + 24) % 24;
  const setHour     = (transitHour + 6) % 24;

  return {
    score:  phase,
    rating: phase > 0.75 ? 'Excellent' : phase > 0.5 ? 'Good' : phase > 0.25 ? 'Fair' : 'Poor',
    stars:  phase > 0.75 ? 4 : phase > 0.5 ? 3 : phase > 0.25 ? 2 : 1,
    major:  [transitHour, antiHour],
    minor:  [riseHour, setHour],
    age,
  };
}

function fmtHour(h) {
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  const period = hrs >= 12 ? 'PM' : 'AM';
  const h12 = hrs === 0 ? 12 : hrs > 12 ? hrs - 12 : hrs;
  return `${h12}:${String(mins).padStart(2, '0')} ${period}`;
}

// ── Sun & Moon Calculator ──────────────────────────────────────────────────
function getSunMoon(lat, lon, date = new Date()) {
  const rad = Math.PI / 180;
  const d = date;
  const JD = Math.floor(365.25 * (d.getUTCFullYear() + 4716)) +
    Math.floor(30.6001 * (d.getUTCMonth() + 2)) +
    d.getUTCDate() - 1524.5 +
    (d.getUTCHours() + d.getUTCMinutes() / 60) / 24;
  const n = JD - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const sinDec = Math.sin(23.439 * rad) * Math.sin(lambda);
  const dec = Math.asin(sinDec);
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) /
    (Math.cos(lat * rad) * Math.cos(dec));

  let sunrise = null, sunset = null;
  if (Math.abs(cosH) <= 1) {
    const H = Math.acos(cosH) / rad;
    const UT = 12 - lon / 15;
    const EqT = (-1.915 * Math.sin(g) - 0.02 * Math.sin(2 * g) + 2.466 * Math.sin(2 * lambda) - 0.053 * Math.sin(4 * lambda)) / 15;
    const toTime = (h) => {
      const local = ((h % 24) + 24) % 24;
      const hr = Math.floor(local); const mn = Math.floor((local - hr) * 60);
      return `${hr % 12 || 12}:${String(mn).padStart(2, '0')} ${hr >= 12 ? 'PM' : 'AM'}`;
    };
    sunrise = toTime(UT - H / 15 + EqT);
    sunset  = toTime(UT + H / 15 + EqT);
  }

  const moonAge = getMoonAge(d);
  const phaseFraction = moonAge / LUNAR_CYCLE;
  const moonPhaseLabel = (() => {
    if (phaseFraction < 0.03 || phaseFraction > 0.97) return 'New Moon';
    if (phaseFraction < 0.22) return 'Waxing Crescent';
    if (phaseFraction < 0.28) return 'First Quarter';
    if (phaseFraction < 0.47) return 'Waxing Gibbous';
    if (phaseFraction < 0.53) return 'Full Moon';
    if (phaseFraction < 0.72) return 'Waning Gibbous';
    if (phaseFraction < 0.78) return 'Last Quarter';
    return 'Waning Crescent';
  })();

  const isWaning = phaseFraction >= 0.5;

  return {
    sunrise, sunset,
    moonPhaseLabel,
    moonIllum: Math.round((1 - Math.abs(2 * phaseFraction - 1)) * 100),
    moonAge:   Math.round(moonAge * 10) / 10,
    phaseFraction,
    isWaning,
  };
}

// ── Humidity Comfort Scale Helper ──────────────────────────────────────────
function getHumidityComfort(rh) {
  if (rh == null) return { label: '—', color: '#94a3b8', percent: 0 };
  if (rh < 30)  return { label: 'Dry',      color: '#f59e0b', percent: Math.max(10, rh) };
  if (rh <= 50) return { label: 'Ideal',    color: '#10b981', percent: rh };
  if (rh <= 60) return { label: 'Pleasant', color: '#38bdf8', percent: rh };
  if (rh <= 70) return { label: 'Humid',    color: '#0284c7', percent: rh };
  return               { label: 'Muggy',    color: '#a855f7', percent: Math.min(100, rh) };
}

function getCardinal(deg) {
  if (deg == null) return 'N/A';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Graphic Sub-Components ─────────────────────────────────────────────────

/** Expanded Wind Compass Rose Gauge */
const WindCompass = ({ dir = 0, speed = 0, gust = 0 }) => {
  const cardinal = getCardinal(dir);
  return (
    <div className="wx-wind-gauge">
      <svg viewBox="0 0 120 120" className="wx-compass-svg">
        <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(56, 189, 248, 0.3)" strokeWidth="2.5" />
        <circle cx="60" cy="60" r="48" fill="rgba(15, 23, 42, 0.85)" />
        
        <text x="60" y="16" className="wx-compass-cardinal" textAnchor="middle">N</text>
        <text x="106" y="64" className="wx-compass-cardinal" textAnchor="middle">E</text>
        <text x="60" y="110" className="wx-compass-cardinal" textAnchor="middle">S</text>
        <text x="14" y="64" className="wx-compass-cardinal" textAnchor="middle">W</text>

        <g transform={`rotate(${dir} 60 60)`}>
          <polygon points="60,20 54,48 66,48" fill="#f59e0b" />
          <polygon points="60,100 56,72 64,72" fill="rgba(255,255,255,0.35)" />
          <line x1="60" y1="20" x2="60" y2="100" stroke="#f59e0b" strokeWidth="2" opacity="0.7" />
        </g>

        <circle cx="60" cy="60" r="28" fill="rgba(11, 19, 41, 0.95)" stroke="rgba(245, 158, 11, 0.6)" strokeWidth="1.5" />
        <text x="60" y="56" className="wx-compass-speed" textAnchor="middle">{speed}</text>
        <text x="60" y="67" className="wx-compass-unit" textAnchor="middle">MPH</text>
      </svg>

      <div className="wx-wind-details">
        <div className="wx-wind-dir-text">{cardinal} ({dir}°)</div>
        {gust > 0 && <div className="wx-wind-gust">Gusts {gust} mph</div>}
      </div>
    </div>
  );
};

/** Expanded Virtual Rain Cup Gauge */
const RainCup = ({ dailyRain = 0, rainRate = 0 }) => {
  const maxRain = 2.0;
  const fillRatio = Math.min(Math.max(dailyRain / maxRain, 0), 1);
  const fillHeight = fillRatio * 150;

  return (
    <div className="wx-rain-cup-container">
      <div className="wx-rain-cup">
        <div className="wx-cup-glass">
          <div className="wx-cup-ticks">
            <span className="wx-tick" style={{ bottom: '85%' }}>2.0"</span>
            <span className="wx-tick" style={{ bottom: '60%' }}>1.5"</span>
            <span className="wx-tick" style={{ bottom: '38%' }}>1.0"</span>
            <span className="wx-tick" style={{ bottom: '18%' }}>0.5"</span>
          </div>
          <div className="wx-cup-water" style={{ height: `${fillHeight}px` }}>
            <div className="wx-water-wave"></div>
          </div>
        </div>
      </div>
      <div className="wx-rain-readout">
        <div className="wx-rain-val">{dailyRain.toFixed(2)}"</div>
        <div className="wx-rain-lbl">{rainRate > 0 ? `${rainRate} in/hr` : 'Today'}</div>
      </div>
    </div>
  );
};

/** Compact Humidity Meter */
const CompactHumidity = ({ label, rh }) => {
  const comfort = getHumidityComfort(rh);
  return (
    <div className="wx-compact-hum-pill">
      <div className="wx-ch-row">
        <span className="wx-ch-lbl">{label}</span>
        <span className="wx-ch-val">{rh != null ? `${rh}%` : '—'}</span>
      </div>
      <div className="wx-ch-bar-bg">
        <div className="wx-ch-bar-fill" style={{ width: `${comfort.percent}%`, background: comfort.color }} />
      </div>
      <span className="wx-ch-badge" style={{ color: comfort.color }}>{comfort.label}</span>
    </div>
  );
};

// ── 6 Panels ───────────────────────────────────────────────────────────────

/** Box 1: Current Temp, Atmosphere & Integrated Humidity */
const TempAtmosphereBox = ({ data }) => {
  if (!data) return <div className="wx-panel wx-loading">Loading weather data…</div>;

  return (
    <div className="wx-panel wx-box-temp" data-section="temp-atmo">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconThermometer /> Current Temp &amp; Atmosphere</h2>
        <span className="wx-badge-live">LIVE</span>
      </div>

      <div className="wx-temp-main-display">
        <div className="wx-temp-big">{data.temp_out_f}°<span className="wx-temp-unit">F</span></div>
        <div className="wx-temp-sub-group">
          <div className="wx-sub-row"><span className="wx-sub-lbl">Indoor Temp</span><span className="wx-sub-val">{data.temp_in_f}°F</span></div>
          <div className="wx-sub-row"><span className="wx-sub-lbl">Dew Point</span><span className="wx-sub-val">{data.dew_point_f}°F</span></div>
        </div>
      </div>

      <div className="wx-atmo-stats-grid">
        <div className="wx-atmo-card">
          <span className="wx-atmo-lbl">Barometer</span>
          <span className="wx-atmo-val">{data.baro_rel_inhg}" Hg</span>
        </div>
        <div className="wx-atmo-card">
          <span className="wx-atmo-lbl">UV Index</span>
          <span className="wx-atmo-val">{data.uv_index}</span>
        </div>
        <div className="wx-atmo-card">
          <span className="wx-atmo-lbl">Solar Rad</span>
          <span className="wx-atmo-val">{data.solar_rad} W/m²</span>
        </div>
      </div>

      <div className="wx-integrated-humidity-grid">
        <CompactHumidity label="Outdoor Humidity" rh={data.humidity_out} />
        <CompactHumidity label="Indoor Humidity" rh={data.humidity_in} />
      </div>
    </div>
  );
};

/** Box 2: Wind & Rain Station */
const WindRainBox = ({ data }) => {
  if (!data) return <div className="wx-panel wx-loading">Loading wind data…</div>;

  return (
    <div className="wx-panel wx-box-wind" data-section="wind-rain">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconWind /> Wind &amp; Rain Station</h2>
        <span className="wx-badge-info">WS90</span>
      </div>

      <div className="wx-wind-rain-grid">
        <div className="wx-sub-card wx-wind-subcard">
          <WindCompass 
            dir={data.wind_dir} 
            speed={data.wind_spd_mph} 
            gust={data.wind_gust_mph} 
          />
        </div>

        <div className="wx-sub-card wx-rain-subcard">
          <RainCup 
            dailyRain={data.rain_daily_in || 0} 
            rainRate={data.rain_rate_in || 0} 
          />
        </div>
      </div>
    </div>
  );
};

/** Box 3: Wave & Sea Animation Placeholder */
const SeaAnimationBox = () => {
  return (
    <div className="wx-panel wx-box-sea-anim" data-section="sea-animation">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconWave /> Wave &amp; Sea State</h2>
        <span className="wx-badge-info">ANIMATED SWELL</span>
      </div>

      <div className="wx-sea-anim-container">
        <div className="wx-sea-canvas">
          <svg className="wx-sea-waves-svg" viewBox="0 0 1200 180" preserveAspectRatio="none">
            <defs>
              <linearGradient id="oceanGradBack" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0369a1" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0.8" />
              </linearGradient>
              <linearGradient id="oceanGradFront" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#0284c7" stopOpacity="0.95" />
              </linearGradient>
            </defs>

            <path 
              className="wx-wave-layer-back" 
              fill="url(#oceanGradBack)" 
              d="M0 90 Q300 40 600 90 T1200 90 L1200 180 L0 180 Z"
            />
            <path 
              className="wx-wave-layer-mid" 
              fill="rgba(2, 132, 199, 0.5)" 
              d="M0 100 Q300 130 600 100 T1200 100 L1200 180 L0 180 Z"
            />
            <path 
              className="wx-wave-layer-front" 
              fill="url(#oceanGradFront)" 
              d="M0 110 Q300 70 600 110 T1200 110 L1200 180 L0 180 Z"
            />
          </svg>

          <div className="wx-sea-overlay-metrics">
            <div className="wx-sea-stat">
              <span className="wx-ss-lbl">Swell Height</span>
              <span className="wx-ss-val">4.2 FT @ 12s</span>
            </div>
            <div className="wx-sea-stat">
              <span className="wx-ss-lbl">Swell Direction</span>
              <span className="wx-ss-val">SSW (200°)</span>
            </div>
            <div className="wx-sea-stat">
              <span className="wx-ss-lbl">Sea Temp</span>
              <span className="wx-ss-val">78.5°F</span>
            </div>
          </div>

          <div className="wx-sea-placeholder-label">
            🌊 Live Wave &amp; Ocean Swell Model Placeholder
          </div>
        </div>
      </div>
    </div>
  );
};

/** Box 4 (SIMPLIFIED ROWS): 7-Day NWS Forecast Layout */
const ForecastBox = ({ periods }) => {
  if (!periods || periods.length === 0) return <div className="wx-panel wx-loading">Loading forecast…</div>;

  // Group forecast periods into daily rows
  const rowsMap = [];
  periods.forEach(p => {
    let name = p.name;
    if (name === 'Tonight' || (name.includes('Night') && rowsMap.length === 0)) {
      name = 'TONIGHT';
    } else {
      name = name.replace(/ Night$/, '').toUpperCase();
    }

    let existing = rowsMap.find(r => r.name === name);
    if (!existing) {
      existing = {
        name,
        high: p.isDaytime ? p.temperature : null,
        low: !p.isDaytime ? p.temperature : null,
        shortForecast: p.shortForecast,
        windSpeed: p.windSpeed,
        pop: p.probabilityOfPrecipitation?.value || null,
      };
      rowsMap.push(existing);
    } else {
      if (p.isDaytime) existing.high = p.temperature;
      else existing.low = p.temperature;
      if (!existing.pop && p.probabilityOfPrecipitation?.value) {
        existing.pop = p.probabilityOfPrecipitation.value;
      }
    }
  });

  const rows = rowsMap.slice(0, 7);

  return (
    <div className="wx-panel wx-box-forecast" data-section="forecast">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconCalendar /> 7-Day NWS Forecast</h2>
        <span className="wx-badge-info">NOAA</span>
      </div>

      <div className="wx-forecast-rows-list">
        {rows.map((r, i) => (
          <div key={i} className={`wx-fcr-row-card ${i === 0 ? 'highlight' : ''}`}>
            <div className="wx-fcr-day-col">{r.name}</div>
            
            <div className="wx-fcr-icon-col">
              {getWeatherGraphic(r.shortForecast)}
            </div>

            <div className="wx-fcr-temp-col">
              <span className="wx-fcr-hi">{r.high != null ? `HI ${r.high}°` : '—'}</span>
              <span className="wx-fcr-sep">/</span>
              <span className="wx-fcr-lo">{r.low != null ? `LO ${r.low}°` : '—'}</span>
            </div>

            <div className="wx-fcr-desc-col">
              ({r.shortForecast})
            </div>

            {r.pop > 0 && (
              <div className="wx-fcr-pop-col">{r.pop}% Rain</div>
            )}

            <div className="wx-fcr-wind-col">
              {r.windSpeed}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Box 5: Marine Box */
const MarineBox = ({ predictions, alerts = [] }) => {
  if (!predictions || predictions.length === 0) return <div className="wx-panel wx-loading">Loading marine data…</div>;

  const activeEvents = alerts.map(a => ({
    event: a.properties?.event || '',
    headline: a.properties?.headline || '',
    area: a.properties?.areaDesc || '',
  }));

  const isOahuMarine = (area) => {
    if (!area) return true;
    const a = area.toLowerCase();
    return a.includes('oahu') || a.includes('honolulu') || a.includes('hawaii') || a.includes('coastal') || a.includes('waters');
  };

  const relevantAlerts = activeEvents.filter(a => isOahuMarine(a.area));

  const smallCraftActive = relevantAlerts.some(a => a.event.toLowerCase().includes('small craft'));
  const highSurfActive   = relevantAlerts.some(a => a.event.toLowerCase().includes('high surf'));

  const specialAlerts = relevantAlerts.filter(a => {
    const e = a.event.toLowerCase();
    return !e.includes('small craft') && !e.includes('high surf');
  });

  const specialText = specialAlerts.length > 0 
    ? specialAlerts[0].event.toUpperCase()
    : null;

  const now = new Date();
  const upcoming = predictions.filter(p => new Date(p.t) >= now && p.tide_type);
  const pts = predictions.slice(0, 36);

  const maxH = Math.max(...pts.map(p => p.height_ft));
  const minH = Math.min(...pts.map(p => p.height_ft));
  const range = (maxH - minH) || 1;

  const svgW = 480, svgH = 65, padY = 14, padX = 10;
  const toX = (i) => padX + (i / (pts.length - 1)) * (svgW - 2 * padX);
  const toY = (h) => padY + (1 - (h - minH) / range) * (svgH - 2 * padY);

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.height_ft).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${svgW - padX} ${svgH} L ${padX} ${svgH} Z`;

  const nowIdx = Math.min(Math.floor((now - new Date(pts[0].t)) / 3600000), pts.length - 1);
  const nowX = toX(Math.max(0, nowIdx));
  const nowY = toY(pts[Math.max(0, nowIdx)]?.height_ft || 0);

  return (
    <div className="wx-panel wx-box-tides" data-section="marine">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconWave /> Marine</h2>
        <span className="wx-badge-info">South Oahu Coast</span>
      </div>

      <div className="wx-marine-status-grid">
        <div className={`wx-marine-status-card ${smallCraftActive ? 'alert' : 'ok'}`}>
          <span className={`wx-status-indicator ${smallCraftActive ? 'red' : 'green'}`} />
          <span className="wx-status-text">
            {smallCraftActive ? 'SMALL CRAFT ADVISORY' : 'No Small Craft Advisory'}
          </span>
        </div>

        <div className={`wx-marine-status-card ${highSurfActive ? 'alert' : 'ok'}`}>
          <span className={`wx-status-indicator ${highSurfActive ? 'red' : 'green'}`} />
          <span className="wx-status-text">
            {highSurfActive ? 'HIGH SURF ADVISORY' : 'No High Surf Advisory'}
          </span>
        </div>
      </div>

      <div className={`wx-marine-special-box ${specialText ? 'alert' : 'ok'}`}>
        <span className="wx-special-title">SPECIAL NOTIFICATION:</span>
        <span className="wx-special-body">
          {specialText ? specialText : 'No Special Marine Notifications'}
        </span>
      </div>

      <div className="wx-tide-chart-wrapper">
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="wx-tide-svg">
          <defs>
            <linearGradient id="tideGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          <path d={areaD} fill="url(#tideGrad)" />
          <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />

          <line x1={nowX} y1="0" x2={nowX} y2={svgH} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx={nowX} cy={nowY} r="4.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />

          {pts.map((p, i) => p.tide_type ? (
            <g key={i} transform={`translate(${toX(i)}, ${toY(p.height_ft)})`}>
              <circle r="3" fill={p.tide_type === 'H' ? '#38bdf8' : '#cbd5e1'} />
              <text 
                y={p.tide_type === 'H' ? -8 : 14} 
                fill={p.tide_type === 'H' ? '#38bdf8' : '#cbd5e1'} 
                fontSize="9" 
                fontWeight="700" 
                textAnchor="middle"
              >
                {p.tide_type === 'H' ? '▲' : '▼'}{p.height_ft.toFixed(1)}ft
              </text>
            </g>
          ) : null)}
        </svg>
      </div>

      <div className="wx-tide-cards-row">
        {upcoming.slice(0, 4).map((p, i) => (
          <div key={i} className={`wx-tide-card ${p.tide_type === 'H' ? 'hi' : 'lo'}`}>
            <div className="wx-tc-type">
              {p.tide_type === 'H' ? <><IconArrowUp /> HIGH TIDE</> : <><IconArrowDown /> LOW TIDE</>}
            </div>
            <div className="wx-tc-time">{new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="wx-tc-height">{p.height_ft.toFixed(1)} ft</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Box 6: Sky and Fish Panel */
const SkyAndFishBox = ({ sunMoon }) => {
  const fish = solunarScore();
  const now = new Date();
  const nowH = now.getHours() + now.getMinutes() / 60;

  const parseTimeToDec = (timeStr) => {
    if (!timeStr) return 12;
    const [t, period] = timeStr.split(' ');
    let [h, m] = t.split(':').map(Number);
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h + m / 60;
  };

  const srH = parseTimeToDec(sunMoon?.sunrise) || 6.07;
  const ssH = parseTimeToDec(sunMoon?.sunset) || 19.23;

  const moonriseH = fish.minor[0] != null ? fish.minor[0] : 23.68; 
  const moonsetH  = fish.minor[1] != null ? fish.minor[1] : 10.50;

  // ── Balanced Sun Arc Math ──
  const isSunDay = nowH >= srH && nowH <= ssH;
  const sunProgress = isSunDay ? (nowH - srH) / (ssH - srH) : (nowH > ssH ? 1 : 0);
  const sunX = 35 + ((isSunDay ? (srH + sunProgress * (ssH - srH)) : (nowH > ssH ? ssH : srH)) / 24) * 230;
  const sunY = isSunDay ? 64 - Math.sin(sunProgress * Math.PI) * 42 : 68;

  const xSunRise = 35 + (srH / 24) * 230;
  const xSunSet  = 35 + (ssH / 24) * 230;

  const dSunTravelled = isSunDay
    ? `M ${xSunRise.toFixed(1)} 65 Q ${(xSunRise + sunX)/2} ${65 - (65 - sunY)} ${sunX.toFixed(1)} ${sunY.toFixed(1)}`
    : `M ${xSunRise.toFixed(1)} 65 Q ${(xSunRise + xSunSet)/2} 22 ${xSunSet.toFixed(1)} 65`;

  const dSunRemaining = isSunDay
    ? `M ${sunX.toFixed(1)} ${sunY.toFixed(1)} Q ${(sunX + xSunSet)/2} ${sunY} ${xSunSet.toFixed(1)} 65`
    : `M ${xSunSet.toFixed(1)} 65 L ${xSunSet.toFixed(1)} 65`;

  // ── Balanced Moon Arc Math ──
  const xAMStart = 35;
  const xAMSet   = 35 + (moonsetH / 24) * 230;
  const dMoonMorning = `M ${xAMStart} 38 Q ${(xAMStart + xAMSet)/2} 42 ${xAMSet.toFixed(1)} 65`;

  const xPMRise = 35 + (moonriseH / 24) * 230;
  const xPMEnd  = 265;

  const isMoonRisen = nowH >= moonriseH;
  let dMoonEveningTravelled = "";
  let dMoonEveningRemaining = "";
  let currentMoonX = 35 + (nowH / 24) * 230;
  let currentMoonY = 65;

  if (!isMoonRisen) {
    dMoonEveningRemaining = `M ${xPMRise.toFixed(1)} 65 Q ${(xPMRise + xPMEnd)/2} 55 ${xPMEnd} 38`;
    currentMoonX = xPMRise;
    currentMoonY = 65;
  } else {
    const pEv = (nowH - moonriseH) / (24 - moonriseH);
    currentMoonX = xPMRise + pEv * (xPMEnd - xPMRise);
    currentMoonY = 65 - Math.sin(pEv * Math.PI / 2) * 27;
    dMoonEveningTravelled = `M ${xPMRise.toFixed(1)} 65 Q ${(xPMRise + currentMoonX)/2} ${(65 + currentMoonY)/2} ${currentMoonX.toFixed(1)} ${currentMoonY.toFixed(1)}`;
    dMoonEveningRemaining = `M ${currentMoonX.toFixed(1)} ${currentMoonY.toFixed(1)} Q ${(currentMoonX + xPMEnd)/2} 42 ${xPMEnd} 38`;
  }

  const illum = sunMoon?.moonIllum != null ? sunMoon.moonIllum : 75;
  const isWaning = sunMoon?.isWaning ?? true;
  const sliderPercent = 100 - illum; 

  const ratingColor = {
    Excellent: '#22c55e',
    Good:      '#84cc16',
    Fair:      '#eab308',
    Poor:      '#94a3b8',
  }[fish.rating] || '#94a3b8';

  return (
    <div className="wx-panel wx-box-sky-fish" data-section="sky-fish">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconFish /> Sky and Fish</h2>
        <span className="wx-badge-solunar">
          {sunMoon?.moonPhaseLabel?.toUpperCase()} • {illum}% ILLUM
        </span>
      </div>

      <div className="wx-sky-fish-grid">
        <div className="wx-sub-card wx-solar-arc-subcard">
          <div className="wx-arc-header-lbl">24-HOUR SOLAR &amp; LUNAR TRAVERSE</div>

          <div className="wx-solar-arc-wrapper">
            <svg viewBox="0 0 300 92" className="wx-solar-arc-svg">
              <line x1="15" y1="65" x2="285" y2="65" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="1.5" />

              <path d={dSunTravelled} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" />
              {dSunRemaining && <path d={dSunRemaining} fill="none" stroke="rgba(245, 158, 11, 0.35)" strokeWidth="2" strokeDasharray="4 4" />}

              <path d={dMoonMorning} fill="none" stroke="rgba(56, 189, 248, 0.65)" strokeWidth="2" strokeLinecap="round" />
              {dMoonEveningTravelled && <path d={dMoonEveningTravelled} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />}
              {dMoonEveningRemaining && <path d={dMoonEveningRemaining} fill="none" stroke="rgba(56, 189, 248, 0.85)" strokeWidth="2" strokeDasharray="3 3" />}

              <text x={xSunRise} y="82" fill="#f59e0b" fontSize="8.5" fontWeight="800" textAnchor="middle">
                ☀️ Rise {sunMoon?.sunrise || '6:04 AM'}
              </text>
              <text x={xSunSet} y="82" fill="#f97316" fontSize="8.5" fontWeight="800" textAnchor="middle">
                ☀️ Set {sunMoon?.sunset || '7:14 PM'}
              </text>

              <text x={xPMRise} y="78" fill="#38bdf8" fontSize="8" fontWeight="800" textAnchor="middle">
                🌙 Rise {fmtHour(moonriseH)}
              </text>

              <g transform={`translate(${sunX}, ${sunY})`}>
                <circle r="6.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />
                <circle r="11" fill="rgba(245, 158, 11, 0.25)" />
              </g>

              <g transform={`translate(${currentMoonX}, ${currentMoonY})`}>
                <circle r="5" fill="#cbd5e1" stroke="#38bdf8" strokeWidth="1.5" />
              </g>

              <text x={sunX} y={sunY - 14} fill="#ffffff" fontSize="9.5" fontWeight="900" textAnchor="middle">
                NOW {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </text>
            </svg>
          </div>

          <div className="wx-moon-slider-box">
            <div className="wx-ms-row-labels">
              <span className="wx-ms-lbl-left">🌕 FULL (100%)</span>
              <span className="wx-ms-trend-arrow">
                {isWaning ? 'GETTING DARKER (WANING ➔)' : '➔ GETTING BRIGHTER (WAXING)'}
              </span>
              <span className="wx-ms-lbl-right">🌑 DARK (0%)</span>
            </div>
            <div className="wx-ms-track">
              <div className="wx-ms-fill" style={{ width: `${sliderPercent}%` }} />
              <div className="wx-ms-thumb" style={{ left: `${sliderPercent}%` }}>
                <span className="wx-ms-thumb-val">{illum}%</span>
              </div>
            </div>
          </div>
        </div>

        <div className="wx-sub-card wx-solunar-fish-subcard">
          <div className="wx-fish-rating-row">
            <div className="wx-fish-stars">
              {[1,2,3,4].map(s => (
                <span key={s} style={{ opacity: s <= fish.stars ? 1 : 0.2, color: '#f59e0b' }}>★</span>
              ))}
            </div>
            <div className="wx-fish-rating-title" style={{ color: ratingColor }}>
              {fish.rating}
            </div>
          </div>

          <div className="wx-fish-periods-grid">
            <div className="wx-period-box">
              <div className="wx-period-hdr">MAJOR PERIODS (2HR)</div>
              {fish.major.map((h, i) => (
                <div key={i} className="wx-period-row">
                  <span className="wx-period-icon"><IconMoon /></span>
                  <span className="wx-period-time">{fmtHour(h)}</span>
                  <span className="wx-period-desc">{i === 0 ? 'Overhead' : 'Underfoot'}</span>
                </div>
              ))}
            </div>

            <div className="wx-period-box">
              <div className="wx-period-hdr">MINOR PERIODS (1HR)</div>
              {fish.minor.map((h, i) => (
                <div key={i} className="wx-period-row">
                  <span className="wx-period-icon"><IconFish /></span>
                  <span className="wx-period-time">{fmtHour(h)}</span>
                  <span className="wx-period-desc">{i === 0 ? 'Moonrise' : 'Moonset'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Root Dynamic Layout-Intelligent Weather View Component
// ─────────────────────────────────────────────────────────────────────────────
const CurrentWeatherView = React.memo(({ config }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  const [gridMode, setGridMode] = useState('2col');
  const rootRef = useRef(null);

  const refreshMs = (config?.refreshIntervalSeconds || 300) * 1000;
  const HOME_LAT = 21.2861516;
  const HOME_LON = -157.7935187;

  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;

        const aspect = width / height;

        let newGridMode = aspect < 1.25 ? '2col' : '3col';

        setGridMode(newGridMode);

        const refW = newGridMode === '2col' ? 960 : 1250;
        const refH = newGridMode === '2col' ? 980 : 560;

        const scaleW = width / refW;
        const scaleH = height / refH;
        const scale = Math.min(Math.max(Math.min(scaleW, scaleH), 0.65), 2.5);

        if (rootRef.current) {
          rootRef.current.style.setProperty('--wx-scale', scale.toFixed(3));
          rootRef.current.style.setProperty('--wx-width', `${width}px`);
          rootRef.current.style.setProperty('--wx-height', `${height}px`);
        }
      }
    });
    ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/proxy/dashboard-api/api/weather/conditions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastFetch(new Date());
      setError(null);
    } catch (err) {
      console.error('[CurrentWeatherView] fetch failed:', err);
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, refreshMs);
    return () => clearInterval(t);
  }, [fetchData, refreshMs]);

  const sunMoon = getSunMoon(HOME_LAT, HOME_LON);

  return (
    <div className={`wx-root wx-mode-${gridMode}`} data-view="current-weather" ref={rootRef}>
      {error && <div className="wx-error-banner">⚠️ Weather Data Update Delayed: {error}</div>}

      {gridMode === '2col' ? (
        <div className="wx-dashboard-grid wx-grid-layout-2col">
          <div className="wx-col">
            <TempAtmosphereBox data={data?.ecowitt} />
            <WindRainBox data={data?.ecowitt} />
            <SeaAnimationBox />
          </div>
          <div className="wx-col">
            <ForecastBox periods={data?.forecast} />
            <MarineBox predictions={data?.tides} alerts={data?.alerts} />
            <SkyAndFishBox sunMoon={sunMoon} />
          </div>
        </div>
      ) : (
        <div className="wx-dashboard-grid wx-grid-layout-3col">
          <TempAtmosphereBox data={data?.ecowitt} />
          <WindRainBox data={data?.ecowitt} />
          <SeaAnimationBox />
          <ForecastBox periods={data?.forecast} />
          <MarineBox predictions={data?.tides} alerts={data?.alerts} />
          <SkyAndFishBox sunMoon={sunMoon} />
        </div>
      )}

      {lastFetch && (
        <div className="wx-dashboard-footer">
          <span>Pukalani Weather Command</span>
          <span>•</span>
          <span>Last Updated: {lastFetch.toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
});

export default CurrentWeatherView;
