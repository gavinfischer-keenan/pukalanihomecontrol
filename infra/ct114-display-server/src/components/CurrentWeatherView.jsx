import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * CurrentWeatherView — 2 Column Layout Scalable Hawaii Weather Dashboard.
 * 
 * Includes "Marine" Box with:
 *  - Small Craft Advisory status (Green "No Small Craft Advisory" or RED BOLD ALL CAPS "SMALL CRAFT ADVISORY")
 *  - High Surf Advisory status (Green "No High Surf Advisory" or RED BOLD ALL CAPS "HIGH SURF ADVISORY")
 *  - Special Notification box for other Oahu South Coast marine alerts (e.g., HURRICANE ADVISORY, GALE WARNING)
 *  - Honolulu Tide Chart (36-hr SVG curve, High/Low peak markers, next event cards)
 */

// ── Inline SVG Icons (Cross-Platform / Font-Independent) ───────────────────
const IconThermometer = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>
  </svg>
);

const IconWind = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>
  </svg>
);

const IconDroplet = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
  </svg>
);

const IconCalendar = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const IconWave = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  </svg>
);

const IconFish = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#34d399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6.5 12c.94-2.07 2.96-3.5 5.3-3.5 3.5 0 6.5 2.5 8.2 3.5-1.7 1-4.7 3.5-8.2 3.5-2.34 0-4.36-1.43-5.3-3.5zm0 0L2 8.5v7l4.5-3.5z"/>
    <circle cx="14" cy="11" r="1" fill="#34d399"/>
  </svg>
);

const IconSun = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
);

const IconMoon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#cbd5e1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const IconArrowUp = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5m-7 7l7-7 7 7"/>
  </svg>
);

const IconArrowDown = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14m7-7l-7 7-7-7"/>
  </svg>
);

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

  const transitHour = (12 + (age * 24.84 / 24)) % 24;  // moon overhead
  const antiHour    = (transitHour + 12) % 24;          // moon underfoot
  const riseHour    = (transitHour - 6 + 24) % 24;      // moonrise
  const setHour     = (transitHour + 6) % 24;           // moonset

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
  const phase   = moonAge / LUNAR_CYCLE;
  const moonPhaseLabel = (() => {
    if (phase < 0.03 || phase > 0.97) return 'New Moon';
    if (phase < 0.22) return 'Waxing Crescent';
    if (phase < 0.28) return 'First Quarter';
    if (phase < 0.47) return 'Waxing Gibbous';
    if (phase < 0.53) return 'Full Moon';
    if (phase < 0.72) return 'Waning Gibbous';
    if (phase < 0.78) return 'Last Quarter';
    return 'Waning Crescent';
  })();

  return {
    sunrise, sunset,
    moonPhaseLabel,
    moonIllum: Math.round((1 - Math.abs(2 * phase - 1)) * 100),
    moonAge:   Math.round(moonAge * 10) / 10,
  };
}

// ── Humidity Comfort Scale ────────────────────────────────────────────────
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

/** Wind Compass Rose Gauge */
const WindCompass = ({ dir = 0, speed = 0, gust = 0 }) => {
  const cardinal = getCardinal(dir);
  return (
    <div className="wx-wind-gauge">
      <svg viewBox="0 0 120 120" className="wx-compass-svg">
        <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(56, 189, 248, 0.25)" strokeWidth="2" />
        <circle cx="60" cy="60" r="48" fill="rgba(15, 23, 42, 0.7)" />
        
        <text x="60" y="18" className="wx-compass-cardinal" textAnchor="middle">N</text>
        <text x="104" y="64" className="wx-compass-cardinal" textAnchor="middle">E</text>
        <text x="60" y="108" className="wx-compass-cardinal" textAnchor="middle">S</text>
        <text x="16" y="64" className="wx-compass-cardinal" textAnchor="middle">W</text>

        <g transform={`rotate(${dir} 60 60)`}>
          <polygon points="60,22 55,50 65,50" fill="#f59e0b" />
          <polygon points="60,98 57,70 63,70" fill="rgba(255,255,255,0.3)" />
          <line x1="60" y1="22" x2="60" y2="98" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />
        </g>

        <circle cx="60" cy="60" r="26" fill="rgba(11, 19, 41, 0.95)" stroke="rgba(245, 158, 11, 0.5)" strokeWidth="1" />
        <text x="60" y="56" className="wx-compass-speed" textAnchor="middle">{speed}</text>
        <text x="60" y="66" className="wx-compass-unit" textAnchor="middle">MPH</text>
      </svg>

      <div className="wx-wind-details">
        <div className="wx-wind-dir-text">{cardinal} ({dir}°)</div>
        {gust > 0 && <div className="wx-wind-gust">Gusts {gust} mph</div>}
      </div>
    </div>
  );
};

