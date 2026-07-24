/**
 * CT 111 — nrsc5-engine server.js
 *
 * Receives parsed HD Radio data from the Proxmox host nrsc5-parser.py,
 * stores it with TTL-based expiry, serves it via REST + WebSocket,
 * and forwards alerts/sensors to CT 109 and Home Assistant.
 *
 * Data we handle: traffic incidents, gas prices, weather alerts, EAS,
 * POI, sports, stocks, news, images, signal metrics.
 *
 * Data we DON'T store: station callsigns, now playing, program guides.
 */

'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const { WebSocketServer } = require('ws');
const Database   = require('better-sqlite3');
const axios      = require('axios');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');

const PORT       = process.env.PORT        || 3011;
const HA_URL     = process.env.HA_URL      || 'http://192.168.1.19:8123';
const HA_TOKEN   = process.env.HA_TOKEN    || '';
const ALERTS_URL = process.env.ALERTS_URL  || 'http://192.168.1.109:3009/api/ingest';

// ── Database ──────────────────────────────────────────────────────────────────
const db = new Database('/opt/nrsc5-engine/data.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS traffic_incidents (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    lat         REAL,
    lon         REAL,
    road        TEXT,
    event_code  INTEGER,
    severity    TEXT,
    description TEXT,
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS gas_prices (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    lat         REAL,
    lon         REAL,
    name        TEXT,
    regular     REAL,
    midgrade    REAL,
    premium     REAL,
    diesel      REAL,
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS weather_alerts (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    text        TEXT,
    xml         TEXT,
    severity    TEXT,
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS eas_alerts (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    raw         TEXT,
    severity    TEXT DEFAULT 'EXTREME',
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS poi (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    lat         REAL,
    lon         REAL,
    name        TEXT,
    category    TEXT,
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS news_items (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    text        TEXT,
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS sports_items (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    xml         TEXT,
    text        TEXT,
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS stock_items (
    id          TEXT PRIMARY KEY,
    freq        REAL,
    text        TEXT,
    ts          TEXT,
    expires_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS lot_catalogue (
    sha         TEXT PRIMARY KEY,
    freq        REAL,
    station     TEXT,
    content_type TEXT,
    port        INTEGER,
    size        INTEGER,
    filename    TEXT,
    archive     TEXT,
    ts          TEXT,
    parse_status TEXT DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS scheduler_status (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_traffic_expires ON traffic_incidents(expires_at);
  CREATE INDEX IF NOT EXISTS idx_gas_expires ON gas_prices(expires_at);
`);

// ── Expiry helpers ─────────────────────────────────────────────────────────────
const now  = () => Math.floor(Date.now() / 1000);
const ttl  = {
  traffic:  2 * 3600,   // 2 hours
  gas:      4 * 3600,   // 4 hours
  weather:  3 * 3600,   // 3 hours
  eas:      12 * 3600,  // 12 hours (serious events)
  poi:      24 * 3600,  // 24 hours
  news:     1 * 3600,   // 1 hour
  sports:   6 * 3600,   // 6 hours
  stocks:   1 * 3600,   // 1 hour
};

function pruneExpired() {
  const t = now();
  db.prepare('DELETE FROM traffic_incidents WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM gas_prices         WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM weather_alerts     WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM poi                WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM news_items         WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM sports_items       WHERE expires_at < ?').run(t);
  db.prepare('DELETE FROM stock_items        WHERE expires_at < ?').run(t);
  // EAS never auto-expires — user must dismiss
}
setInterval(pruneExpired, 60_000);
pruneExpired();

// ── WebSocket broadcast ────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

function broadcast(type, data) {
  const msg = JSON.stringify({ type, ...data, broadcastTs: new Date().toISOString() });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

wss.on('connection', ws => {
  // Send current snapshot on connect
  ws.send(JSON.stringify({ type: 'snapshot', data: getSnapshot() }));
});

function getSnapshot() {
  const t = now();
  return {
    traffic:  db.prepare('SELECT * FROM traffic_incidents WHERE expires_at > ?').all(t),
    gas:      db.prepare('SELECT * FROM gas_prices         WHERE expires_at > ?').all(t),
    weather:  db.prepare('SELECT * FROM weather_alerts     WHERE expires_at > ?').all(t),
    eas:      db.prepare('SELECT * FROM eas_alerts         WHERE expires_at > ?').all(t),
    poi:      db.prepare('SELECT * FROM poi                WHERE expires_at > ?').all(t),
    news:     db.prepare('SELECT * FROM news_items         WHERE expires_at > ?').all(t),
    sports:   db.prepare('SELECT * FROM sports_items       WHERE expires_at > ?').all(t),
    stocks:   db.prepare('SELECT * FROM stock_items        WHERE expires_at > ?').all(t),
    status:   getStatus(),
  };
}

function getStatus() {
  const rows = db.prepare('SELECT key, value FROM scheduler_status').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ── HA sensor push ─────────────────────────────────────────────────────────────
async function pushToHA(entityId, state, attributes = {}) {
  if (!HA_TOKEN) return;
  try {
    await axios.post(
      `${HA_URL}/api/states/${entityId}`,
      { state: String(state), attributes },
      { headers: { Authorization: `Bearer ${HA_TOKEN}` }, timeout: 5000 }
    );
  } catch (e) {
    console.error(`[HA push] ${entityId}: ${e.message}`);
  }
}

// Push traffic incident count to HA device_tracker for map visibility
async function pushTrafficToHA(incidents) {
  const t = now();
  // Update aggregate count sensor
  await pushToHA('sensor.hdradio_traffic_incidents', incidents.length, {
    friendly_name: 'HD Radio Traffic Incidents',
    unit_of_measurement: 'incidents',
  });

  // Push each incident as a HA device_tracker so it appears on HA map
  for (const inc of incidents.slice(0, 20)) {  // cap at 20
    const eid = `device_tracker.traffic_${inc.id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
    await pushToHA(eid, 'home', {
      latitude: inc.lat,
      longitude: inc.lon,
      friendly_name: `🚗 ${inc.road || 'Road Incident'}: ${inc.description}`,
      icon: inc.severity === 'MAJOR' ? 'mdi:alert' : 'mdi:traffic-cone',
      source_type: 'gps',
    });
  }
}

async function pushGasToHA(stations) {
  for (const s of stations.slice(0, 10)) {
    const eid = `device_tracker.gas_${s.id.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
    await pushToHA(eid, 'home', {
      latitude: s.lat,
      longitude: s.lon,
      friendly_name: `⛽ ${s.name}: $${s.regular?.toFixed(2) || '?'}/gal`,
      icon: 'mdi:gas-station',
      source_type: 'gps',
      regular: s.regular,
      midgrade: s.midgrade,
      premium: s.premium,
      diesel: s.diesel,
    });
  }
}

// Forward EAS/weather alerts to CT 109 alerts engine
async function forwardAlertToCT109(category, title, body, severity) {
  try {
    await axios.post(ALERTS_URL, {
      id: `hdradio_${Date.now()}`,
      category,
      severity,
      title,
      body,
      source: 'HD Radio (NRSC-5)',
      issued: new Date().toISOString(),
      expires: null,
      action: severity === 'EXTREME' ? 'Follow official emergency instructions immediately.' : null,
    }, { timeout: 5000 });
  } catch (e) {
    console.error(`[CT109 forward] ${e.message}`);
  }
}

// ── Ingest handler ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/ingest', (req, res) => {
  const event = req.body;
  if (!event || !event.type) return res.status(400).json({ error: 'missing type' });

  try {
    handleEvent(event);
    res.json({ ok: true });
  } catch (e) {
    console.error('[ingest]', e.message);
    res.status(500).json({ error: e.message });
  }
});

function makeId(...parts) {
  return parts.filter(Boolean).join('_').replace(/[^a-z0-9_]/gi, '_').slice(0, 64);
}

function handleEvent(ev) {
  const t = now();
  const { type, freq, ts } = ev;

  switch (type) {

    case 'traffic': {
      const incidents = ev.incidents || [];
      const inserted = [];
      for (const inc of incidents) {
        const id = makeId('traf', freq, inc.event_code, Math.round(inc.lat * 1000), Math.round(inc.lon * 1000));
        db.prepare(`
          INSERT OR REPLACE INTO traffic_incidents
          (id, freq, lat, lon, road, event_code, severity, description, ts, expires_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)
        `).run(id, freq, inc.lat, inc.lon, inc.road, inc.event_code,
               inc.severity, inc.description, ts, t + ttl.traffic);
        inserted.push({ id, ...inc });
      }
      if (inserted.length > 0) {
        broadcast('traffic', { incidents: inserted });
        pushTrafficToHA(inserted).catch(() => {});
        console.log(`[traffic] ${inserted.length} incidents from ${freq} MHz`);
      }
      break;
    }

    case 'gas': {
      const id = makeId('gas', freq, Math.round(ev.lat * 1000), Math.round(ev.lon * 1000));
      db.prepare(`
        INSERT OR REPLACE INTO gas_prices
        (id, freq, lat, lon, name, regular, midgrade, premium, diesel, ts, expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, freq, ev.lat, ev.lon, ev.name, ev.regular, ev.midgrade,
             ev.premium, ev.diesel, ts, t + ttl.gas);
      broadcast('gas', { ...ev, id });
      const allGas = db.prepare('SELECT * FROM gas_prices WHERE expires_at > ?').all(t);
      pushGasToHA(allGas).catch(() => {});
      console.log(`[gas] ${ev.name} reg=$${ev.regular} from ${freq} MHz`);
      break;
    }

    case 'eas_alert': {
      const id = makeId('eas', freq, t);
      db.prepare(`
        INSERT OR IGNORE INTO eas_alerts (id, freq, raw, severity, ts, expires_at)
        VALUES (?,?,?,?,?,?)
      `).run(id, freq, ev.raw, 'EXTREME', ts, t + ttl.eas);
      broadcast('eas_alert', { ...ev, id });
      pushToHA('binary_sensor.hdradio_eas_alert', 'on', {
        friendly_name: 'HD Radio Emergency Alert',
        icon: 'mdi:alert-circle',
        message: ev.raw,
      }).catch(() => {});
      forwardAlertToCT109('civil', 'EAS Emergency Alert', ev.raw, 'EXTREME').catch(() => {});
      console.log(`[EAS] EXTREME: ${ev.raw?.slice(0, 80)}`);
      break;
    }

    case 'weather_alert': {
      const body = ev.text || ev.xml?.slice(0, 500) || '';
      const id = makeId('wx', freq, t);
      db.prepare(`
        INSERT OR IGNORE INTO weather_alerts (id, freq, text, xml, severity, ts, expires_at)
        VALUES (?,?,?,?,?,?,?)
      `).run(id, freq, ev.text || '', ev.xml || '', 'SEVERE', ts, t + ttl.weather);
      broadcast('weather_alert', { ...ev, id });
      forwardAlertToCT109('marine', 'HD Radio Weather Alert', body, 'SEVERE').catch(() => {});
      console.log(`[weather] ${body.slice(0, 60)}`);
      break;
    }

    case 'poi': {
      const id = makeId('poi', freq, Math.round(ev.lat * 1000), Math.round(ev.lon * 1000));
      db.prepare(`
        INSERT OR REPLACE INTO poi (id, freq, lat, lon, name, category, ts, expires_at)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(id, freq, ev.lat, ev.lon, ev.name, ev.category || 'general', ts, t + ttl.poi);
      broadcast('poi', { ...ev, id });
      break;
    }

    case 'news': {
      const id = makeId('news', freq, t);
      db.prepare(`
        INSERT OR IGNORE INTO news_items (id, freq, text, ts, expires_at)
        VALUES (?,?,?,?,?)
      `).run(id, freq, ev.text || '', ts, t + ttl.news);
      broadcast('news', { ...ev, id });
      pushToHA('sensor.hdradio_news', (ev.text || '').slice(0, 255), {
        friendly_name: 'HD Radio News', icon: 'mdi:newspaper',
      }).catch(() => {});
      break;
    }

    case 'sports': {
      const id = makeId('sports', freq, t);
      db.prepare(`
        INSERT OR IGNORE INTO sports_items (id, freq, xml, text, ts, expires_at)
        VALUES (?,?,?,?,?,?)
      `).run(id, freq, ev.xml || '', ev.text || '', ts, t + ttl.sports);
      broadcast('sports', { ...ev, id });
      break;
    }

    case 'stocks': {
      const id = makeId('stocks', freq, t);
      db.prepare(`
        INSERT OR IGNORE INTO stock_items (id, freq, text, ts, expires_at)
        VALUES (?,?,?,?,?)
      `).run(id, freq, ev.text || '', ts, t + ttl.stocks);
      broadcast('stocks', { ...ev, id });
      break;
    }

    case 'radar_meta': {
      const meta = ev;
      if (!meta.nw || !meta.se) break;
      db.prepare(`
        INSERT OR REPLACE INTO radar_meta
        (area, nw_lat, nw_lon, se_lat, se_lon, legend_json, ts)
        VALUES (?,?,?,?,?,?,?)
      `).run(meta.area || 'unknown',
             meta.nw[0], meta.nw[1], meta.se[0], meta.se[1],
             JSON.stringify(meta.legend || {}), ts);
      console.log(`[radar_meta] area=${meta.area} nw=${meta.nw} se=${meta.se}`);
      broadcast('radar_meta', meta);
      break;
    }

    case 'radar_overlay': {
      if (!ev.data_b64 || !ev.nw || !ev.se) break;
      const id = 'radar_' + (ev.area || 'hawaii');
      // Expire in 15 minutes (radar updates ~every 5-10 min)
      const expires = Date.now() + 90 * 60 * 1000; // 90 min — covers full AIS+HD cycle (45 min) with buffer
      db.prepare(`
        INSERT OR REPLACE INTO radar_overlays
        (id, area, nw_lat, nw_lon, se_lat, se_lon, data_b64, filename, freq, ts, expires_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
      `).run(id, ev.area || 'hawaii',
             ev.nw[0], ev.nw[1], ev.se[0], ev.se[1],
             ev.data_b64, ev.filename || '', ev.freq || 0, ts, expires);
      console.log(`[radar_overlay] ${ev.area} ${ev.size}B nw=${ev.nw}`);
      broadcast('radar_overlay', { ...ev, data_b64: undefined, has_image: true });
      break;
    }

    case 'image': {

      // Images (logos/art) — just broadcast to dashboard, don't store in DB
      broadcast('image', ev);
      break;
    }

    case 'lot_unknown':
    case 'navteq_unknown':
    case 'xml_data':
    case 'text_data': {
      // Archive only — log and broadcast for potential future parsing
      db.prepare(`
        INSERT OR IGNORE INTO lot_catalogue
        (sha, freq, station, content_type, port, size, filename, archive, ts, parse_status)
        VALUES (?,?,?,?,?,?,?,?,?,'unknown')
      `).run(ev.sha, freq, ev.station || '', ev.content_type || '', ev.port || 0,
             ev.size || 0, ev.filename || '', ev.archive || '', ts);
      break;
    }

    case 'signal':
    case 'session_start':
    case 'session_end': {
      db.prepare('INSERT OR REPLACE INTO scheduler_status(key, value) VALUES (?,?)')
        .run(type === 'signal' ? 'last_signal' : type, JSON.stringify(ev));
      broadcast('status', { event: type, ...ev });
      break;
    }

    default:
      console.log(`[ingest] Unknown event type: ${type}`);
  }
}

// ── REST API ───────────────────────────────────────────────────────────────────
app.get('/api/radar', (req, res) => {
  const t = Date.now();
  const overlay = db.prepare('SELECT * FROM radar_overlays WHERE expires_at > ? ORDER BY ts DESC LIMIT 1').get(t);
  const meta    = db.prepare('SELECT * FROM radar_meta LIMIT 1').get();
  if (!overlay) return res.json({ ok: false, message: 'No radar data yet' });
  res.json({
    ok: true,
    area:    overlay.area,
    nw:      [overlay.nw_lat, overlay.nw_lon],
    se:      [overlay.se_lat, overlay.se_lon],
    data_b64: overlay.data_b64,
    filename: overlay.filename,
    freq:    overlay.freq,
    ts:      overlay.ts,
    legend:  meta ? JSON.parse(meta.legend_json || '{}') : {},
  });
});

app.get('/api/traffic', (req, res) => {
  res.json(db.prepare('SELECT * FROM traffic_incidents WHERE expires_at > ?').all(now()));
});

app.get('/api/gas', (req, res) => {
  res.json(db.prepare('SELECT * FROM gas_prices WHERE expires_at > ?').all(now()));
});

app.get('/api/weather', (req, res) => {
  res.json(db.prepare('SELECT * FROM weather_alerts WHERE expires_at > ?').all(now()));
});

app.get('/api/eas', (req, res) => {
  res.json(db.prepare('SELECT * FROM eas_alerts ORDER BY ts DESC').all());
});

app.delete('/api/eas/:id', (req, res) => {
  db.prepare('DELETE FROM eas_alerts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/poi', (req, res) => {
  res.json(db.prepare('SELECT * FROM poi WHERE expires_at > ?').all(now()));
});

app.get('/api/news', (req, res) => {
  res.json(db.prepare('SELECT * FROM news_items WHERE expires_at > ?').all(now()));
});

app.get('/api/sports', (req, res) => {
  res.json(db.prepare('SELECT * FROM sports_items WHERE expires_at > ?').all(now()));
});

app.get('/api/stocks', (req, res) => {
  res.json(db.prepare('SELECT * FROM stock_items WHERE expires_at > ?').all(now()));
});

app.get('/api/lots', (req, res) => {
  res.json(db.prepare('SELECT * FROM lot_catalogue ORDER BY ts DESC LIMIT 200').all());
});

app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

app.get('/api/snapshot', (req, res) => {
  res.json(getSnapshot());
});

app.post('/api/scheduler', (req, res) => {
  // Allow dashboard to update scheduler config
  const { ais_duration, hd_duration, dwell } = req.body;
  if (ais_duration) db.prepare('INSERT OR REPLACE INTO scheduler_status(key,value) VALUES(?,?)').run('cfg_ais_duration', String(ais_duration));
  if (hd_duration)  db.prepare('INSERT OR REPLACE INTO scheduler_status(key,value) VALUES(?,?)').run('cfg_hd_duration',  String(hd_duration));
  if (dwell)        db.prepare('INSERT OR REPLACE INTO scheduler_status(key,value) VALUES(?,?)').run('cfg_dwell',        String(dwell));
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  const t = now();
  res.json({
    ok: true,
    counts: {
      traffic:  db.prepare('SELECT COUNT(*) AS c FROM traffic_incidents WHERE expires_at > ?').get(t).c,
      gas:      db.prepare('SELECT COUNT(*) AS c FROM gas_prices         WHERE expires_at > ?').get(t).c,
      weather:  db.prepare('SELECT COUNT(*) AS c FROM weather_alerts     WHERE expires_at > ?').get(t).c,
      eas:      db.prepare('SELECT COUNT(*) AS c FROM eas_alerts').get().c,
      poi:      db.prepare('SELECT COUNT(*) AS c FROM poi                WHERE expires_at > ?').get(t).c,
      news:     db.prepare('SELECT COUNT(*) AS c FROM news_items         WHERE expires_at > ?').get(t).c,
      lots:     db.prepare('SELECT COUNT(*) AS c FROM lot_catalogue').get().c,
    },
    uptime: process.uptime(),
  });
});

server.listen(PORT, () => {
  console.log(`[nrsc5-engine] Running on port ${PORT}`);
  console.log(`[nrsc5-engine] HA: ${HA_URL} | Alerts CT109: ${ALERTS_URL}`);
});
