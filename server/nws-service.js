/**
 * NWS / NOAA Data Caching Service
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  GOOD-CITIZEN CACHING POLICY — DO NOT REMOVE OR WEAKEN         ║
 * ║                                                                  ║
 * ║  This service fetches from publicly-funded NOAA/NESDIS servers. ║
 * ║  We are a single private home monitoring system, not a CDN.     ║
 * ║  We MUST NOT hammer government servers with excessive requests.  ║
 * ║                                                                  ║
 * ║  Rules:                                                          ║
 * ║  1. NEVER poll faster than the upstream update rate.            ║
 * ║  2. ALWAYS use ETag / If-Modified-Since conditional fetches.    ║
 * ║  3. Identify ourselves with an honest User-Agent string.        ║
 * ║  4. Add random jitter (±60s) to avoid thundering-herd at exact  ║
 * ║     update boundaries (multiple users opening at same time).    ║
 * ║  5. Background schedule: 05:00, 11:00, 17:00, 23:00 HST only.  ║
 * ║     On user open: serve cached immediately + one live refresh.  ║
 * ║     Live refresh window: 3 hours post-open, then fall back to   ║
 * ║     background schedule (no sustained high-rate polling).       ║
 * ║  6. NPAC GIF from weather.gov: fetched at most every 37 min.   ║
 * ║                                                                  ║
 * ║  If this code is ever shared publicly, ensure the User-Agent    ║
 * ║  and rate limits are reviewed before deployment.                ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Update schedule reference:
 *   GOES-18 GIFs         → every 10 min  → background: 4x/day at 05/11/17/23 HST
 *                                           live-open:  every ~16 min for 3h after open
 *                           URLs: cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/HI/{band}/GOES18-HI-{band}-600x600.gif
 *                           (NESDIS changed URLs ~Jul 2026: lowercase hi → HI, removed ABI from filename)
 *   NPAC GIF             → every ~30 min → background: 4x/day; live-open: every ~37 min for 3h
 *   NWS obs KML          → every 30-60min→ fetch at :05, :35 each hour
 *   SRF/AFD/CWF/HSF      → 0415 + 1615 HST, then check 1x/hr with ETag
 *   RWR                  → 0005, 0605, 1205, 1805 HST
 *   NWS alerts           → real-time, poll every 5 min (API designed for this)
 *   PacIOOS ROMS/WW3     → daily, model run ~0600-0800 UTC → fetch at 0830 UTC
 *   MODIS SST            → daily composite → fetch at 0900 UTC
 *   CPC 6-10/8-14 day   → daily at ~1200 UTC → fetch at 1230 UTC
 *   CPC 90-day seasonal  → monthly ~15th → check daily at 1300 UTC
 *   ENSO/RONI            → monthly, 2nd Thursday → check daily at 1300 UTC
 *   FADs                 → check daily at 0900 HST
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const CACHE_DIR = '/opt/dashboard/public/nws-cache';
const LOOPS_DIR = path.join(CACHE_DIR, 'loops');
const TEXT_DIR  = path.join(CACHE_DIR, 'text');
const DATA_DIR  = path.join(CACHE_DIR, 'data');

// Ensure dirs exist
[CACHE_DIR, LOOPS_DIR, TEXT_DIR, DATA_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// Cached metadata in memory
const cache = {
  loops:   {},   // { name: { path, updatedAt, etag } }
  text:    {},   // { product: { text, updatedAt, etag } }
  enso:    null,
  fads:    null,
  alerts:  [],
  obs:     null,
};

// Jitter: add 0–60 seconds to avoid thundering herd
const jitter = () => Math.floor(Math.random() * 60000);

// Good-citizen HTTP client
const http = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': 'HawaiiCommandCenter/1.0 (private home monitoring; contact via local admin)',
    'Accept-Encoding': 'gzip, deflate',
  },
  responseType: 'arraybuffer',
});

// ── Conditional fetch (respects ETag / If-Modified-Since) ─────────────────
async function conditionalFetch(url, cacheKey, storeAs, options = {}) {
  const headers = {};
  if (cache[cacheKey]?.etag)         headers['If-None-Match']     = cache[cacheKey].etag;
  if (cache[cacheKey]?.lastModified) headers['If-Modified-Since'] = cache[cacheKey].lastModified;

  try {
    const res = await http.get(url, { headers, ...options });
    const etag = res.headers['etag'];
    const lm   = res.headers['last-modified'];

    // storeAs = file path to write binary, or null for text
    if (storeAs) {
      fs.writeFileSync(storeAs, res.data);
    }

    return {
      data:         res.data,
      etag:         etag || null,
      lastModified: lm   || null,
      updated:      true,
    };
  } catch (err) {
    if (err.response?.status === 304) {
      return { updated: false }; // Not modified — use cached version
    }
    throw err;
  }
}

// ── TEXT: fetch via string (not arraybuffer) ──────────────────────────────
async function conditionalFetchText(url, meta) {
  const headers = {};
  if (meta?.etag)         headers['If-None-Match']     = meta.etag;
  if (meta?.lastModified) headers['If-Modified-Since'] = meta.lastModified;

  const res = await axios.get(url, {
    timeout: 10000,
    headers: {
      ...headers,
      'User-Agent': 'HawaiiCommandCenter/1.0 (private home monitoring)',
    },
    validateStatus: s => s === 200 || s === 304,
  });

  if (res.status === 304) return { updated: false };

  return {
    data:         res.data,
    etag:         res.headers['etag'] || null,
    lastModified: res.headers['last-modified'] || null,
    updated:      true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LOOP GIF FETCHERS
// ═══════════════════════════════════════════════════════════════════════════

const LOOPS = [
  {
    id: 'geocolor',
    name: 'GOES-18 GeoColor Hawaii',
    icon: '🛰️',
    url: 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/HI/GEOCOLOR/GOES18-HI-GEOCOLOR-600x600.gif',
    file: 'goes18_geocolor.gif',
    intervalMs: 11 * 60 * 1000,  // 10-min updates, fetch at +1min
  },
  {
    id: 'infrared',
    name: 'GOES-18 Infrared (Band 13)',
    icon: '🌡️',
    url: 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/HI/13/GOES18-HI-13-600x600.gif',
    file: 'goes18_ir.gif',
    intervalMs: 11 * 60 * 1000,
  },
  {
    id: 'watervapor',
    name: 'GOES-18 Water Vapor (Band 8)',
    icon: '💧',
    url: 'https://cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/HI/08/GOES18-HI-08-600x600.gif',
    file: 'goes18_wv.gif',
    intervalMs: 11 * 60 * 1000,
  },
  {
    id: 'npac',
    name: 'N. Pacific Wide-Area',
    icon: '🌊',
    url: 'https://www.weather.gov/images/hfo/graphics/npac.gif',
    file: 'npac.gif',
    intervalMs: 32 * 60 * 1000,  // ~30-min updates, fetch at +2min
  },
];

async function fetchLoop(loop) {
  const filePath = path.join(LOOPS_DIR, loop.file);
  try {
    const result = await conditionalFetch(loop.url, `loop_${loop.id}`, filePath);
    if (result.updated) {
      cache.loops[loop.id] = {
        id:          loop.id,
        name:        loop.name,
        icon:        loop.icon,
        localUrl:    `/nws-cache/loops/${loop.file}`,
        updatedAt:   new Date().toISOString(),
        etag:        result.etag,
        lastModified:result.lastModified,
      };
      console.log(`[nws] loop updated: ${loop.id}`);
    }
  } catch (err) {
    console.warn(`[nws] loop fetch failed: ${loop.id} — ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SMART LOOP CACHE SCHEDULER
//
// Background schedule (good-citizen, 4x/day):
//   Fires at 05:00, 11:00, 17:00, 23:00 HST (Hawaii Standard Time = UTC-10)
//   This means UTC: 15:00, 21:00, 03:00, 09:00
//
// Live-refresh window (triggered when a user opens the Loops tab):
//   - Serve cached image immediately (never block on a fetch)
//   - Fire one immediate fetch per loop (staggered by 3s each)
//   - For the next 3 hours, poll at upstream_interval + 5 min
//     (GOES-18: 10+5=15 min, NPAC: 30+5=35 min — well within good-citizen limits)
//   - After 3 hours, stop live polling (fall back to background schedule)
//   - Multiple simultaneous users share the same live-refresh window
// ═══════════════════════════════════════════════════════════════════════════

const LIVE_REFRESH_WINDOW_MS = 3 * 60 * 60 * 1000;  // 3 hours
let   liveRefreshUntil       = 0;                      // epoch ms — 0 = not active
const liveIntervalHandles    = {};                     // { loop.id: intervalHandle }

// Convert a local HST hour to the next UTC Date occurrence
function nextHSTOccurrence(hstHour) {
  const UTC_OFFSET = 10; // HST = UTC-10 (no DST)
  const utcHour = (hstHour + UTC_OFFSET) % 24;
  const now = new Date();
  const candidate = new Date(now);
  candidate.setUTCHours(utcHour, 0, 0, 0);
  if (candidate <= now) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

// Schedule the 4x/day background fetches at 05/11/17/23 HST
function scheduleBackgroundFetches() {
  const BACKGROUND_HOURS_HST = [5, 11, 17, 23];

  function scheduleNext(hstHour) {
    const next = nextHSTOccurrence(hstHour);
    const msUntil = next.getTime() - Date.now() + Math.floor(Math.random() * 60000); // ±60s jitter
    console.log(`[nws] background loop fetch at ${hstHour}:00 HST scheduled in ${Math.round(msUntil/60000)}min`);
    setTimeout(async () => {
      console.log(`[nws] background loop fetch firing for ${hstHour}:00 HST`);
      for (let i = 0; i < LOOPS.length; i++) {
        await new Promise(r => setTimeout(r, i * 3000 + jitter())); // 3s stagger + jitter
        fetchLoop(LOOPS[i]);
      }
      scheduleNext(hstHour); // schedule next occurrence (24h from now)
    }, msUntil);
  }

  BACKGROUND_HOURS_HST.forEach(scheduleNext);
}

// Start live-refresh polling for all loops (called when user opens Loops tab)
// Multiple calls are safe — resets the window timer, reuses existing intervals.
function startLiveRefresh() {
  liveRefreshUntil = Date.now() + LIVE_REFRESH_WINDOW_MS;
  console.log(`[nws] live loop refresh window opened (3h)`);

  LOOPS.forEach((loop, i) => {
    // One immediate fetch per loop, staggered by 3s
    setTimeout(() => fetchLoop(loop), i * 3000 + Math.floor(Math.random() * 5000));

    // Set up polling interval if not already running
    if (!liveIntervalHandles[loop.id]) {
      const pollMs = loop.intervalMs + (5 * 60 * 1000); // upstream interval + 5 min lag
      liveIntervalHandles[loop.id] = setInterval(() => {
        if (Date.now() > liveRefreshUntil) {
          // Window expired — stop polling, clean up
          clearInterval(liveIntervalHandles[loop.id]);
          delete liveIntervalHandles[loop.id];
          console.log(`[nws] live refresh window closed for ${loop.id}`);
          return;
        }
        fetchLoop(loop);
      }, pollMs);
    }
  });
}

// Expose startLiveRefresh so the API route can call it
module.exports._startLiveLoopRefresh = startLiveRefresh;

function initLoopFetchers() {
  // 1. Fetch all loops immediately on startup (staggered)
  LOOPS.forEach((loop, i) => {
    setTimeout(() => fetchLoop(loop), i * 15000 + jitter());
  });

  // 2. Schedule the 4x/day background fetches
  scheduleBackgroundFetches();
}

// ═══════════════════════════════════════════════════════════════════════════
// NWS TEXT PRODUCTS  (api.weather.gov — designed for programmatic access)
// ═══════════════════════════════════════════════════════════════════════════

const TEXT_PRODUCTS = [
  { type: 'SRF', location: 'HFO', name: 'Surf Forecast',          updateHours: [4, 16] },   // 0415, 1615 HST
  { type: 'AFD', location: 'HFO', name: 'Forecast Discussion',     updateHours: [4, 16] },
  { type: 'CWF', location: 'HFO', name: 'Coastal Waters Forecast', updateHours: [4, 16] },
  { type: 'HSF', location: 'HFO', name: 'High Seas Forecast',      updateHours: [4, 16] },
  { type: 'RWR', location: 'HFO', name: 'Regional Weather Roundup',updateHours: [0, 6, 12, 18] },
];

async function fetchTextProduct(prod) {
  const url = `https://api.weather.gov/products?type=${prod.type}&location=${prod.location}`;
  const key = prod.type;
  try {
    // api.weather.gov doesn't support ETags well — check every 30min but light payload
    const res = await axios.get(url, {
      timeout: 8000,
      headers: { 'User-Agent': 'HawaiiCommandCenter/1.0', Accept: 'application/geo+json' },
    });
    const latest = res.data?.['@graph']?.[0];
    if (!latest) return;

    // Fetch the actual product text
    const textRes = await axios.get(latest['@id'], {
      timeout: 8000,
      headers: { 'User-Agent': 'HawaiiCommandCenter/1.0', Accept: 'application/geo+json' },
    });
    const productText = textRes.data?.productText || '';
    const issuanceTime = textRes.data?.issuanceTime || '';

    const prev = cache.text[key];
    if (prev?.issuanceTime === issuanceTime) return; // Not updated

    cache.text[key] = {
      type:         prod.type,
      name:         prod.name,
      text:         productText,
      issuanceTime,
      updatedAt:    new Date().toISOString(),
    };

    const filePath = path.join(TEXT_DIR, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(cache.text[key]));
    console.log(`[nws] text product updated: ${key} (issued ${issuanceTime})`);
  } catch (err) {
    console.warn(`[nws] text fetch failed: ${key} — ${err.message}`);
  }
}

function initTextFetchers() {
  TEXT_PRODUCTS.forEach((prod, i) => {
    setTimeout(() => {
      fetchTextProduct(prod);
      // Poll every 30 min — the API is designed for this, lightweight
      setInterval(() => fetchTextProduct(prod), 30 * 60 * 1000);
    }, i * 8000 + jitter());
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVE ALERTS  (real-time — api.weather.gov designed for frequent polling)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchAlerts() {
  try {
    const res = await axios.get('https://api.weather.gov/alerts/active?area=HI', {
      timeout: 8000,
      headers: { 'User-Agent': 'HawaiiCommandCenter/1.0', Accept: 'application/geo+json' },
    });
    cache.alerts = res.data?.features || [];
    const alertFile = path.join(DATA_DIR, 'alerts.json');
    fs.writeFileSync(alertFile, JSON.stringify({ features: cache.alerts, updatedAt: new Date().toISOString() }));
  } catch (err) {
    console.warn(`[nws] alerts fetch failed: ${err.message}`);
  }
}

function initAlertsFetcher() {
  setTimeout(() => {
    fetchAlerts();
    setInterval(fetchAlerts, 5 * 60 * 1000); // Every 5 min — NWS API supports this
  }, jitter());
}

// ═══════════════════════════════════════════════════════════════════════════
// OBS KML (weather.gov/hfo — updates every 30-60 min)
// Parse into GeoJSON for map use
// ═══════════════════════════════════════════════════════════════════════════

async function fetchObsKML() {
  // NWS API v2 — fetch latest observations for Hawaii stations
  const HI_STATIONS = [
    'PHNL', 'PHOG', 'PHTO', 'PHLI', 'PHKO', 'PHJR', 'PHJH',
    'PHNG', 'PHMK', 'PHMU', 'PHBK',
    // Additional METAR stations
    'PHHI', 'PHSF',
  ];

  const UA = 'HawaiiDashboard/1.0 (contact@example.com)';
  const features = [];

  // Fetch observations for each station (parallel, with error tolerance)
  const results = await Promise.allSettled(
    HI_STATIONS.map(async (stationId) => {
      const url = `https://api.weather.gov/stations/${stationId}/observations/latest`;
      const res = await axios.get(url, {
        headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
        timeout: 8000,
      });
      return { stationId, data: res.data };
    })
  );

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { stationId, data } = result.value;
    const props = data?.properties || {};
    const geom = data?.geometry;

    if (!geom || !geom.coordinates) continue;

    // Convert metric to imperial for display
    const tempC = props.temperature?.value;
    const tempF = tempC != null ? (tempC * 9/5 + 32) : null;
    const windKph = props.windSpeed?.value;
    const windMph = windKph != null ? (windKph * 0.621371) : null;
    const windDir = props.windDirection?.value;
    const humidity = props.relativeHumidity?.value;
    const desc = props.textDescription || '';
    const pressure = props.barometricPressure?.value;
    const pressureInHg = pressure != null ? (pressure / 3386.39).toFixed(2) : null;

    // Build description string matching old KML format for frontend compatibility
    const descParts = [];
    if (tempF != null) descParts.push(`Temperature: ${tempF.toFixed(0)}°F (${tempC.toFixed(1)}°C)`);
    if (windMph != null) {
      const dirStr = windDir != null ? degToCompass(windDir) + ' ' : '';
      descParts.push(`Wind: ${dirStr}${windMph.toFixed(0)} mph`);
    }
    if (humidity != null) descParts.push(`Humidity: ${humidity.toFixed(0)}%`);
    if (pressureInHg) descParts.push(`Pressure: ${pressureInHg} inHg`);
    if (desc) descParts.push(desc);

    features.push({
      type: 'Feature',
      geometry: geom,
      properties: {
        name: props.station?.name || stationId,
        stationIdentifier: stationId,
        description: descParts.join('\n'),
        temperature_f: tempF,
        temperature_c: tempC,
        wind_mph: windMph,
        wind_dir: windDir,
        humidity: humidity,
        textDescription: desc,
        timestamp: props.timestamp,
      },
    });
  }

  // Write GeoJSON file
  const out = { type: 'FeatureCollection', features, updatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(DATA_DIR, 'obs.geojson'), JSON.stringify(out));
  cache.obs = { updatedAt: new Date().toISOString(), count: features.length };
  console.log(`[nws] observations updated via NWS API v2: ${features.length} stations`);
}

function degToCompass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16] || '';
}




function initObsFetcher() {
  setTimeout(() => {
    fetchObsKML();
    // Every 32 min (update is 30min, we add 2min buffer to ensure new data available)
    setInterval(fetchObsKML, 32 * 60 * 1000);
  }, 5000 + jitter());
}

// ═══════════════════════════════════════════════════════════════════════════
// ENSO / RONI DATA  (CPC — updated monthly, 2nd Thursday)
// We check daily at 1300 UTC — negligible load, static HTML page
// ═══════════════════════════════════════════════════════════════════════════

async function fetchENSO() {
  try {
    const res = await conditionalFetchText(
      'https://origin.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php',
      cache.enso?.meta
    );
    if (!res.updated) return;

    // Parse the ONI data table from HTML
    const html = typeof res.data === 'string' ? res.data : res.data.toString();
    const series = parseONITable(html);

    cache.enso = {
      series,
      meta:       { etag: res.etag, lastModified: res.lastModified },
      updatedAt:  new Date().toISOString(),
      currentPhase: getCurrentPhase(series),
    };
    fs.writeFileSync(path.join(DATA_DIR, 'enso.json'), JSON.stringify(cache.enso));
    console.log(`[nws] ENSO updated — ${series.length} periods, phase: ${cache.enso.currentPhase}`);
  } catch (err) {
    console.warn(`[nws] ENSO fetch failed: ${err.message}`);
  }
}

function parseONITable(html) {
  // ONI table format: rows of year and 12 3-month season values
  const series = [];
  const rowRx = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  let rows;
  try {
    rows = [...html.matchAll(rowRx)];
  } catch(e) { return []; }

  const seasons = ['DJF','JFM','FMA','MAM','AMJ','MJJ','JJA','JAS','ASO','SON','OND','NDJ'];
  for (const row of rows) {
    const cells = [...row[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cells.length < 2) continue;
    const yearText = cells[0][1].replace(/<[^>]+>/g,'').trim();
    const year = parseInt(yearText);
    if (isNaN(year) || year < 1950) continue;
    for (let i = 1; i < cells.length && i - 1 < seasons.length; i++) {
      const val = parseFloat(cells[i][1].replace(/<[^>]+>/g,'').trim());
      if (isNaN(val)) continue;
      series.push({
        label: `${year} ${seasons[i-1]}`,
        year,
        season: seasons[i-1],
        oni: val,
        phase: val >= 0.5 ? 'el_nino' : val <= -0.5 ? 'la_nina' : 'neutral',
      });
    }
  }
  return series.slice(-60); // Last 5 years for chart
}

function getCurrentPhase(series) {
  if (!series || series.length === 0) return 'Unknown';
  const last = series[series.length - 1];
  if (!last) return 'Unknown';
  const label = last.phase === 'el_nino' ? 'El Niño' : last.phase === 'la_nina' ? 'La Niña' : 'Neutral';
  return `${label} (ONI: ${last.oni > 0 ? '+' : ''}${last.oni})`;
}

function initENSOFetcher() {
  setTimeout(() => {
    fetchENSO();
    // Check once per day — monthly updates, very light load
    setInterval(fetchENSO, 24 * 60 * 60 * 1000);
  }, 30000 + jitter());
}

// ═══════════════════════════════════════════════════════════════════════════
// FAD LOCATIONS (PacIOOS WFS — check daily)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchFADs() {
  try {
    const url = 'https://geo.pacioos.hawaii.edu/geoserver/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=hi_dar:fads&outputFormat=application/json';
    const res = await conditionalFetchText(url, cache.fads?.meta);
    if (!res.updated) return;

    const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    cache.fads = {
      geojson:  data,
      meta:     { etag: res.etag, lastModified: res.lastModified },
      updatedAt: new Date().toISOString(),
      count:    data?.features?.length || 0,
    };
    fs.writeFileSync(path.join(DATA_DIR, 'fads.geojson'), JSON.stringify(data));
    console.log(`[nws] FADs updated: ${cache.fads.count} devices`);
  } catch (err) {
    // FADs may 404 if layer name changed — fall back to bundled static file
    console.warn(`[nws] FAD fetch failed: ${err.message} — using static fallback`);
    const staticFAD = path.join(__dirname, '../public/static/fads_static.geojson');
    if (fs.existsSync(staticFAD) && !cache.fads) {
      cache.fads = { geojson: JSON.parse(fs.readFileSync(staticFAD)), updatedAt: 'static', count: 0 };
    }
  }
}

function initFADFetcher() {
  setTimeout(() => {
    fetchFADs();
    // Once per day at startup + 24hr interval
    setInterval(fetchFADs, 24 * 60 * 60 * 1000);
  }, 20000 + jitter());
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD CACHED STATE FROM DISK ON STARTUP
// ═══════════════════════════════════════════════════════════════════════════

function loadCachedState() {
  // Restore loop metadata
  LOOPS.forEach(loop => {
    const filePath = path.join(LOOPS_DIR, loop.file);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      cache.loops[loop.id] = {
        id: loop.id, name: loop.name, icon: loop.icon,
        localUrl: `/nws-cache/loops/${loop.file}`,
        updatedAt: stat.mtime.toISOString(),
      };
    }
  });
  // Restore text products
  TEXT_PRODUCTS.forEach(prod => {
    const filePath = path.join(TEXT_DIR, `${prod.type}.json`);
    if (fs.existsSync(filePath)) {
      try { cache.text[prod.type] = JSON.parse(fs.readFileSync(filePath)); }
      catch(e) { /* ignore */ }
    }
  });
  // Restore ENSO
  const ensoFile = path.join(DATA_DIR, 'enso.json');
  if (fs.existsSync(ensoFile)) {
    try { cache.enso = JSON.parse(fs.readFileSync(ensoFile)); }
    catch(e) { /* ignore */ }
  }
  // Restore FADs
  const fadFile = path.join(DATA_DIR, 'fads.geojson');
  if (fs.existsSync(fadFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(fadFile));
      cache.fads = { geojson: data, updatedAt: 'cached', count: data?.features?.length || 0 };
    } catch(e) { /* ignore */ }
  }
  console.log('[nws] cached state loaded from disk');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED API ROUTES