/** Virtual Rain Cup Gauge */
const RainCup = ({ dailyRain = 0, rainRate = 0 }) => {
  const maxRain = 2.0;
  const fillRatio = Math.min(Math.max(dailyRain / maxRain, 0), 1);
  const fillHeight = fillRatio * 74;

  return (
    <div className="wx-rain-cup-container">
      <div className="wx-rain-cup">
        <div className="wx-cup-glass">
          <div className="wx-cup-ticks">
            <span className="wx-tick" style={{ bottom: '75%' }}>2.0"</span>
            <span className="wx-tick" style={{ bottom: '50%' }}>1.0"</span>
            <span className="wx-tick" style={{ bottom: '25%' }}>0.5"</span>
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

/** Humidity Comfort Gauge */
const HumidityGauge = ({ label, rh }) => {
  const comfort = getHumidityComfort(rh);
  return (
    <div className="wx-humidity-gauge">
      <div className="wx-hum-header">
        <span className="wx-hum-title">{label}</span>
        <span className="wx-hum-val">{rh != null ? `${rh}%` : '—'}</span>
      </div>
      <div className="wx-hum-bar-bg">
        <div 
          className="wx-hum-bar-fill" 
          style={{ width: `${comfort.percent}%`, background: comfort.color }}
        />
      </div>
      <div className="wx-hum-badge" style={{ color: comfort.color }}>
        {comfort.label}
      </div>
    </div>
  );
};

// ── 2 Column Stacked Box Panels ───────────────────────────────────────────

/** Box 1: Current Temp & Atmosphere */
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

      <div className="wx-wind-rain-flex">
        <WindCompass 
          dir={data.wind_dir} 
          speed={data.wind_spd_mph} 
          gust={data.wind_gust_mph} 
        />
        <RainCup 
          dailyRain={data.rain_daily_in || 0} 
          rainRate={data.rain_rate_in || 0} 
        />
      </div>
    </div>
  );
};

/** Box 3: Humidity & Comfort Scale */
const HumidityBox = ({ data }) => {
  if (!data) return <div className="wx-panel wx-loading">Loading humidity…</div>;

  return (
    <div className="wx-panel wx-box-humidity" data-section="humidity">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconDroplet /> Humidity &amp; Air Comfort</h2>
        <span className="wx-badge-info">ECOWITT</span>
      </div>

      <div className="wx-humidity-stack">
        <HumidityGauge label="Outdoor Air Humidity" rh={data.humidity_out} />
        <HumidityGauge label="Indoor Home Humidity" rh={data.humidity_in} />
      </div>

      <div className="wx-hum-note">
        Standard comfort index: 30%–50% Ideal • 50%–60% Pleasant • 60%–70% Humid • &gt;70% Muggy
      </div>
    </div>
  );
};

