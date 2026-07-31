require('dotenv').config();
const nwsService = require('./nws-service');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const knownEntities = require('./known-entities-service');
const axios = require('axios');

const app = express();

// ── CORS — applied globally BEFORE any route ──────────────────────────────
// Must be registered before all routes so every endpoint gets the header.
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (direct, curl, server-to-server)
    if (!origin) return cb(null, true);
    // Allow LAN origins and localhost
    if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));


// ── Airport status — server-side proxy (avoids browser CORS) ─────────────────
let airportStatusCache = { data: null, fetchedAt: 0 };
const AIRPORT_STATUS_TTL = 5 * 60 * 1000; // 5 min

async function prefetchAirportStatus() {
  try {
    const r = await axios.get('https://nasstatus.faa.gov/api/airport-status-information',
      { timeout: 10000, responseType: 'text' });
    airportStatusCache = { data: r.data, fetchedAt: Date.now() };
    console.log('[airport-status] refreshed @ ' + new Date().toISOString());
  } catch(e) {
    console.error('[airport-status] fetch failed:', e.message);
  }
}

prefetchAirportStatus().catch(console.error);
setInterval(() => prefetchAirportStatus().catch(console.error), AIRPORT_STATUS_TTL);

// ── Tide predictions — server-side proxy cache (8 hours) ───────────────────────
const tideCache = {};
const TIDE_TTL_MS = 8 * 60 * 60 * 1000;

app.get('/api/noaa-tides/:station', async (req, res) => {
  const station = req.params.station;
  const now = Date.now();
  if (tideCache[station] && (now - tideCache[station].fetchedAt) < TIDE_TTL_MS) {
    return res.json(tideCache[station].data);
  }
  try {
    const days = parseInt(req.query.days || '2');
    const begin = new Date();
    const end = new Date(begin.getTime() + days * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&datum=MLLW&time_zone=lst_ldt&interval=h&units=english&format=json&begin_date=${ymd(begin)}&end_date=${ymd(end)}&station=${station}`;
    const r = await axios.get(url, { timeout: 15000 });
    tideCache[station] = { data: r.data, fetchedAt: now };
    console.log(`[noaa-tides] cached station=${station} @ ${new Date().toISOString()}`);
    res.json(r.data);
  } catch (err) {
    console.error('tide fetch error:', err.message);
    if (tideCache[station]) {
      res.json(tideCache[station].data);
    } else {
      res.status(502).json({ error: 'NOAA API unavailable' });
    }
  }
});

app.use(express.json());

const pool = new Pool({
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  idle_in_transaction_session_timeout: 10000,
  user: process.env.DB_USER || 'tracker',
  host: process.env.DB_HOST || '192.168.1.104',
  database: process.env.DB_NAME || 'tracking_db',
  password: process.env.DB_PASSWORD || 'pukalani',
  port: parseInt(process.env.DB_PORT) || 5432,
});

const TAR1090_URL = process.env.TAR1090_URL || 'http://192.168.1.102/tar1090/data/aircraft.json';

// --- Aircraft: direct proxy to tar1090 for sub-second latency ---
app.get('/api/aircraft', async (req, res) => {
  try {
    const response = await axios.get(TAR1090_URL, { timeout: 3000 });
    res.json(response.data);
  } catch (err) {
    console.error('tar1090 proxy error:', err.message);
    res.status(502).json({ error: 'tar1090 unavailable', aircraft: [] });
  }
});

// --- Vessels: full AIS data from DB, last 2 hours, strictly one row per MMSI ---
// PostGIS filter: 200nm radius from home (21.2855N, -157.7969W)
// 200nm = 370,400m in metres (geography type handles the sphere math)
const HOME_LAT = 21.2855;
const HOME_LON = -157.7969;
const RANGE_M  = 370400;   // 200 nautical miles

app.get('/api/vessels', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (lt.entity_id)
        e.entity_id,
        e.entity_type,
        e.vessel_name,
        e.vessel_type,
        e.callsign,
        e.destination,
        e.eta,
        e.length,
        e.beam,
        e.draught,
        lt.speed,
        lt.heading,
        lt.heading AS course,
        lt.rot,
        lt.nav_status,
        lt.source_type,
        ST_X(lt.location::geometry) AS lon,
        ST_Y(lt.location::geometry) AS lat,
        lt.recorded_at,
        e.first_seen,
        e.last_seen,
        -- Age in seconds
        EXTRACT(EPOCH FROM (NOW() - lt.recorded_at))::int AS age_seconds
      FROM live_tracks lt
      JOIN entities e ON e.entity_id = lt.entity_id
      WHERE lt.recorded_at > NOW() - INTERVAL '30 minutes'
        AND e.entity_type = 'VESSEL'
        AND ST_DWithin(
          lt.location::geography,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
      ORDER BY lt.entity_id, lt.recorded_at DESC;
    `, [HOME_LON, HOME_LAT, RANGE_M]);
    // Record sightings for all active vessels
    result.rows.forEach(v => {
      recordVesselSighting(String(v.entity_id), v.vessel_name).catch(()=>{});
      if (v.lat && v.lon) recordVesselTrackPoint(String(v.entity_id), v.lat, v.lon, v.speed, v.heading).catch(()=>{});
    });
    res.json(result.rows);
  } catch (err) {
    console.error('vessels query error:', err.message);
    res.status(500).json({ error: 'DB error', vessels: [] });
  }
});


// GET /api/vessels/nearby — AISHub cache: vessels near us but not yet in DB
app.get('/api/vessels/nearby', async (req, res) => {
  try {
    const http = require('http');
    const data = await new Promise((resolve, reject) => {
      http.get('http://192.168.1.105:3105/api/aishub-nearby', { timeout: 5000 }, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
      }).on('error', () => resolve([]));
    });
    // Filter out vessels already known to our DB in last 30 min
    const known = await pool.query(
      "SELECT entity_id FROM entities WHERE entity_type='VESSEL' AND last_seen > NOW() - INTERVAL '30 minutes'"
    );
    const knownSet = new Set(known.rows.map(r => r.entity_id));
    const nearby = data.filter(v => v.mmsi && !knownSet.has(v.mmsi));
    res.json(nearby);
  } catch (err) {
    console.error('nearby error:', err.message);
    res.json([]);
  }
});




