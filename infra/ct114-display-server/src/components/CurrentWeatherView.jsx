import React, { useState, useEffect, useCallback } from 'react';

/**
 * CurrentWeatherView — Live weather dashboard for kiosk displays.
 *
 * Data sources (all via /proxy/dashboard-api):
 *   - Ecowitt station:  /api/weather/conditions → .ecowitt
 *   - 7-day forecast:   /api/weather/conditions → .forecast
 *   - NOAA tides (Honolulu): /api/weather/conditions → .tides
 *   - FADs (fishing):   /api/weather/conditions → .fads
 *   - Sun/Moon:         computed client-side via suncalc-style math (no external dep)
 *
 * Architecture:
 *   - All data fetched from ONE aggregated endpoint for simplicity
 *   - Each section is a separate sub-component — easy to swap/style individually
 *   - Refresh rate: 5min for ecowitt, 30min for forecast/tides/fads
 *   - Layout: CSS grid, configurable via props — UI agents can restyle freely
 *
 * Props:
 *   config.refreshIntervalSeconds — how often to refresh (default 300)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sun/Moon Calculator — pure math, no external dependency
// Adapted from USNO algorithms. Good enough for display purposes (±1 min).
// ─────────────────────────────────────────────────────────────────────────────
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

  // Hour angle for sunrise/sunset (solar elevation = -0.833°)
  const cosH = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDec) /
    (Math.cos(lat * rad) * Math.cos(dec));

  let sunrise = null, sunset = null;
  if (Math.abs(cosH) <= 1) {
    const H = Math.acos(cosH) / rad;
    const UT = 12 - lon / 15;
    const EqT = (-1.915 * Math.sin(g) - 0.02 * Math.sin(2 * g) + 2.466 * Math.sin(2 * lambda) - 0.053 * Math.sin(4 * lambda)) / 15;
    sunrise = UT - H / 15 + EqT;
    sunset = UT + H / 15 + EqT;
    const toTime = (h) => {
      const local = ((h % 24) + 24) % 24;
      const hr = Math.floor(local);
      const mn = Math.floor((local - hr) * 60);
      const ampm = hr >= 12 ? 'PM' : 'AM';
      return `${hr % 12 || 12}:${String(mn).padStart(2, '0')} ${ampm}`;
    };
    sunrise = toTime(sunrise);
    sunset = toTime(sunset);
  }

  // Moon phase (0=new, 0.5=full)
  const moonAge = ((n % 29.53) + 29.53) % 29.53;
  const phase = moonAge / 29.53;
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
  const moonIllum = Math.round((1 - Math.abs(2 * phase - 1)) * 100);

  return { sunrise, sunset, moonPhaseLabel, moonIllum, moonAge: Math.round(moonAge) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components — each is a pure display block, easily restyled
// ─────────────────────────────────────────────────────────────────────────────

/** EcowittPanel: Current conditions from local weather station */
const EcowittPanel = ({ data }) => {
  if (!data) return <div className="wx-panel wx-loading">Loading station data…</div>;
  const windDir = (deg) => {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  };
  return (
    <div className="wx-panel wx-ecowitt" data-section="ecowitt">
      <h2 className="wx-panel-title">🌡️ Pukalani Station</h2>
      <div className="wx-grid-2">
        <div className="wx-stat"><span className="wx-label">Outdoor Temp</span><span className="wx-value">{data.temp_out_f}°F</span></div>
        <div className="wx-stat"><span className="wx-label">Indoor Temp</span><span className="wx-value">{data.temp_in_f}°F</span></div>
        <div className="wx-stat"><span className="wx-label">Humidity</span><span className="wx-value">{data.humidity_out}%</span></div>
        <div className="wx-stat"><span className="wx-label">Dew Point</span><span className="wx-value">{data.dew_point_f}°F</span></div>
        <div className="wx-stat"><span className="wx-label">Wind</span><span className="wx-value">{data.wind_spd_mph} mph {windDir(data.wind_dir)}</span></div>
        <div className="wx-stat"><span className="wx-label">Gusts</span><span className="wx-value">{data.wind_gust_mph} mph</span></div>
        <div className="wx-stat"><span className="wx-label">Pressure</span><span className="wx-value">{data.baro_rel_inhg}" Hg</span></div>
        <div className="wx-stat"><span className="wx-label">Rain Today</span><span className="wx-value">{data.rain_daily_in}"</span></div>
        <div className="wx-stat"><span className="wx-label">UV Index</span><span className="wx-value">{data.uv_index}</span></div>
        <div className="wx-stat"><span className="wx-label">Solar</span><span className="wx-value">{data.solar_rad} W/m²</span></div>
      </div>
      <div className="wx-updated">Updated: {data.obs_time ? new Date(data.obs_time).toLocaleTimeString() : '—'}</div>
    </div>
  );
};

