import React, { useState, useEffect, useCallback } from 'react';

/**
 * CurrentWeatherView — Premium Hawaii Command Center Weather Dashboard.
 * Designed for kiosk & remote view (http://192.168.1.114:3000/#remote)
 * 
 * Features:
 *  - High-density glassmorphism layout (minimal black space)
 *  - Rotating Wind Compass Dial (bearing, speed, direction, gusts)
 *  - Virtual Rain Cup with liquid fill & graduation ticks
 *  - Indoor/Outdoor Humidity Comfort Scale (Dry / Ideal / Pleasant / Humid / Muggy)
 *  - Honolulu Tide Chart (glowing curve, peak markers, upcoming events)
 *  - Solunar Fishing Index (exact match to dashboard ForecastPanel.jsx)
 *  - 7-Day NWS Forecast with high/low badges & weather icons
 *  - Sun & Moon Status (sunrise/sunset, moon phase & age)
 */

// ── Solunar Fishing Index Math (Match ForecastPanel.jsx) ───────────────────
const LUNAR_CYCLE  = 29.53058867;
const EPOCH_NEW_JD = 2459198.177; // Jan 13 2021 ~04:14 UTC

function julianDate(d = new Date()) {
  return (d.getTime() / 86400000) + 2440587.5;
}

function getMoonAge(d = new Date()) {
  const jd  = julianDate(d);
  const age = ((jd - EPOCH_NEW_JD) % LUNAR_CYCLE + LUNAR_CYCLE) % LUNAR_CYCLE;
  return age;
}

function solunarScore(d = new Date()) {
  const age = getMoonAge(d);
  const theta = (age / LUNAR_CYCLE) * 2 * Math.PI;
  const phase = (1 + Math.cos(2 * theta)) / 2; // 0-1, peaks at new & full

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
    if (phase < 0.03 || phase > 0.97) return '🌑 New Moon';
    if (phase < 0.22) return '🌒 Waxing Crescent';
    if (phase < 0.28) return '🌓 First Quarter';
    if (phase < 0.47) return '🌔 Waxing Gibbous';
    if (phase < 0.53) return '🌕 Full Moon';
    if (phase < 0.72) return '🌖 Waning Gibbous';
    if (phase < 0.78) return '🌗 Last Quarter';
    return '🌘 Waning Crescent';
  })();

  return {
    sunrise, sunset,
    moonPhaseLabel,
    moonIllum: Math.round((1 - Math.abs(2 * phase - 1)) * 100),
    moonAge:   Math.round(moonAge * 10) / 10,
  };
}

