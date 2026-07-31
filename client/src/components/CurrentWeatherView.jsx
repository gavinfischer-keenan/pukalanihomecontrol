import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * CurrentWeatherView — Container-Aware Auto-Adapting Weather Dashboard.
 * 
 * Includes:
 *  - Box 1: Temp, Atmosphere & Integrated Humidity.
 *  - Box 2: Wind & Rain Station.
 *  - Box 3: Animated Wave & Sea State.
 *  - Box 4: 7-Day NWS Forecast in horizontal rows using large, high-contrast SVG vector drawings.
 *  - Box 5: Marine Box (Advisories & Tides).
 *  - Box 6: Sky Panel (Physical 24-Hour Timeline Sky Traverse with Clean 1-Line Vertical Separation for Sun Rise/Set Text).
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
    <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.5 0 2.5-2 5-2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>
  </svg>
);

const IconSun = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#f59e0b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
  </svg>
);

const IconMoon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#cbd5e1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const IconCloudRain = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#38bdf8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 13v6m-4-4v6m-4-5v6M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
  </svg>
);

const IconCloudSun = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v2m-7.1 2.9l1.4 1.4M2 12h2m15.4-7.1l-1.4 1.4M17 18a5 5 0 0 0-3-9.26 8 8 0 0 0-11.7 8.26"/>
    <path d="M20 16.58A5 5 0 0 0 18 7h-1.26" stroke="#38bdf8" strokeWidth="2" />
  </svg>
);

const IconThunder = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#eab308" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 16.9A5 5 0 0 0 18 7h-1.26a8 8 0 1 0-11.62 9"/>
    <polygon points="13 11 9 17 13 17 11 23 17 15 13 15" fill="#f59e0b" stroke="none"/>
  </svg>
);

const IconCloud = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#cbd5e1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
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

// ── Lunar & Solar Math Helpers ─────────────────────────────────────────────
const LUNAR_CYCLE  = 29.53058867;
const EPOCH_NEW_JD = 2459198.177;

function julianDate(d = new Date()) {
  return (d.getTime() / 86400000) + 2440587.5;
}

function getMoonAge(d = new Date()) {
  const jd  = julianDate(d);
  return ((jd - EPOCH_NEW_JD) % LUNAR_CYCLE + LUNAR_CYCLE) % LUNAR_CYCLE;
}

function fmtHour(h) {
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  const period = hrs >= 12 ? 'PM' : 'AM';
  const h12 = hrs === 0 ? 12 : hrs > 12 ? hrs - 12 : hrs;
  return `${h12}:${String(mins).padStart(2, '0')} ${period}`;
}