/** ForecastPanel: 7-day NWS forecast */
const ForecastPanel = ({ periods }) => {
  if (!periods || periods.length === 0) return <div className="wx-panel wx-loading">Loading forecast…</div>;
  return (
    <div className="wx-panel wx-forecast" data-section="forecast">
      <h2 className="wx-panel-title">📅 7-Day Forecast</h2>
      <div className="wx-forecast-list">
        {periods.slice(0, 8).map((p, i) => (
          <div key={i} className={`wx-forecast-row ${p.isDaytime ? 'daytime' : 'nighttime'}`}>
            <span className="wx-fc-name">{p.name}</span>
            <span className="wx-fc-temp">{p.temperature}°{p.temperatureUnit}</span>
            <span className="wx-fc-wind">{p.windSpeed} {p.windDirection}</span>
            <span className="wx-fc-desc">{p.shortForecast}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** TidePanel: Tide chart — 48hr sparkline + next hi/lo events */
const TidePanel = ({ predictions }) => {
  if (!predictions || predictions.length === 0) return <div className="wx-panel wx-loading">Loading tides…</div>;

  const now = new Date();
  const upcoming = predictions.filter(p => new Date(p.t) >= now && p.tide_type);
  const maxH = Math.max(...predictions.map(p => p.height_ft));
  const minH = Math.min(...predictions.map(p => p.height_ft));
  const range = maxH - minH || 1;

  // SVG sparkline of next 48 hours
  const pts = predictions.slice(0, 48);
  const svgW = 400, svgH = 60, pad = 4;
  const toX = (i) => pad + (i / (pts.length - 1)) * (svgW - 2 * pad);
  const toY = (h) => pad + (1 - (h - minH) / range) * (svgH - 2 * pad);
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.height_ft).toFixed(1)}`).join(' ');
  // Current position marker
  const nowIdx = Math.min(Math.floor((now - new Date(pts[0].t)) / 3600000), pts.length - 1);
  const nowX = toX(Math.max(0, nowIdx));
  const nowY = toY(pts[Math.max(0, nowIdx)]?.height_ft || 0);

  return (
    <div className="wx-panel wx-tides" data-section="tides">
      <h2 className="wx-panel-title">🌊 Honolulu Tides — 48hr</h2>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="wx-tide-chart" aria-label="Tide chart">
        <path d={pathD} fill="none" stroke="#38bdf8" strokeWidth="2" />
        <circle cx={nowX} cy={nowY} r="4" fill="#f59e0b" />
        {/* Hi/Lo labels */}
        {pts.map((p, i) => p.tide_type ? (
          <text key={i} x={toX(i)} y={p.tide_type === 'H' ? toY(p.height_ft) - 6 : toY(p.height_ft) + 12}
            fill={p.tide_type === 'H' ? '#38bdf8' : '#94a3b8'} fontSize="8" textAnchor="middle">
            {p.tide_type === 'H' ? '▲' : '▼'}{p.height_ft.toFixed(1)}
          </text>
        ) : null)}
      </svg>
      <div className="wx-tide-events">
        {upcoming.slice(0, 6).map((p, i) => (
          <div key={i} className={`wx-tide-event ${p.tide_type === 'H' ? 'high' : 'low'}`}>
            <span>{p.tide_type === 'H' ? '🔼 High' : '🔽 Low'}</span>
            <span>{new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span>{p.height_ft.toFixed(1)} ft</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** SunMoonPanel: Sunrise/sunset and moon phase */
const SunMoonPanel = ({ sunMoon }) => {
  if (!sunMoon) return <div className="wx-panel wx-loading">…</div>;
  return (
    <div className="wx-panel wx-sunmoon" data-section="sunmoon">
      <h2 className="wx-panel-title">☀️ Sun / Moon</h2>
      <div className="wx-grid-2">
        <div className="wx-stat"><span className="wx-label">Sunrise</span><span className="wx-value">🌅 {sunMoon.sunrise || '—'}</span></div>
        <div className="wx-stat"><span className="wx-label">Sunset</span><span className="wx-value">🌇 {sunMoon.sunset || '—'}</span></div>
        <div className="wx-stat wx-wide"><span className="wx-label">Moon</span><span className="wx-value">{sunMoon.moonPhaseLabel}</span></div>
        <div className="wx-stat"><span className="wx-label">Illumination</span><span className="wx-value">{sunMoon.moonIllum}%</span></div>
        <div className="wx-stat"><span className="wx-label">Moon Age</span><span className="wx-value">{sunMoon.moonAge} days</span></div>
      </div>
    </div>
  );
};

/** FishingPanel: FAD locations near Oahu */
const FishingPanel = ({ fads }) => {
  const oahuFads = (fads || []).filter(f => f.properties?.island === 'Oahu');
  return (
    <div className="wx-panel wx-fishing" data-section="fishing">
      <h2 className="wx-panel-title">🎣 Fishing Index — Oahu FADs</h2>
      {oahuFads.length === 0 ? (
        <div className="wx-loading">No FAD data</div>
      ) : (
        <div className="wx-fad-list">
          {oahuFads.map((f, i) => (
            <div key={i} className="wx-fad-row">
              <span className="wx-fad-name">{f.properties.name}</span>
              <span className="wx-fad-depth">{f.properties.depth_m}m depth</span>
              <span className="wx-fad-species">{f.properties.description?.split('—')[1]?.trim() || ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
const CurrentWeatherView = React.memo(({ config }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const refreshMs = (config?.refreshIntervalSeconds || 300) * 1000;

  // Home base coordinates for sun/moon calculation
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

  // Initial fetch + interval
  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, refreshMs);
    return () => clearInterval(t);
  }, [fetchData, refreshMs]);

  // Sun/moon is computed fresh each render (pure math, no API)
  const sunMoon = getSunMoon(HOME_LAT, HOME_LON);

  const fads = data?.fads?.features || [];

  return (
    <div className="wx-root" data-view="current-weather">
      {error && <div className="wx-error">⚠️ Data fetch failed: {error}</div>}
      <div className="wx-layout">
        <EcowittPanel data={data?.ecowitt} />
        <ForecastPanel periods={data?.forecast} />
        <TidePanel predictions={data?.tides} />
        <SunMoonPanel sunMoon={sunMoon} />
        <FishingPanel fads={fads} />
      </div>
      {lastFetch && (
        <div className="wx-footer">
          Last updated: {lastFetch.toLocaleTimeString()} — Pukalani Home Command Center
        </div>
      )}
    </div>
  );
});

export default CurrentWeatherView;