/** Box 4: 7-Day NWS Forecast */
const ForecastBox = ({ periods }) => {
  if (!periods || periods.length === 0) return <div className="wx-panel wx-loading">Loading forecast…</div>;

  return (
    <div className="wx-panel wx-box-forecast" data-section="forecast">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconCalendar /> 7-Day NWS Forecast</h2>
        <span className="wx-badge-info">NOAA</span>
      </div>
      <div className="wx-forecast-grid">
        {periods.slice(0, 7).map((p, i) => (
          <div key={i} className={`wx-fc-card ${p.isDaytime ? 'day' : 'night'}`}>
            <div className="wx-fc-day-name">{p.name}</div>
            <div className="wx-fc-icon-wrapper">
              {p.icon ? (
                <img src={p.icon} alt={p.shortForecast} className="wx-fc-img" />
              ) : (
                <span className="wx-fc-svg-icon">{p.isDaytime ? <IconSun /> : <IconMoon />}</span>
              )}
            </div>
            <div className="wx-fc-temp-pill" style={{ background: p.isDaytime ? '#f97316' : '#0284c7' }}>
              {p.temperature}°{p.temperatureUnit}
            </div>
            <div className="wx-fc-short">{p.shortForecast}</div>
            <div className="wx-fc-wind">{p.windSpeed}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Box 5: Marine (Renamed from Honolulu Tides + Small Craft/High Surf & Special Notifications) */
const MarineBox = ({ predictions, alerts = [] }) => {
  if (!predictions || predictions.length === 0) return <div className="wx-panel wx-loading">Loading marine data…</div>;

  // Filter alerts for Oahu / Honolulu / HI coastal marine
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

  // 1. Small Craft Advisory check
  const smallCraftActive = relevantAlerts.some(a => a.event.toLowerCase().includes('small craft'));

  // 2. High Surf Advisory check
  const highSurfActive = relevantAlerts.some(a => a.event.toLowerCase().includes('high surf'));

  // 3. Special Marine Notification check (other alerts like HURRICANE, GALE, TSUNAMI, etc.)
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

  const svgW = 480, svgH = 75, padY = 16, padX = 10;
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

      {/* Advisory Status Grid (Small Craft & High Surf) */}
      <div className="wx-marine-status-grid">
        {/* Small Craft Advisory Box */}
        <div className={`wx-marine-status-card ${smallCraftActive ? 'alert' : 'ok'}`}>
          <span className={`wx-status-indicator ${smallCraftActive ? 'red' : 'green'}`} />
          <span className="wx-status-text">
            {smallCraftActive ? 'SMALL CRAFT ADVISORY' : 'No Small Craft Advisory'}
          </span>
        </div>

        {/* High Surf Advisory Box */}
        <div className={`wx-marine-status-card ${highSurfActive ? 'alert' : 'ok'}`}>
          <span className={`wx-status-indicator ${highSurfActive ? 'red' : 'green'}`} />
          <span className="wx-status-text">
            {highSurfActive ? 'HIGH SURF ADVISORY' : 'No High Surf Advisory'}
          </span>
        </div>
      </div>

      {/* Special Notification Box */}
      <div className={`wx-marine-special-box ${specialText ? 'alert' : 'ok'}`}>
        <span className="wx-special-title">SPECIAL NOTIFICATION:</span>
        <span className="wx-special-body">
          {specialText ? specialText : 'No Special Marine Notifications'}
        </span>
      </div>

      {/* Tide SVG Curve */}
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

      {/* Upcoming Tide Cards */}
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

/** Box 6: Solunar Fishing & Astronomy */
const SolunarAstronomyBox = ({ sunMoon }) => {
  const fish = solunarScore();
  const ratingColor = {
    Excellent: '#22c55e',
    Good:      '#84cc16',
    Fair:      '#eab308',
    Poor:      '#94a3b8',
  }[fish.rating] || '#94a3b8';

  return (
    <div className="wx-panel wx-box-fishing" data-section="fishing">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconFish /> Solunar Fishing &amp; Astronomy</h2>
        <span className="wx-badge-solunar">MOON {fish.age.toFixed(1)}d</span>
      </div>

      <div className="wx-fish-astronomy-layout">
        <div className="wx-fish-rating-box">
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
                <span className="wx-period-desc">{i === 0 ? 'Moon overhead' : 'Moon underfoot'}</span>
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

        {sunMoon && (
          <div className="wx-sunmoon-row">
            <div className="wx-sm-item"><IconSun /> Rise: {sunMoon.sunrise}</div>
            <div className="wx-sm-item"><IconSun /> Set: {sunMoon.sunset}</div>
            <div className="wx-sm-item"><IconMoon /> {sunMoon.moonPhaseLabel} ({sunMoon.moonIllum}%)</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Root 2-Column Scalable Weather View Component
// ─────────────────────────────────────────────────────────────────────────────
const CurrentWeatherView = React.memo(({ config }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const rootRef = useRef(null);

  const refreshMs = (config?.refreshIntervalSeconds || 300) * 1000;
  const HOME_LAT = 21.2861516;
  const HOME_LON = -157.7935187;

  useEffect(() => {
    if (!rootRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        const scaleW = width / 980;
        const scaleH = height / 580;
        const scale = Math.min(Math.max(Math.min(scaleW, scaleH), 0.75), 2.5);

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
    <div className="wx-root" data-view="current-weather" ref={rootRef}>
      {error && <div className="wx-error-banner">⚠️ Weather Data Update Delayed: {error}</div>}

      <div className="wx-dashboard-2col">
        <div className="wx-col">
          <TempAtmosphereBox data={data?.ecowitt} />
          <WindRainBox data={data?.ecowitt} />
          <HumidityBox data={data?.ecowitt} />
        </div>
        <div className="wx-col">
          <ForecastBox periods={data?.forecast} />
          <MarineBox predictions={data?.tides} alerts={data?.alerts} />
          <SolunarAstronomyBox sunMoon={sunMoon} />
        </div>
      </div>

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