// ── Helper: Humidity Comfort Scale ─────────────────────────────────────────
function getHumidityComfort(rh) {
  if (rh == null) return { label: '—', color: '#94a3b8', percent: 0 };
  if (rh < 30)  return { label: 'Dry 🏜️',      color: '#f59e0b', percent: Math.max(10, rh) };
  if (rh <= 50) return { label: 'Ideal 😊',    color: '#10b981', percent: rh };
  if (rh <= 60) return { label: 'Pleasant 🍃', color: '#38bdf8', percent: rh };
  if (rh <= 70) return { label: 'Humid 💧',    color: '#0284c7', percent: rh };
  return               { label: 'Muggy 💦',    color: '#a855f7', percent: Math.min(100, rh) };
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
        {/* Outer Ring & Ticks */}
        <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(56, 189, 248, 0.2)" strokeWidth="2" />
        <circle cx="60" cy="60" r="48" fill="rgba(15, 23, 42, 0.6)" />
        
        {/* Cardinal Markers */}
        <text x="60" y="18" className="wx-compass-cardinal" textAnchor="middle">N</text>
        <text x="104" y="64" className="wx-compass-cardinal" textAnchor="middle">E</text>
        <text x="60" y="108" className="wx-compass-cardinal" textAnchor="middle">S</text>
        <text x="16" y="64" className="wx-compass-cardinal" textAnchor="middle">W</text>

        {/* Rotating Needle (pointing direction wind is blowing to) */}
        <g transform={`rotate(${dir} 60 60)`}>
          <polygon points="60,22 55,50 65,50" fill="#f59e0b" />
          <polygon points="60,98 57,70 63,70" fill="rgba(255,255,255,0.3)" />
          <line x1="60" y1="22" x2="60" y2="98" stroke="#f59e0b" strokeWidth="1.5" opacity="0.6" />
        </g>

        {/* Center Readout */}
        <circle cx="60" cy="60" r="26" fill="rgba(11, 19, 41, 0.9)" stroke="rgba(245, 158, 11, 0.4)" strokeWidth="1" />
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

/** Virtual Rain Cup / Beaker Gauge */
const RainCup = ({ dailyRain = 0, rainRate = 0 }) => {
  // Scale max 2.0 inches
  const maxRain = 2.0;
  const fillRatio = Math.min(Math.max(dailyRain / maxRain, 0), 1);
  const fillHeight = fillRatio * 64; // px

  return (
    <div className="wx-rain-cup-container">
      <div className="wx-rain-cup">
        {/* Cup outline & graduation lines */}
        <div className="wx-cup-glass">
          <div className="wx-cup-ticks">
            <span className="wx-tick" style={{ bottom: '75%' }}>2.0"</span>
            <span className="wx-tick" style={{ bottom: '50%' }}>1.0"</span>
            <span className="wx-tick" style={{ bottom: '25%' }}>0.5"</span>
          </div>
          {/* Liquid fill */}
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Panels
// ─────────────────────────────────────────────────────────────────────────────

/** EcowittPanel: Local Weather Station */
const EcowittPanel = ({ data }) => {
  if (!data) return <div className="wx-panel wx-loading">Loading weather station…</div>;

  return (
    <div className="wx-panel wx-ecowitt" data-section="ecowitt">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title">🌡️ Pukalani Station (HP2564BU)</h2>
        <span className="wx-badge-live">LIVE</span>
      </div>

      <div className="wx-ecowitt-main-grid">
        {/* Left: Temp Big Readout */}
        <div className="wx-temp-card">
          <div className="wx-temp-main">{data.temp_out_f}°<span className="wx-unit">F</span></div>
          <div className="wx-temp-sub">Indoor: {data.temp_in_f}°F</div>
          <div className="wx-temp-dew">Dew Point: {data.dew_point_f}°F</div>
        </div>

        {/* Center: Wind Compass */}
        <WindCompass 
          dir={data.wind_dir} 
          speed={data.wind_spd_mph} 
          gust={data.wind_gust_mph} 
        />

        {/* Right: Virtual Rain Cup */}
        <RainCup 
          dailyRain={data.rain_daily_in || 0} 
          rainRate={data.rain_rate_in || 0} 
        />
      </div>

      {/* Bottom: Humidity Comfort Scales & Secondary Stats */}
      <div className="wx-ecowitt-footer-grid">
        <HumidityGauge label="Outdoor Humidity" rh={data.humidity_out} />
        <HumidityGauge label="Indoor Humidity" rh={data.humidity_in} />

        <div className="wx-stat-mini">
          <span className="wx-mini-lbl">Pressure</span>
          <span className="wx-mini-val">{data.baro_rel_inhg}" Hg</span>
        </div>
        <div className="wx-stat-mini">
          <span className="wx-mini-lbl">UV Index</span>
          <span className="wx-mini-val">{data.uv_index}</span>
        </div>
        <div className="wx-stat-mini">
          <span className="wx-mini-lbl">Solar Rad</span>
          <span className="wx-mini-val">{data.solar_rad} W/m²</span>
        </div>
      </div>
    </div>
  );
};

/** ForecastPanel: 7-Day NWS Forecast */
const ForecastPanel = ({ periods }) => {
  if (!periods || periods.length === 0) return <div className="wx-panel wx-loading">Loading forecast…</div>;

  return (
    <div className="wx-panel wx-forecast" data-section="forecast">
      <h2 className="wx-panel-title">📅 7-Day NWS Forecast</h2>
      <div className="wx-forecast-grid">
        {periods.slice(0, 7).map((p, i) => (
          <div key={i} className={`wx-fc-card ${p.isDaytime ? 'day' : 'night'}`}>
            <div className="wx-fc-day-name">{p.name}</div>
            <div className="wx-fc-icon-wrapper">
              {p.icon ? (
                <img src={p.icon} alt={p.shortForecast} className="wx-fc-img" />
              ) : (
                <span className="wx-fc-emoji">{p.isDaytime ? '☀️' : '🌙'}</span>
              )}
            </div>
            <div className="wx-fc-temp-pill" style={{ background: p.isDaytime ? '#f97316' : '#0284c7' }}>
              {p.temperature}°{p.temperatureUnit}
            </div>
            <div className="wx-fc-short">{p.shortForecast}</div>
            <div className="wx-fc-wind">💨 {p.windSpeed}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** TidePanel: High/Low Honolulu Tides */
const TidePanel = ({ predictions }) => {
  if (!predictions || predictions.length === 0) return <div className="wx-panel wx-loading">Loading tides…</div>;

  const now = new Date();
  const upcoming = predictions.filter(p => new Date(p.t) >= now && p.tide_type);
  const pts = predictions.slice(0, 36);

  const maxH = Math.max(...pts.map(p => p.height_ft));
  const minH = Math.min(...pts.map(p => p.height_ft));
  const range = (maxH - minH) || 1;

  const svgW = 480, svgH = 80, padY = 16, padX = 10;
  const toX = (i) => padX + (i / (pts.length - 1)) * (svgW - 2 * padX);
  const toY = (h) => padY + (1 - (h - minH) / range) * (svgH - 2 * padY);

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.height_ft).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L ${svgW - padX} ${svgH} L ${padX} ${svgH} Z`;

  const nowIdx = Math.min(Math.floor((now - new Date(pts[0].t)) / 3600000), pts.length - 1);
  const nowX = toX(Math.max(0, nowIdx));
  const nowY = toY(pts[Math.max(0, nowIdx)]?.height_ft || 0);

  return (
    <div className="wx-panel wx-tides" data-section="tides">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title">🌊 Honolulu Tides (Next 36 Hours)</h2>
        <span className="wx-badge-info">Station 1612340</span>
      </div>

      <div className="wx-tide-chart-wrapper">
        <svg viewBox={`0 0 ${svgW} ${svgH}`} className="wx-tide-svg">
          <defs>
            <linearGradient id="tideGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* Area under curve */}
          <path d={areaD} fill="url(#tideGrad)" />
          {/* Curve */}
          <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />

          {/* Current Time Indicator Line */}
          <line x1={nowX} y1="0" x2={nowX} y2={svgH} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx={nowX} cy={nowY} r="4.5" fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />

          {/* High / Low Tide Markers */}
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

      {/* High / Low Event Cards */}
      <div className="wx-tide-cards-row">
        {upcoming.slice(0, 4).map((p, i) => (
          <div key={i} className={`wx-tide-card ${p.tide_type === 'H' ? 'hi' : 'lo'}`}>
            <div className="wx-tc-type">{p.tide_type === 'H' ? '🔼 HIGH TIDE' : '🔽 LOW TIDE'}</div>
            <div className="wx-tc-time">{new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="wx-tc-height">{p.height_ft.toFixed(1)} ft</div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** FishingPanel: Solunar Fishing Index (Exact match to Dashboard ForecastPanel.jsx) */
const FishingPanel = () => {
  const fish = solunarScore();
  const ratingColor = {
    Excellent: '#22c55e',
    Good:      '#84cc16',
    Fair:      '#eab308',
    Poor:      '#94a3b8',
  }[fish.rating] || '#94a3b8';

  return (
    <div className="wx-panel wx-fishing" data-section="fishing">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title">🎣 Solunar Fishing Index</h2>
        <span className="wx-badge-solunar">MOON AGE {fish.age.toFixed(1)}d</span>
      </div>

      <div className="wx-fish-main">
        {/* Rating Header */}
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

        {/* Major & Minor Periods */}
        <div className="wx-fish-periods-grid">
          <div className="wx-period-box">
            <div className="wx-period-hdr">MAJOR PERIODS (2HR WINDOWS)</div>
            {fish.major.map((h, i) => (
              <div key={i} className="wx-period-row">
                <span className="wx-period-icon">🌙</span>
                <span className="wx-period-time">{fmtHour(h)}</span>
                <span className="wx-period-desc">{i === 0 ? 'Moon overhead' : 'Moon underfoot'}</span>
              </div>
            ))}
          </div>

          <div className="wx-period-box">
            <div className="wx-period-hdr">MINOR PERIODS (1HR WINDOWS)</div>
            {fish.minor.map((h, i) => (
              <div key={i} className="wx-period-row">
                <span className="wx-period-icon">🎣</span>
                <span className="wx-period-time">{fmtHour(h)}</span>
                <span className="wx-period-desc">{i === 0 ? 'Moonrise' : 'Moonset'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="wx-fish-theory">
        Solunar theory: fish feeding peaks near major periods, especially during new &amp; full moon phases.
      </div>
    </div>
  );
};

/** SunMoonPanel: Sun & Moon Astronomy */
const SunMoonPanel = ({ sunMoon }) => {
  if (!sunMoon) return null;
  return (
    <div className="wx-panel wx-sunmoon" data-section="sunmoon">
      <h2 className="wx-panel-title">☀️ Sun &amp; Moon Status</h2>
      <div className="wx-sunmoon-grid">
        <div className="wx-sm-card">
          <span className="wx-sm-icon">🌅</span>
          <div>
            <div className="wx-sm-lbl">Sunrise</div>
            <div className="wx-sm-val">{sunMoon.sunrise || '—'}</div>
          </div>
        </div>
        <div className="wx-sm-card">
          <span className="wx-sm-icon">🌇</span>
          <div>
            <div className="wx-sm-lbl">Sunset</div>
            <div className="wx-sm-val">{sunMoon.sunset || '—'}</div>
          </div>
        </div>
        <div className="wx-sm-card wx-sm-wide">
          <span className="wx-sm-icon">🌖</span>
          <div>
            <div className="wx-sm-lbl">Moon Phase</div>
            <div className="wx-sm-val">{sunMoon.moonPhaseLabel} ({sunMoon.moonIllum}% Illum)</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Root Weather View Component
// ─────────────────────────────────────────────────────────────────────────────
const CurrentWeatherView = React.memo(({ config }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const refreshMs = (config?.refreshIntervalSeconds || 300) * 1000;

  const HOME_LAT = 21.2861516;
  const HOME_LON = -157.7935187;

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
    <div className="wx-root" data-view="current-weather">
      {error && <div className="wx-error-banner">⚠️ Weather Data Update Delayed: {error}</div>}

      <div className="wx-dashboard-grid">
        <EcowittPanel data={data?.ecowitt} />
        <ForecastPanel periods={data?.forecast} />
        <TidePanel predictions={data?.tides} />
        <FishingPanel />
        <SunMoonPanel sunMoon={sunMoon} />
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