// ═══════════════════════════════════════════════════════════════════════════

function registerRoutes(app, express) {
  const staticDir = path.join(__dirname, '../public');

  // Serve nws-cache as static files (GIFs, etc.)
  app.use('/nws-cache', express.static(CACHE_DIR));

  // ── GET /api/nws/loops — loop metadata ──────────────────────────────────
  app.get('/api/nws/loops', (req, res) => {
    // Serve cached data immediately — never block on a fetch
    res.json({
      loops: LOOPS.map(l => cache.loops[l.id] || {
        id: l.id, name: l.name, icon: l.icon, localUrl: null, updatedAt: null,
      }),
      // Let the client know if a live refresh is currently active
      liveRefreshActive: Date.now() < liveRefreshUntil,
      liveRefreshUntil:  liveRefreshUntil > Date.now() ? new Date(liveRefreshUntil).toISOString() : null,
    });

    // Trigger live refresh (non-blocking, safe to call multiple times)
    // This opens or extends the 3-hour live polling window
    setImmediate(() => startLiveRefresh());
  });

  // ── GET /api/nws/text/:product ───────────────────────────────────────────
  app.get('/api/nws/text/:product', (req, res) => {
    const key = req.params.product.toUpperCase();
    const data = cache.text[key];
    if (!data) return res.status(404).json({ error: 'Product not yet cached' });
    res.json(data);
  });

  // ── GET /api/nws/alerts ──────────────────────────────────────────────────
  app.get('/api/nws/alerts', (req, res) => {
    const alertFile = path.join(DATA_DIR, 'alerts.json');
    if (fs.existsSync(alertFile)) {
      res.sendFile(alertFile);
    } else {
      res.json({ features: [], updatedAt: null });
    }
  });

  // ── GET /api/nws/obs ─────────────────────────────────────────────────────
  app.get('/api/nws/obs', (req, res) => {
    const obsFile = path.join(DATA_DIR, 'obs.geojson');
    if (fs.existsSync(obsFile)) {
      res.sendFile(obsFile);
    } else {
      res.json({ type: 'FeatureCollection', features: [] });
    }
  });

  // ── GET /api/nws/wind ────────────────────────────────────────────────────
  app.get('/api/nws/wind', (req, res) => {
    const f = path.join(DATA_DIR, 'wind.geojson');
    fs.existsSync(f) ? res.sendFile(f) : res.json({ type: 'FeatureCollection', features: [] });
  });

  // ── GET /api/nws/rain ────────────────────────────────────────────────────
  app.get('/api/nws/rain', (req, res) => {
    const f = path.join(DATA_DIR, 'rain24.geojson');
    fs.existsSync(f) ? res.sendFile(f) : res.json({ type: 'FeatureCollection', features: [] });
  });

  // ── GET /api/nws/enso ────────────────────────────────────────────────────
  app.get('/api/nws/enso', (req, res) => {
    if (cache.enso) return res.json(cache.enso);
    const f = path.join(DATA_DIR, 'enso.json');
    fs.existsSync(f) ? res.sendFile(f) : res.status(503).json({ error: 'ENSO data not yet available' });
  });

  // ── GET /api/nws/fads ────────────────────────────────────────────────────
  app.get('/api/nws/fads', (req, res) => {
    const f = path.join(DATA_DIR, 'fads.geojson');
    if (fs.existsSync(f)) return res.sendFile(f);
    const staticF = path.join(staticDir, 'static/fads_static.geojson');
    if (fs.existsSync(staticF)) return res.sendFile(staticF);
    res.json({ type: 'FeatureCollection', features: [] });
  });

  // ── GET /api/nws/harbor-approaches ──────────────────────────────────────
  app.get('/api/nws/harbor-approaches', (req, res) => {
    const f = path.join(staticDir, 'static/harbor_approaches.geojson');
    fs.existsSync(f) ? res.sendFile(f) : res.json({ type: 'FeatureCollection', features: [] });
  });

  // ── GET /api/nws/trade-routes ────────────────────────────────────────────
  app.get('/api/nws/trade-routes', (req, res) => {
    const f = path.join(staticDir, 'static/trade_routes.geojson');
    fs.existsSync(f) ? res.sendFile(f) : res.json({ type: 'FeatureCollection', features: [] });
  });

  // ── GET /api/nws/fishing-areas ───────────────────────────────────────────
  app.get('/api/nws/fishing-areas', (req, res) => {
    const f = path.join(staticDir, 'static/fishing_areas.geojson');
    fs.existsSync(f) ? res.sendFile(f) : res.json({ type: 'FeatureCollection', features: [] });
  });

  // ── GET /api/nws/status ──────────────────────────────────────────────────
  app.get('/api/nws/status', (req, res) => {
    res.json({
      loops:      Object.keys(cache.loops).length,
      textProducts: Object.keys(cache.text).length,
      alerts:     cache.alerts.length,
      enso:       cache.enso?.currentPhase || null,
      fads:       cache.fads?.count || 0,
      cacheDir:   CACHE_DIR,
    });
  });

  console.log('[nws] routes registered');
}

// ═══════════════════════════════════════════════════════════════════════════
// INIT — call this once from server.js
// ═══════════════════════════════════════════════════════════════════════════

function init(app, express) {
  loadCachedState();
  initLoopFetchers();
  initTextFetchers();
  initAlertsFetcher();
  initObsFetcher();
  initENSOFetcher();
  initFADFetcher();
  registerRoutes(app, express);
  console.log('[nws] NWS service initialised — good-citizen caching active');
}

module.exports = { init };