// --- Trails: today (Hawaii time) or last N minutes for a single entity ---
//
//   ?today=true        → from midnight Hawaii time today (default for all clients)
//   ?minutes=N         → last N minutes (legacy, max 720)
//   ?session=true      → since first detection this DB session (first recorded_at today)
//
// Hawaii timezone: Pacific/Honolulu = UTC-10 (no DST)
app.get('/api/trails/:id', async (req, res) => {
  try {
    let result;

    if (req.query.today === 'true' || (!req.query.minutes && !req.query.session)) {
      // Default: today's trail from track_history (1 point/min, warm tier)
      result = await pool.query(`
        SELECT lon, lat, speed, heading, recorded_at, source_type
        FROM track_history
        WHERE entity_id = $1
          AND recorded_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Pacific/Honolulu')
                              AT TIME ZONE 'Pacific/Honolulu'
        ORDER BY recorded_at ASC;
      `, [req.params.id]);

    } else if (req.query.session === 'true') {
      result = await pool.query(`
        SELECT lon, lat, speed, heading, recorded_at, source_type
        FROM track_history
        WHERE entity_id = $1
          AND recorded_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Pacific/Honolulu')
                              AT TIME ZONE 'Pacific/Honolulu'
        ORDER BY recorded_at ASC;
      `, [req.params.id]);

    } else {
      // Legacy minutes mode (max 720 = 12 hours)
      const minutes = Math.min(parseInt(req.query.minutes || '60'), 720);
      result = await pool.query(`
        SELECT lon, lat, speed, heading, recorded_at, source_type
        FROM track_history
        WHERE entity_id = $1
          AND recorded_at > NOW() - ($2 || ' minutes')::INTERVAL
        ORDER BY recorded_at ASC;
      `, [req.params.id, minutes]);
    }

    res.json(result.rows);
  } catch (err) {
    console.error('trails query error:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// --- Entity history ---
app.get('/api/history/:id', async (req, res) => {
  try {
    const entity = await pool.query('SELECT * FROM entities WHERE entity_id = $1', [req.params.id]);
    const count  = await pool.query('SELECT COUNT(*) FROM live_tracks WHERE entity_id = $1', [req.params.id]);
    res.json({ entity: entity.rows[0] || null, total_positions: parseInt(count.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// --- Status ---
app.get('/api/status', async (req, res) => {
  try {
    const acResp  = await axios.get(TAR1090_URL, { timeout: 2000 });
    const dbCheck = await pool.query('SELECT NOW()');
    // Count AIS messages in last 5 minutes from DB
    let aisCount = 0;
    try {
      const aisR = await pool.query(
        "SELECT COUNT(*) as cnt FROM live_tracks WHERE source_type='ais' AND recorded_at > NOW() - INTERVAL '5 minutes'"
      );
      aisCount = parseInt(aisR.rows[0]?.cnt || 0);
    } catch(_) {}
    res.json({
      ok: true, server_time: new Date().toISOString(),
      tar1090_aircraft: acResp.data.aircraft?.length || 0,
      tar1090_messages: acResp.data.messages || 0,
      ais_messages_5min: aisCount,
      db_time: dbCheck.rows[0].now,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── System health endpoint for monitoring ───────────────────────────────────
app.get('/api/health', async (req, res) => {
  const health = { status: 'ok', timestamp: new Date().toISOString(), checks: {} };
  
  // DB connectivity
  try {
    await pool.query('SELECT 1');
    health.checks.database = { ok: true };
  } catch(e) {
    health.checks.database = { ok: false, error: e.message };
    health.status = 'degraded';
  }
  
  // AIS freshness (data in last 10 min)
  try {
    const r = await pool.query("SELECT COUNT(*) as cnt FROM live_tracks WHERE source_type='ais' AND recorded_at > NOW() - INTERVAL '10 minutes'");
    const cnt = parseInt(r.rows[0]?.cnt || 0);
    health.checks.ais = { ok: cnt > 0, vessels_10min: cnt };
    if (cnt === 0) health.status = 'degraded';
  } catch(e) {
    health.checks.ais = { ok: false, error: e.message };
  }
  
  // ADS-B freshness
  try {
    const r = await pool.query("SELECT COUNT(*) as cnt FROM live_tracks WHERE source_type='adsb' AND recorded_at > NOW() - INTERVAL '5 minutes'");
    const cnt = parseInt(r.rows[0]?.cnt || 0);
    health.checks.adsb = { ok: cnt > 0, aircraft_5min: cnt };
  } catch(e) {
    health.checks.adsb = { ok: false, error: e.message };
  }
  
  // Weather freshness
  try {
    const r = await pool.query("SELECT COUNT(*) as cnt FROM pws_obs WHERE obs_time > NOW() - INTERVAL '5 minutes'");
    const cnt = parseInt(r.rows[0]?.cnt || 0);
    health.checks.weather = { ok: cnt > 0 };
  } catch(e) {
    health.checks.weather = { ok: false, error: e.message };
  }
  
  // tar1090
  try {
    const r = await axios.get(process.env.TAR1090_URL || TAR1090_URL, { timeout: 2000 });
    health.checks.tar1090 = { ok: true, aircraft: r.data.aircraft?.length || 0 };
  } catch(e) {
    health.checks.tar1090 = { ok: false, error: e.message };
    health.status = 'degraded';
  }
  
  const statusCode = health.status === 'ok' ? 200 : 207;
  res.status(statusCode).json(health);
});

// ── Nightly health report ────────────────────────────────────────────────────
const fs_health = require('fs');
app.get('/api/health-report', (req, res) => {
  try {
    const report = JSON.parse(fs_health.readFileSync('/tmp/health-report.json', 'utf8'));
    res.json(report);
  } catch(e) {
    res.json({ available: false, message: 'No health report yet — runs nightly at 02:00 HST' });
  }
});

// ============================================================
// OCEAN BUOYS — NDBC realtime observations
// ============================================================
app.get('/api/buoys', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (b.buoy_id)
        b.buoy_id, b.name, b.lat, b.lon,
        o.obs_time, o.wdir, o.wspd, o.gst,
        o.wvht, o.dpd, o.mwd, o.atmp, o.wtmp, o.pres
      FROM buoy_stations b
      LEFT JOIN buoy_obs o ON b.buoy_id = o.buoy_id
        AND o.obs_time > NOW() - INTERVAL '3 hours'
      ORDER BY b.buoy_id, o.obs_time DESC;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('buoys error:', err.message);
    // Return static list even if DB not ready yet
    res.json([]);
  }
});

app.get('/api/buoys/:id/history', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT obs_time, wdir, wspd, gst, wvht, dpd, atmp, wtmp, pres
      FROM buoy_obs WHERE buoy_id = $1
        AND obs_time > NOW() - INTERVAL '24 hours'
      ORDER BY obs_time ASC;
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// ============================================================
// TIDES — NOAA CO-OPS predictions + actual water level
// ============================================================
app.get('/api/tides', async (req, res) => {
  try {
    // Return all tide stations with their next hi/lo and current water level
    const stations = await pool.query(`
      SELECT s.station_id, s.name, s.lat, s.lon,
        (SELECT height_ft FROM tide_water_level wl
          WHERE wl.station_id = s.station_id
          ORDER BY obs_time DESC LIMIT 1) AS current_ft,
        (SELECT obs_time FROM tide_water_level wl
          WHERE wl.station_id = s.station_id
          ORDER BY obs_time DESC LIMIT 1) AS current_time,
        (SELECT json_agg(row_to_json(p) ORDER BY pred_time)
          FROM tide_predictions p
          WHERE p.station_id = s.station_id
            AND p.is_hilo = true
            AND p.pred_time > NOW() - INTERVAL '1 hour'
            AND p.pred_time < NOW() + INTERVAL '48 hours'
        ) AS upcoming_hilo
      FROM tide_stations s;
    `);
    res.json(stations.rows);
  } catch (err) {
    console.error('tides error:', err.message);
    res.json([]);
  }
});

app.get('/api/tides/:station/chart', async (req, res) => {
  try {
    // Hourly predictions + actual water level for a sparkline/chart
    const preds = await pool.query(`
      SELECT pred_time as t, height_ft, tide_type
      FROM tide_predictions
      WHERE station_id = $1 AND is_hilo = false
        AND pred_time > NOW() - INTERVAL '12 hours'
        AND pred_time < NOW() + INTERVAL '36 hours'
      ORDER BY pred_time;
    `, [req.params.station]);
    const actuals = await pool.query(`
      SELECT obs_time as t, height_ft
      FROM tide_water_level
      WHERE station_id = $1
        AND obs_time > NOW() - INTERVAL '12 hours'
      ORDER BY obs_time;
    `, [req.params.station]);
    res.json({ predictions: preds.rows, actuals: actuals.rows });
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// ============================================================
// AVIATION WEATHER — METAR / ATIS
// ============================================================
app.get('/api/metar', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (icao)
        icao, name, lat, lon, obs_time, raw_metar,
        temp_c, dewp_c, wind_dir, wind_spd, wind_gst,
        vis_sm, altim_hpa, sky_cond, wx_string, flight_cat
      FROM metar_obs
      WHERE obs_time > NOW() - INTERVAL '2 hours'
      ORDER BY icao, obs_time DESC;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('metar error:', err.message);
    res.json([]);
  }
});

// ============================================================
// ============================================================

// ============================================================
// ECOWITT PWS — HP2564 Wittboy Pro + WS90
// ============================================================
//
// Device setup (in WS View Pro app on your phone):
//   Customized → Ecowitt Protocol
//   Server: 192.168.1.24  (CT108 IP, or nginx proxy)
//   Port: 3001
//   Path: /api/ecowitt
//   Upload interval: 60s
//
// ── Receiver: Ecowitt device POSTs here every 60s ──────────
app.post('/api/ecowitt', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const d = req.body;

    // -- Forward payload to Home Assistant --
    // (Do this async so it doesn't block our DB insert)
    const haUrl = process.env.HA_WEBHOOK_URL || 'http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326';
    fetch(haUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(req.body).toString()
    }).catch(err => console.error('[Ecowitt] HA Relay error:', err.message));

    // Parse optional dateutc field (format: "2026-07-09+17:00:00")
    let obsTime = new Date();
    if (d.dateutc && d.dateutc !== 'now') {
      try { obsTime = new Date(d.dateutc.replace('+', 'T') + 'Z'); } catch {}
    }

    // Parse lightning time if present (epoch seconds)
    let lightningTime = null;
    if (d.lightning_time && parseInt(d.lightning_time) > 0) {
      lightningTime = new Date(parseInt(d.lightning_time) * 1000).toISOString();
    }

    const pf = (v) => v !== undefined && v !== '' ? parseFloat(v) : null;
    const pi = (v) => v !== undefined && v !== '' ? parseInt(v) : null;

    await pool.query(`
      INSERT INTO pws_obs (
        station_id, obs_time, passkey,
        temp_in_f, humidity_in,
        temp_out_f, humidity_out,
        baro_rel_inhg, baro_abs_inhg,
        wind_dir, wind_spd_mph, wind_gust_mph, max_gust_mph,
        rain_rate_in, rain_event_in, rain_hourly_in, rain_daily_in,
        rain_weekly_in, rain_monthly_in, rain_yearly_in,
        solar_rad, uv_index,
        lightning_dist, lightning_count, lightning_time,
        ws90_batt, console_batt
      ) VALUES (
        'pukalani_home', $1, $2,
        $3,  $4,
        $5,  $6,
        $7,  $8,
        $9,  $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19,
        $20, $21,
        $22, $23, $24,
        $25, $26
      )
      ON CONFLICT (station_id, obs_time) DO UPDATE SET
        temp_out_f = EXCLUDED.temp_out_f,
        wind_spd_mph = EXCLUDED.wind_spd_mph,
        rain_rate_in = EXCLUDED.rain_rate_in,
        solar_rad = EXCLUDED.solar_rad;
    `, [
      obsTime.toISOString(), d.PASSKEY || d.passkey || null,
      pf(d.tempinf), pf(d.humidityin),
      // WS90 uses tempf/humidity for outdoor
      pf(d.tempf), pf(d.humidity),
      pf(d.baromrelin), pf(d.baromabsin),
      pi(d.winddir), pf(d.windspeedmph), pf(d.windgustmph), pf(d.maxdailygust),
      // WS90 piezo rain fields (fall back to standard fields)
      pf(d.rrain_piezo  ?? d.rainratein),
      pf(d.erain_piezo  ?? d.eventrainin),
      pf(d.hrain_piezo  ?? d.hourlyrainin),
      pf(d.drain_piezo  ?? d.dailyrainin),
      pf(d.wrain_piezo  ?? d.weeklyrainin),
      pf(d.mrain_piezo  ?? d.monthlyrainin),
      pf(d.yrain_piezo  ?? d.totalrainin),
      pf(d.solarradiation), pf(d.uv),
      pf(d.lightning), pi(d.lightning_num), lightningTime,
      pf(d.ws90cap_volt ?? d.wh90batt), pf(d.wh65batt),
    ]);

    // Log to console for debugging
    console.log(`[Ecowitt] ${new Date().toISOString()} — ${d.tempf}°F, wind ${d.windspeedmph}mph @ ${d.winddir}°, rain ${d.rrain_piezo ?? d.rainratein} in/hr, UV ${d.uv}, solar ${d.solarradiation} W/m²`);

    res.json({ success: true, received: obsTime.toISOString() });
  } catch (err) {
    console.error('[Ecowitt] POST error:', err.message);
    // Always 200 to device to prevent retry storm
    res.json({ success: false, error: err.message });
  }
});

// ── Reader: dashboard polls this for current conditions ─────
app.get('/api/ecowitt/current', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        o.obs_time,
        s.name, s.lat, s.lon, s.model,
        o.temp_in_f, o.humidity_in,
        o.temp_out_f, o.humidity_out,
        o.baro_rel_inhg,
        o.wind_dir, o.wind_spd_mph, o.wind_gust_mph, o.max_gust_mph,
        o.rain_rate_in, o.rain_hourly_in, o.rain_daily_in, o.rain_monthly_in,
        o.solar_rad, o.uv_index,
        o.lightning_dist, o.lightning_count, o.lightning_time,
        o.ws90_batt,
        -- Dew point (Magnus formula from Celsius)
        ROUND(
          CAST(
            (CAST( (o.temp_out_f - 32.0) * 5.0/9.0 AS NUMERIC) -
             (100.0 - o.humidity_out) / 5.0) * 9.0/5.0 + 32.0
          AS NUMERIC),
        1) as dew_point_f
      FROM pws_obs o
      JOIN pws_stations s ON o.station_id = s.station_id
      WHERE o.obs_time > NOW() - INTERVAL '5 minutes'
      ORDER BY o.obs_time DESC
      LIMIT 1;
    `);
    if (result.rows.length === 0) {
      // Return last known reading even if stale
      const stale = await pool.query(`
        SELECT o.*, s.name, s.lat, s.lon, s.model,
          ROUND(CAST((CAST( (o.temp_out_f - 32.0) * 5.0/9.0 AS NUMERIC) - (100.0 - o.humidity_out) / 5.0) * 9.0/5.0 + 32.0 AS NUMERIC), 1) as dew_point_f
        FROM pws_obs o JOIN pws_stations s ON o.station_id = s.station_id
        ORDER BY o.obs_time DESC LIMIT 1;
      `);
      return res.json({ data: stale.rows[0] || null, stale: true });
    }
    res.json({ data: result.rows[0], stale: false });
  } catch (err) {
    console.error('[Ecowitt] GET /current error:', err.message);
    res.json({ data: null, error: err.message });
  }
});

// ── History: last 24h for charts ────────────────────────────
app.get('/api/ecowitt/history', async (req, res) => {
  try {
    const hours = Math.min(parseInt(req.query.hours || '24'), 168);
    const result = await pool.query(`
      SELECT
        obs_time,
        temp_out_f, humidity_out, baro_rel_inhg,
        wind_spd_mph, wind_gust_mph, wind_dir,
        rain_rate_in, rain_hourly_in,
        solar_rad, uv_index
      FROM pws_obs
      WHERE station_id = 'pukalani_home'
        AND obs_time > NOW() - ($1 || ' hours')::INTERVAL
      ORDER BY obs_time ASC;
    `, [hours]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Stub: weather radar still Phase 3
app.get('/api/weather/radar', (req, res) => res.json({ stub: true, message: 'Weather radar layer coming in Phase 3' }));

// ============================================================
// VESSEL PREDICTIONS — destination prediction engine output
// ============================================================
app.get('/api/vessel-predictions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.mmsi,
        p.vessel_name,
        p.predicted_dest,
        p.confidence,
        p.method,
        p.predicted_at
      FROM vessel_predictions p
      WHERE p.predicted_at > NOW() - INTERVAL '2 hours'
      ORDER BY p.confidence DESC;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('vessel-predictions error:', err.message);
    res.json([]);
  }
});

// ============================================================
// VESSEL ROUTES — historical port-to-port route log
// ============================================================
app.get('/api/vessel-routes/:mmsi', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        mmsi, vessel_name, depart_port, arrive_port,
        depart_time, arrive_time, avg_speed, distance_nm, observed_at
      FROM vessel_routes
      WHERE mmsi = $1
      ORDER BY arrive_time DESC
      LIMIT 20;
    `, [req.params.mmsi]);
    res.json(result.rows);
  } catch (err) {
    console.error('vessel-routes error:', err.message);
    res.json([]);
  }
});

// ============================================================
// HAWAII PORTS — geofence reference for map overlay
// ============================================================
app.get('/api/hawaii-ports', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM hawaii_ports ORDER BY name;');
    res.json(result.rows);
  } catch (err) {
    console.error('hawaii-ports error:', err.message);
    res.json([]);
  }
});



const PORT = 3001;

// ═══════════════════════════════════════════════════════════════════════════
// VESSEL & AIRCRAFT LOCAL KNOWLEDGE BASE
// ═══════════════════════════════════════════════════════════════════════════
const multer = require('multer');
const path_mod = require('path');
const fs_mod = require('fs');

// Ensure uploads directory exists
const UPLOADS_DIR = '/opt/dashboard/uploads/vessels';
if (!fs_mod.existsSync(UPLOADS_DIR)) fs_mod.mkdirSync(UPLOADS_DIR, { recursive: true });

const vesselUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path_mod.extname(file.originalname) || '.jpg';
      cb(null, `${req.params.mmsi}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  }
});

// Serve uploaded vessel photos
app.use('/uploads/vessels', express.static(UPLOADS_DIR));
// Serve static GeoJSON map data
app.use('/static', express.static('/opt/dashboard/public/static'));

// ── Auto-record vessel sightings (called from vessel polling) ─────────────
async function recordVesselSighting(mmsi, vesselName) {
  if (!mmsi) return;
  try {
    // Record today's sighting
    await pool.query(
      `INSERT INTO vessel_sightings (mmsi, seen_day) VALUES ($1, CURRENT_DATE) ON CONFLICT DO NOTHING`,
      [mmsi]
    );
    // Upsert vessel_info basics
    await pool.query(`
      INSERT INTO vessel_info (mmsi, vessel_name, first_seen, last_seen, seen_days)
      VALUES ($1, $2, now(), now(), 1)
      ON CONFLICT (mmsi) DO UPDATE SET
        last_seen = now(),
        vessel_name = COALESCE(vessel_info.vessel_name, EXCLUDED.vessel_name),
        seen_days = (SELECT COUNT(DISTINCT seen_day) FROM vessel_sightings WHERE mmsi = $1)
    `, [mmsi, vesselName || null]);
  } catch (e) {
    // Non-fatal — don't break vessel API on sighting errors
  }
}

async function recordVesselTrackPoint(mmsi, lat, lon, speed, heading) {
  if (!mmsi || lat == null || lon == null) return;
  if (typeof recordTrackPoint !== 'function') return;
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM vessel_info WHERE mmsi=$1 AND (auto_detected OR is_pinned) LIMIT 1`, [mmsi]
    );
    if (rows.length) {
      await recordTrackPoint(pool, 'vessel', String(mmsi), lat, lon, null, speed, heading);
    }
  } catch {}
}

// ── GET vessel local knowledge ────────────────────────────────────────────
app.get('/api/vessel-info/:mmsi', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vi.*,
        (SELECT COUNT(DISTINCT seen_day) FROM vessel_sightings WHERE mmsi = vi.mmsi) AS seen_days_count,
        (SELECT ARRAY_AGG(seen_day ORDER BY seen_day DESC) FROM vessel_sightings WHERE mmsi = vi.mmsi LIMIT 30) AS recent_days
       FROM vessel_info vi WHERE vi.mmsi = $1`,
      [req.params.mmsi]
    );
    if (!rows.length) return res.status(404).json({ error: 'No local record' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST / upsert vessel local knowledge ─────────────────────────────────
app.post('/api/vessel-info/:mmsi', express.json(), async (req, res) => {
  const mmsi = req.params.mmsi;
  const {
    vessel_name, imo, call_sign, flag, vessel_type,
    gross_tonnage, year_built, length_m, beam_m,
    owner, operator, notes, photo_url, data_source
  } = req.body;
  try {
    await pool.query(`
      INSERT INTO vessel_info (mmsi, vessel_name, imo, call_sign, flag, vessel_type,
        gross_tonnage, year_built, length_m, beam_m, owner, operator, notes, photo_url, data_source,
        first_seen, last_seen, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now(),now())
      ON CONFLICT (mmsi) DO UPDATE SET
        vessel_name   = COALESCE($2, vessel_info.vessel_name),
        imo           = COALESCE($3, vessel_info.imo),
        call_sign     = COALESCE($4, vessel_info.call_sign),
        flag          = COALESCE($5, vessel_info.flag),
        vessel_type   = COALESCE($6, vessel_info.vessel_type),
        gross_tonnage = COALESCE($7, vessel_info.gross_tonnage),
        year_built    = COALESCE($8, vessel_info.year_built),
        length_m      = COALESCE($9, vessel_info.length_m),
        beam_m        = COALESCE($10, vessel_info.beam_m),
        owner         = COALESCE($11, vessel_info.owner),
        operator      = COALESCE($12, vessel_info.operator),
        notes         = COALESCE($13, vessel_info.notes),
        photo_url     = COALESCE($14, vessel_info.photo_url),
        data_source   = COALESCE($15, vessel_info.data_source),
        updated_at    = now()
    `, [mmsi, vessel_name, imo, call_sign, flag, vessel_type,
        gross_tonnage, year_built, length_m, beam_m,
        owner, operator, notes, photo_url, data_source || 'manual']);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST vessel photo upload ──────────────────────────────────────────────
app.post('/api/vessel-photo/:mmsi', vesselUpload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const photoUrl = `/uploads/vessels/${req.file.filename}`;
  try {
    await pool.query(
      `UPDATE vessel_info SET photo_url=$1, photo_local=true, updated_at=now() WHERE mmsi=$2`,
      [photoUrl, req.params.mmsi]
    );
    res.json({ ok: true, photo_url: photoUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET vessel seen-days ──────────────────────────────────────────────────
app.get('/api/vessel-info/:mmsi/seen-days', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT seen_day FROM vessel_sightings WHERE mmsi=$1 ORDER BY seen_day DESC`,
      [req.params.mmsi]
    );
    res.json({ count: rows.length, days: rows.map(r => r.seen_day) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT toggle track-to-destination ─────────────────────────────────────────
app.put('/api/vessel-info/:mmsi/track-dest', express.json(), async (req, res) => {
  try {
    const { enabled } = req.body;
    await pool.query(
      'UPDATE vessel_info SET track_dest_return = $1 WHERE mmsi = $2',
      [!!enabled, req.params.mmsi]
    );
    res.json({ ok: true, track_dest_return: !!enabled });
  } catch (e) {
    console.error('track-dest toggle error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AIRCRAFT LOCAL KNOWLEDGE BASE (3-sighting rule)
// ═══════════════════════════════════════════════════════════════════════════

// ── Auto-record aircraft sightings (3-sighting rule) ─────────────────────
async function recordAircraftSighting(icaoHex, registration, aircraftType) {
  if (!icaoHex || icaoHex === '000000') return;
  try {
    // Increment raw sighting count
    const { rows } = await pool.query(`
      INSERT INTO aircraft_sighting_counts (icao_hex, sighting_count, first_seen, last_seen)
      VALUES ($1, 1, now(), now())
      ON CONFLICT (icao_hex) DO UPDATE SET
        sighting_count = aircraft_sighting_counts.sighting_count + 1,
        last_seen = now()
      RETURNING sighting_count
    `, [icaoHex]);

    const count = rows[0]?.sighting_count || 0;

    // Only persist to aircraft_info after 3rd sighting
    if (count >= 3) {
      await pool.query(`
        INSERT INTO aircraft_info (icao_hex, registration, aircraft_type, sighting_count, first_seen, last_seen)
        VALUES ($1, $2, $3, $4, now(), now())
        ON CONFLICT (icao_hex) DO UPDATE SET
          last_seen = now(),
          sighting_count = $4,
          registration = COALESCE(aircraft_info.registration, EXCLUDED.registration),
          aircraft_type = COALESCE(aircraft_info.aircraft_type, EXCLUDED.aircraft_type)
      `, [icaoHex, registration || null, aircraftType || null, count]);

      // Record seen-day
      await pool.query(
        `INSERT INTO aircraft_sightings (icao_hex, seen_day) VALUES ($1, CURRENT_DATE) ON CONFLICT DO NOTHING`,
        [icaoHex]
      );

      // Update seen_days count
      await pool.query(`
        UPDATE aircraft_info SET
          seen_days = (SELECT COUNT(DISTINCT seen_day) FROM aircraft_sightings WHERE icao_hex = $1),
          auto_detected = ((SELECT COUNT(DISTINCT seen_day) FROM aircraft_sightings WHERE icao_hex = $1) >= 3)
        WHERE icao_hex = $1
      `, [icaoHex]);
    }
  } catch (e) {
    // Non-fatal
  }
}

// ── GET aircraft local knowledge ──────────────────────────────────────────
app.get('/api/aircraft-info/:icao', async (req, res) => {
  const icao = req.params.icao.toLowerCase();
  try {
    // Check raw sighting count first
    const countRow = await pool.query(
      `SELECT sighting_count FROM aircraft_sighting_counts WHERE icao_hex=$1`,
      [icao]
    );
    const sightingCount = countRow.rows[0]?.sighting_count || 0;

    const { rows } = await pool.query(
      `SELECT ai.*,
        (SELECT COUNT(DISTINCT seen_day) FROM aircraft_sightings WHERE icao_hex = ai.icao_hex) AS seen_days_count
       FROM aircraft_info ai WHERE ai.icao_hex = $1`,
      [icao]
    );

    if (!rows.length) {
      // Return minimal info even if below threshold
      return res.json({
        icao_hex: icao,
        sighting_count: sightingCount,
        threshold_met: sightingCount >= 3,
        record_exists: false
      });
    }
    res.json({ ...rows[0], threshold_met: true, record_exists: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST / upsert aircraft local knowledge ────────────────────────────────
app.post('/api/aircraft-info/:icao', express.json(), async (req, res) => {
  const icao = req.params.icao.toLowerCase();
  const { registration, aircraft_type, operator, notes, photo_url, data_source } = req.body;
  try {
    // Only allow if threshold met
    const countRow = await pool.query(
      `SELECT sighting_count FROM aircraft_sighting_counts WHERE icao_hex=$1`, [icao]
    );
    if ((countRow.rows[0]?.sighting_count || 0) < 3) {
      return res.status(403).json({ error: 'Aircraft seen fewer than 3 times — record not yet created' });
    }
    await pool.query(`
      INSERT INTO aircraft_info (icao_hex, registration, aircraft_type, operator, notes, photo_url, data_source, first_seen, last_seen)
      VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())
      ON CONFLICT (icao_hex) DO UPDATE SET
        registration  = COALESCE($2, aircraft_info.registration),
        aircraft_type = COALESCE($3, aircraft_info.aircraft_type),
        operator      = COALESCE($4, aircraft_info.operator),
        notes         = COALESCE($5, aircraft_info.notes),
        photo_url     = COALESCE($6, aircraft_info.photo_url),
        data_source   = COALESCE($7, aircraft_info.data_source),
        updated_at    = now()
    `, [icao, registration, aircraft_type, operator, notes, photo_url, data_source || 'manual']);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET aircraft seen-days ────────────────────────────────────────────────
app.get('/api/aircraft-info/:icao/seen-days', async (req, res) => {
  const icao = req.params.icao.toLowerCase();
  try {
    const { rows } = await pool.query(
      `SELECT seen_day FROM aircraft_sightings WHERE icao_hex=$1 ORDER BY seen_day DESC`,
      [icao]
    );
    const countRow = await pool.query(
      `SELECT sighting_count FROM aircraft_sighting_counts WHERE icao_hex=$1`, [icao]
    );
    res.json({
      count: rows.length,
      days: rows.map(r => r.seen_day),
      total_sightings: countRow.rows[0]?.sighting_count || 0,
      threshold_met: (countRow.rows[0]?.sighting_count || 0) >= 3
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Known Entities / Frequent Visitors service
const multer_ke = require('multer');
const path_ke   = require('path');
const fs_ke     = require('fs');
let recordTrackPoint = null;
try {
  const ke = knownEntities.init(app, pool, express, multer_ke, path_ke, fs_ke);
  recordTrackPoint = ke.recordTrackPoint;
} catch(e) { console.error('[known-entities] init error:', e.message); }


// ── GET /api/weather/conditions ─────────────────────────────────────────────
// Weather Conditions aggregate endpoint for CurrentWeatherView screen
let forecastCache = { data: null, fetchedAt: 0 };
const FORECAST_TTL_MS = 60 * 60 * 1000; // 1 hour in memory cache

async function fetchLandForecast() {
  const now = Date.now();
  if (forecastCache.data && (now - forecastCache.fetchedAt) < FORECAST_TTL_MS) {
    return forecastCache.data;
  }
  const headers = { 'User-Agent': 'HawaiiCommandCenter/1.0 (private home monitoring)' };
  let periods = [];
  try {
    // Try specified gridpoints HFO 56,127 first
    const res = await axios.get('https://api.weather.gov/gridpoints/HFO/56,127/forecast', { headers, timeout: 10000 });
    periods = res.data?.properties?.periods || [];
  } catch (err1) {
    try {
      // Fallback to HFO 154,145 (Honolulu land forecast grid) if 56,127 returns 404
      const res2 = await axios.get('https://api.weather.gov/gridpoints/HFO/154,145/forecast', { headers, timeout: 10000 });
      periods = res2.data?.properties?.periods || [];
    } catch (err2) {
      console.error('[weather-conditions] NWS forecast fetch error:', err2.message);
    }
  }

  const formatted = periods.map(p => ({
    name: p.name,
    temp: p.temperature,
    tempUnit: p.temperatureUnit,
    isDaytime: p.isDaytime,
    shortForecast: p.shortForecast,
    detailedForecast: p.detailedForecast,
    icon: p.icon,
    windSpeed: p.windSpeed,
    windDirection: p.windDirection
  }));

  if (formatted.length > 0) {
    forecastCache = { data: formatted, fetchedAt: now };
  }
  return forecastCache.data || formatted;
}

async function fetchHonoluluTides() {
  const station = '1612340';
  const now = Date.now();
  let tideData = null;

  if (tideCache[station] && (now - tideCache[station].fetchedAt) < TIDE_TTL_MS) {
    tideData = tideCache[station].data;
  } else {
    try {
      const days = 2; // next 48hr
      const begin = new Date();
      const end = new Date(begin.getTime() + days * 86400000);
      const pad = (n) => String(n).padStart(2, '0');
      const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
      const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&datum=MLLW&time_zone=lst_ldt&interval=h&units=english&format=json&begin_date=${ymd(begin)}&end_date=${ymd(end)}&station=${station}`;
      const r = await axios.get(url, { timeout: 15000 });
      tideCache[station] = { data: r.data, fetchedAt: now };
      tideData = r.data;
    } catch (err) {
      console.error('[weather-conditions] tide fetch error:', err.message);
      if (tideCache[station]) tideData = tideCache[station].data;
    }
  }

  const rawPreds = tideData?.predictions || [];
  return rawPreds.map((p, i) => {
    let isoTime;
    try {
      isoTime = new Date(p.t.replace(' ', 'T') + '-10:00').toISOString();
    } catch (e) {
      isoTime = p.t;
    }
    const prev = rawPreds[i - 1];
    const next = rawPreds[i + 1];
    const h = parseFloat(p.v);
    let tide_type = p.type || p.tide_type || null;
    if (!tide_type && prev && next) {
      const ph = parseFloat(prev.v), nh = parseFloat(next.v);
      if (h > ph && h > nh) tide_type = 'H';
      else if (h < ph && h < nh) tide_type = 'L';
    }
    return {
      t: isoTime,
      height_ft: h,
      tide_type: tide_type
    };
  });
}

app.get('/api/weather/conditions', async (req, res) => {
  try {
    // 1. Ecowitt current observation (same query as /api/ecowitt/current)
    let ecowittData = null;
    try {
      const ecoRes = await pool.query(`
        SELECT
          o.obs_time,
          s.name, s.lat, s.lon, s.model,
          o.temp_in_f, o.humidity_in,
          o.temp_out_f, o.humidity_out,
          o.baro_rel_inhg,
          o.wind_dir, o.wind_spd_mph, o.wind_gust_mph, o.max_gust_mph,
          o.rain_rate_in, o.rain_hourly_in, o.rain_daily_in, o.rain_monthly_in,
          o.solar_rad, o.uv_index,
          o.lightning_dist, o.lightning_count, o.lightning_time,
          o.ws90_batt,
          ROUND(
            CAST(
              (CAST( (o.temp_out_f - 32.0) * 5.0/9.0 AS NUMERIC) -
               (100.0 - o.humidity_out) / 5.0) * 9.0/5.0 + 32.0
            AS NUMERIC),
          1) as dew_point_f
        FROM pws_obs o
        JOIN pws_stations s ON o.station_id = s.station_id
        WHERE o.obs_time > NOW() - INTERVAL '5 minutes'
        ORDER BY o.obs_time DESC
        LIMIT 1;
      `);
      if (ecoRes.rows.length > 0) {
        ecowittData = ecoRes.rows[0];
      } else {
        const staleRes = await pool.query(`
          SELECT o.*, s.name, s.lat, s.lon, s.model,
            ROUND(CAST((CAST( (o.temp_out_f - 32.0) * 5.0/9.0 AS NUMERIC) - (100.0 - o.humidity_out) / 5.0) * 9.0/5.0 + 32.0 AS NUMERIC), 1) as dew_point_f
          FROM pws_obs o JOIN pws_stations s ON o.station_id = s.station_id
          ORDER BY o.obs_time DESC LIMIT 1;
        `);
        ecowittData = staleRes.rows[0] || null;
      }
    } catch (eEco) {
      console.error('[weather-conditions] Ecowitt DB query error:', eEco.message);
    }

    // 2. Forecast, 3. Tides, 4. FADs
    const [forecast, tides] = await Promise.all([
      fetchLandForecast(),
      fetchHonoluluTides()
    ]);

    let fads = [];
    if (typeof nwsService.getFADs === 'function') {
      fads = nwsService.getFADs();
    } else {
      const fs = require('fs');
      const path = require('path');
      const f = path.join(__dirname, 'data', 'fads.geojson');
      if (fs.existsSync(f)) {
        try { fads = JSON.parse(fs.readFileSync(f, 'utf8'))?.features || []; } catch(e) {}
      }
    }

    res.json({
      ecowitt: ecowittData,
      forecast,
      tides,
      fads,
      generatedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error('[weather-conditions] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// NWS/NOAA caching service

nwsService.init(app, express);


// --- Project Manager DB ---
const pmPool = new Pool({
  host: '192.168.1.104',
  port: 5432,
  database: 'project_mgr',
  user: 'pm_user',
  password: 'pukalani_pm',
});

app.get('/api/pm/summary', async (req, res) => {
  try {
    const totalTasksReq = await pmPool.query("SELECT COUNT(*) FROM tasks WHERE task_type = 'task'");
    const openTasksReq = await pmPool.query("SELECT COUNT(*) FROM tasks WHERE status != 'Completed' AND status != 'Cancelled' AND task_type = 'task'");
    const overdueTasksReq = await pmPool.query("SELECT COUNT(*) FROM tasks WHERE status NOT IN ('Completed', 'Cancelled') AND target_date_finish < CURRENT_DATE AND task_type = 'task'");
    const warrantiesReq = await pmPool.query("SELECT COUNT(*) FROM warranties");
    const warrantiesSoonReq = await pmPool.query("SELECT COUNT(*) FROM warranties WHERE end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'");
    const maintenanceDueReq = await pmPool.query("SELECT COUNT(*) FROM maintenance WHERE date_when_fixed IS NULL");
    
    res.json({
      total_tasks: parseInt(totalTasksReq.rows[0].count),
      open_tasks: parseInt(openTasksReq.rows[0].count),
      overdue_tasks: parseInt(overdueTasksReq.rows[0].count),
      warranties: parseInt(warrantiesReq.rows[0].count),
      warranty_expiring_soon: parseInt(warrantiesSoonReq.rows[0].count),
      maintenance_due: parseInt(maintenanceDueReq.rows[0].count)
    });
  } catch (err) {
    console.error('pm summary error:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hawaii API Server running on port ${PORT}`);

  // ── Aircraft sighting poller — runs every 60s ──────────────────
  // Fetches live aircraft from tar1090 and records sightings
  // so frequent visitors (helicopters, etc.) get auto-detected
  const aircraftSightingPoll = async () => {
    try {
      const resp = await axios.get(TAR1090_URL, { timeout: 3000 });
      const aircraft = resp.data?.aircraft || [];
      let recorded = 0;
      for (const ac of aircraft) {
        if (!ac.hex || ac.hex === '000000') continue;
        if (!ac.lat || !ac.lon) continue; // skip MLAT-only with no position
        await recordAircraftSighting(ac.hex, ac.r || null, ac.t || null);
        recorded++;
      }
      if (recorded > 0) {
        console.log(`[aircraft-sightings] Recorded ${recorded} sightings`);
      }
    } catch (e) {
      // tar1090 unavailable — non-fatal
    }
  };
  // Run immediately then every 60 seconds
  aircraftSightingPoll();
  setInterval(aircraftSightingPoll, 60000);
});
﻿// ============================================================
// ALERTS PROXY — forwards to alerts-engine CT 109
// ============================================================
const ALERTS_ENGINE_URL = 'http://192.168.1.109:3009';

app.get('/api/alerts', async (req, res) => {
  try {
    const url = req.query.category
      ? `${ALERTS_ENGINE_URL}/api/alerts/${req.query.category}`
      : `${ALERTS_ENGINE_URL}/api/alerts`;
    const response = await axios.get(url, { timeout: 5000 });
    res.json(response.data);
  } catch (err) {
    console.error('alerts proxy error:', err.message);
    res.json([]); // graceful degradation
  }
});

app.get('/api/alerts/health', async (req, res) => {
  try {
    const response = await axios.get(`${ALERTS_ENGINE_URL}/api/health`, { timeout: 3000 });
    res.json(response.data);
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Winds Aloft proxy endpoint ────────────────────────────────────────────────

// ── Airport status proxy endpoint ─────────────────────────────────────────────
app.get('/api/airport-status', (req, res) => {
  if (!airportStatusCache.data) {
    return res.status(503).json({ error: 'Not yet fetched' });
  }
  res.set('Content-Type', 'text/xml; charset=utf-8');
  res.set('X-Fetched-At', new Date(airportStatusCache.fetchedAt).toISOString());
  res.send(airportStatusCache.data);
});


// ── BirdNET-Go proxy ─────────────────────────────────────────────────────────
// Proxies to 192.168.1.21:8080 so the birdnet.html page has no CORS issues.
const BIRDNET_URL = 'http://192.168.1.25:8080';

app.get('/api/birdnet', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const r = await axios.get(`${BIRDNET_URL}/api/v2/detections${qs ? '?' + qs : ''}`,
      { timeout: 8000 });
    res.json(r.data);
  } catch (err) {
    console.error('[birdnet] proxy error:', err.message);
    res.status(502).json({ error: 'BirdNET unavailable', data: [] });
  }
});

// ── HD Radio proxy — DISABLED for Hawaii (nrsc5-engine stopped) ───────────────
// Re-enable for Berkeley CA by restoring this block:
// const NRSC5_ENGINE_URL = 'http://192.168.1.111:3011';
// const hdRoutes = ['traffic','gas','weather','eas','poi','news','sports','stocks','status','snapshot','health','lots','radar'];
// hdRoutes.forEach(function(route) {