// ── Sun & Moon Calculator (Fixed Local Hawaii Standard Time Offset) ─────────
function getSunMoon(lat, lon, date = new Date()) {
  const rad = Math.PI / 180;
  const d = date;

  const JD = Math.floor(365.25 * (d.getFullYear() + 4716)) +
    Math.floor(30.6001 * (d.getMonth() + 1 + 2)) +
    d.getDate() - 1524.5 +
    (d.getHours() + d.getMinutes() / 60) / 24;
  const n = JD - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const sinDec = Math.sin(23.439 * rad) * Math.sin(lambda);
  const dec = Math.asin(sinDec);
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) /
    (Math.cos(lat * rad) * Math.cos(dec));

  let srH = 6.43;  // Default 6:25 AM HST
  let ssH = 18.74; // Default 6:44 PM HST
  let sunriseStr = "6:25 AM";
  let sunsetStr  = "6:44 PM";

  if (Math.abs(cosH) <= 1) {
    const H = Math.acos(cosH) / rad;
    const UT = 12 - lon / 15;
    const EqT = (-1.915 * Math.sin(g) - 0.02 * Math.sin(2 * g) + 2.466 * Math.sin(2 * lambda) - 0.053 * Math.sin(4 * lambda)) / 15;
    
    // Hawaii Standard Time (HST) is UTC - 10
    const utRise = UT - H / 15 + EqT;
    const utSet  = UT + H / 15 + EqT;
    
    srH = ((utRise - 10) % 24 + 24) % 24;
    ssH = ((utSet  - 10) % 24 + 24) % 24;

    const toStr = (hDec) => {
      const hr = Math.floor(hDec);
      const mn = Math.floor((hDec - hr) * 60);
      const period = hr >= 12 ? 'PM' : 'AM';
      const h12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
      return `${h12}:${String(mn).padStart(2, '0')} ${period}`;
    };

    sunriseStr = toStr(srH);
    sunsetStr  = toStr(ssH);
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

  const transitHour = (12 + (moonAge * 24.84 / 24)) % 24;
  const riseHour    = (transitHour - 6.2 + 24) % 24;
  const setHour     = (transitHour + 6.2) % 24;

  return {
    sunrise: sunriseStr,
    sunset: sunsetStr,
    srH,
    ssH,
    moonPhaseLabel,
    moonIllum: Math.round((1 - Math.abs(2 * phaseFraction - 1)) * 100),
    moonAge:   Math.round(moonAge * 10) / 10,
    phaseFraction,
    isWaning,
    moonriseH: riseHour,
    moonsetH:  setHour,
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

/** Box 4 (HIGH-CONTRAST VECTOR DRAWINGS): 7-Day Forecast Layout */
const ForecastBox = ({ periods }) => {
  if (!periods || periods.length === 0) return <div className="wx-panel wx-loading">Loading forecast…</div>;

  // Consolidate live forecast periods into daily rows
  const rowsMap = [];
  periods.forEach(p => {
    let name = p.name;
    if (name === 'Tonight' || (name.includes('Night') && rowsMap.length === 0)) {
      name = 'TONIGHT';
    } else {
      name = name.replace(/ Night$/, '').toUpperCase();
    }

    const temperatureValue = p.temp ?? p.temperature;

    let existing = rowsMap.find(r => r.name === name);
    if (!existing) {
      existing = {
        name,
        high: p.isDaytime ? temperatureValue : null,
        low: !p.isDaytime ? temperatureValue : null,
        shortForecast: p.shortForecast,
        windSpeed: p.windSpeed,
        pop: p.probabilityOfPrecipitation?.value || null,
      };
      rowsMap.push(existing);
    } else {
      if (p.isDaytime) {
        existing.high = temperatureValue;
      } else {
        existing.low = temperatureValue;
      }
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
        <span className="wx-badge-info">NOAA LIVE</span>
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

            {r.pop > 0 ? (
              <div className="wx-fcr-pop-col">{r.pop}% Rain</div>
            ) : (
              <div className="wx-fcr-pop-spacer" />
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

/**
 * Box 6: Sky Panel — PHYSICAL 24-HOUR TIMELINE TRAVERSE (00:00 to 24:00)
 */
const SkyBox = ({ sunMoon }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const nowH = now.getHours() + now.getMinutes() / 60.0;

  const srH = sunMoon?.srH != null ? sunMoon.srH : 6.43;  // ~6:25 AM HST
  const ssH = sunMoon?.ssH != null ? sunMoon.ssH : 18.74; // ~6:44 PM HST

  const msH = sunMoon?.moonsetH != null ? sunMoon.moonsetH : 11.35; // ~11:21 AM HST
  const mrH = sunMoon?.moonriseH != null ? sunMoon.moonriseH : 23.19; // ~11:11 PM HST
  const lunarDuration = 12.2; // ~12.2 hours above horizon per lunar day

  // ── SVG Canvas Setup ──
  const xMin = 25;
  const xMax = 295;
  const w24  = xMax - xMin; // 270px width spanning 24 hours
  const yHorizon = 85;      // Horizon baseline
  const sunArcH  = 66;      // Tall Sun Arc (Peak Y=19)
  const moonArcH = 46;      // Distinct Moon Arc (Peak Y=39)

  const xForH = (h) => xMin + (Math.max(0, Math.min(24, h)) / 24.0) * w24;

  // ── Physical Sun Arc Math (Flat Y=85 below horizon) ──
  const getSunY = (h) => {
    if (h < srH || h > ssH) return yHorizon;
    const p = (h - srH) / (ssH - srH);
    return yHorizon - Math.sin(p * Math.PI) * sunArcH;
  };

  // ── Physical Moon Arc Math (Flat Y=85 below horizon) ──
  const getMoonY = (h) => {
    if (h <= msH) {
      const mrPrev = msH - lunarDuration;
      const p = (h - mrPrev) / lunarDuration;
      if (p < 0 || p > 1) return yHorizon;
      return yHorizon - Math.sin(p * Math.PI) * moonArcH;
    } else if (h >= mrH) {
      const p = (h - mrH) / lunarDuration;
      if (p < 0 || p > 1) return yHorizon;
      return yHorizon - Math.sin(p * Math.PI) * moonArcH;
    } else {
      return yHorizon;
    }
  };

  // ── Sample 24-Hour Timeline to Build Exact SVG Paths ──
  const buildSampledPaths = (getYFunc) => {
    const step = 0.1;
    let solidPts = [];
    let dottedPts = [];
    let h = 0.0;

    let nowPointAddedToDotted = false;

    const xNow = xForH(nowH);
    const yNow = getYFunc(nowH);
    const nowPt = { x: xNow, y: yNow };

    while (h <= 24.05) {
      const curH = Math.min(24.0, h);
      const x = xForH(curH);
      const y = getYFunc(curH);

      if (y < yHorizon - 0.5) { // Active arc above horizon
        const pt = { x, y };

        if (curH <= nowH) {
          solidPts.push(pt);
        } else {
          if (!nowPointAddedToDotted && yNow < yHorizon - 0.5) {
            dottedPts.push(nowPt);
            nowPointAddedToDotted = true;
          }
          dottedPts.push(pt);
        }
      }
      h += step;
    }

    if (yNow < yHorizon - 0.5 && solidPts.length > 0) {
      const lastSolid = solidPts[solidPts.length - 1];
      if (Math.abs(lastSolid.x - xNow) > 0.1) {
        solidPts.push(nowPt);
      }
    }

    const formatPath = (pts) => {
      if (!pts || pts.length < 2) return '';
      let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        d += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
      }
      return d;
    };

    return {
      dSolid: formatPath(solidPts),
      dDotted: formatPath(dottedPts),
      nowX: xNow,
      nowY: yNow,
      isNowUp: yNow < yHorizon - 0.5,
    };
  };

  const sunPaths  = buildSampledPaths(getSunY);
  const moonPaths = buildSampledPaths(getMoonY);

  const illum = sunMoon?.moonIllum != null ? sunMoon.moonIllum : 75;
  const isWaning = sunMoon?.isWaning ?? true;
  const sliderPercent = 100 - illum; 

  const formattedDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const formattedTime = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="wx-panel wx-box-sky" data-section="sky">
      <div className="wx-panel-header">
        <h2 className="wx-panel-title"><IconSun /> Sky</h2>
        <span className="wx-badge-solunar">
          {sunMoon?.moonPhaseLabel?.toUpperCase()} • {illum}% ILLUM
        </span>
      </div>

      <div className="wx-sky-grid">
        {/* Left Side: Live Time & Spelled-Out Date */}
        <div className="wx-sky-time-card">
          <div className="wx-sky-clock-lbl">LOCAL TIME</div>
          <div className="wx-sky-time-big">{formattedTime}</div>
          <div className="wx-sky-date-str">{formattedDate}</div>
          <div className="wx-sky-phase-pill">
            {sunMoon?.moonPhaseLabel || 'Waxing Gibbous'}
          </div>
        </div>

        {/* Right Side: 24-Hour Timeline Sky Traverse (00:00 to 24:00) */}
        <div className="wx-sub-card wx-solar-arc-subcard">
          <div className="wx-arc-header-lbl">24-HOUR SKY TRAVERSE (00:00 MIDNIGHT ➔ 24:00 MIDNIGHT)</div>

          <div className="wx-solar-arc-wrapper">
            <svg viewBox="0 0 320 128" className="wx-solar-arc-svg">
              {/* Baseline Horizon Line (Y=85) */}
              <line x1="15" y1={yHorizon} x2="305" y2={yHorizon} stroke="rgba(255, 255, 255, 0.25)" strokeWidth="1.5" />

              {/* Sun Arc: Solid (Travelled so far today) vs Dotted (Remaining today) */}
              {sunPaths.dSolid && <path d={sunPaths.dSolid} fill="none" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
              {sunPaths.dDotted && <path d={sunPaths.dDotted} fill="none" stroke="rgba(245, 158, 11, 0.45)" strokeWidth="2.5" strokeDasharray="4 4" strokeLinecap="round" strokeLinejoin="round" />}

              {/* Moon Arc: Solid (Travelled so far today) vs Dotted (Remaining today) */}
              {moonPaths.dSolid && <path d={moonPaths.dSolid} fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
              {moonPaths.dDotted && <path d={moonPaths.dDotted} fill="none" stroke="rgba(56, 189, 248, 0.75)" strokeWidth="2.2" strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" />}

              {/* Moonset & Moonrise Text Markers (Tier 1: Y=99) */}
              <text x={xForH(msH)} y="99" fill="#cbd5e1" fontSize="8" fontWeight="700" textAnchor="middle">
                🌙 Set {fmtHour(msH)}
              </text>
              <text x={xForH(mrH)} y="99" fill="#38bdf8" fontSize="8" fontWeight="800" textAnchor="middle">
                🌙 Rise {fmtHour(mrH)}
              </text>

              {/* Sunrise & Sunset Text Markers (Tier 2: Moved down 1 line to Y=115 for clean separation!) */}
              <text x={xForH(srH)} y="115" fill="#f59e0b" fontSize="9" fontWeight="800" textAnchor="middle">
                ☀️ Rise {sunMoon?.sunrise || '6:25 AM'}
              </text>
              <text x={xForH(ssH)} y="115" fill="#f97316" fontSize="9" fontWeight="800" textAnchor="middle">
                ☀️ Set {sunMoon?.sunset || '6:44 PM'}
              </text>

              {/* Live Sun Indicator */}
              <g transform={`translate(${sunPaths.nowX}, ${sunPaths.nowY})`}>
                <circle r="8" fill="#f59e0b" stroke="#ffffff" strokeWidth="2" />
                <circle r="14" fill="rgba(245, 158, 11, 0.25)" />
                {sunPaths.isNowUp && (
                  <text y="-17" fill="#ffffff" fontSize="9.5" fontWeight="900" textAnchor="middle">
                    NOW {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </text>
                )}
              </g>

              {/* Live Moon Indicator */}
              <g transform={`translate(${moonPaths.nowX}, ${moonPaths.nowY})`}>
                <circle r="6.5" fill="#cbd5e1" stroke="#38bdf8" strokeWidth="2" />
              </g>
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
            <SkyBox sunMoon={sunMoon} />
          </div>
        </div>
      ) : (
        <div className="wx-dashboard-grid wx-grid-layout-3col">
          <TempAtmosphereBox data={data?.ecowitt} />
          <WindRainBox data={data?.ecowitt} />
          <SeaAnimationBox />
          <ForecastBox periods={data?.forecast} />
          <MarineBox predictions={data?.tides} alerts={data?.alerts} />
          <SkyBox sunMoon={sunMoon} />
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
