require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');

const app = express();

// ── Winds Aloft — server-side pre-fetch cache (30 min) ───────────────────────
let windsAloftCache = { data: null, raw: null, fetchedAt: 0 };
const WINDS_TTL_MS = 30 * 60 * 1000;

async function prefetchWindsAloft() {
  const now = Date.now();
  if (windsAloftCache.raw && (now - windsAloftCache.fetchedAt) < WINDS_TTL_MS) return;

  for (const fcst of ['06', '12', '24', '00']) {
    for (const level of ['low', 'high']) {
      try {
        const url = `https://aviationweather.gov/api/data/windtemp?region=hawaii&level=${level}&fcst=${fcst}&format=raw`;
        const r = await axios.get(url, { timeout: 15000, responseType: 'text' });
        const txt = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        if (txt.includes('HNL') || txt.includes('OGG') || txt.includes('ITO')) {
          if (!windsAloftCache.raw) windsAloftCache.raw = {};
          windsAloftCache.raw[level] = txt;
          windsAloftCache.fetchedAt = now;
          console.log(`[winds-aloft] cached fcst=${fcst} level=${level} @ ${new Date().toISOString()}`);
        }
      } catch (e) { /* try next */ }
    }
  }
}

// Pre-fetch immediately and every 30 minutes
prefetchWindsAloft().catch(console.error);
setInterval(() => prefetchWindsAloft().catch(console.error), WINDS_TTL_MS);

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


app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionTimeoutMillis: 5000,
  statement_timeout: 8000,
  idle_in_transaction_session_timeout: 10000,
  user: 'tracker',
  host: '192.168.1.104',
  database: 'tracking_db',
  password: 'pukalani',
  port: 5432,
});

const TAR1090_URL = 'http://192.168.1.102/tar1090/data/aircraft.json';

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
    res.json(result.rows);
  } catch (err) {
    console.error('vessels query error:', err.message);
    res.status(500).json({ error: 'DB error', vessels: [] });
  }
});





// --- Trails: last N minutes for a single entity ---
// Aircraft default: 10 min  |  Vessels default: 60 min (slower moving)
app.get('/api/trails/:id', async (req, res) => {
  try {
    const minutes = Math.min(parseInt(req.query.minutes || '10'), 120);
    const result = await pool.query(`
      SELECT
        ST_X(location::geometry) as lon,
        ST_Y(location::geometry) as lat,
        altitude, speed, heading, recorded_at
      FROM live_tracks
      WHERE entity_id = $1
        AND recorded_at > NOW() - ($2 || ' minutes')::INTERVAL
      ORDER BY recorded_at ASC;
    `, [req.params.id, minutes]);
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
// WINDS ALOFT
// ============================================================
app.get('/api/winds-aloft', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (station, level_ft)
        station, valid_time, level_ft, wind_dir, wind_spd, wind_tmp_c
      FROM winds_aloft
      WHERE valid_time > NOW() - INTERVAL '6 hours'
      ORDER BY station, level_ft, valid_time DESC;
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('winds aloft error:', err.message);
    console.error('winds aloft error:', err.message);
    res.json([]);
  }
});

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
    const haUrl = 'http://192.168.1.19:8123/api/webhook/5de76fbee15b641d309d042238b47326';
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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hawaii API Server running on port ${PORT}`);
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
app.get('/api/winds-aloft-raw', (req, res) => {
  if (!windsAloftCache.raw) return res.json({ ok: false, data: null, fetchedAt: 0 });
  res.json({ ok: true, data: windsAloftCache.raw, fetchedAt: windsAloftCache.fetchedAt });
});

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
//   app.get('/api/hdradio/' + route, async function(req, res) {
//     try {
//       const response = await axios.get(NRSC5_ENGINE_URL + '/api/' + route, { timeout: 5000 });
//       res.json(response.data);
//     } catch(err) { res.json(route === 'snapshot' ? {} : []); }
//   });
// });
// app.post('/api/hdradio/scheduler', async function(req, res) {
//   try {
//     const response = await axios.post(NRSC5_ENGINE_URL + '/api/scheduler', req.body, { timeout: 5000 });
//     res.json(response.data);
//   } catch(err) { res.json({ ok: false, error: err.message }); }
// });
