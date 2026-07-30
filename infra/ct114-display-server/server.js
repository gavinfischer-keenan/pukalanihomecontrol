import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// ── SQLite persistence ──
const db = new Database(join(__dirname, 'state.db'));
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

function loadState() {
  const row = db.prepare('SELECT data FROM app_state WHERE id = 1').get();
  return row ? JSON.parse(row.data) : null;
}

function saveState(state) {
  db.prepare(`INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`)
    .run(JSON.stringify(state));
}

// ── State migration (removes stale data from old views) ──
function migrateState(state) {
  if (!state) return state;
  const cleaned = { ...state };

  // Remove obsolete top-level keys
  delete cleaned.birdnetDetections;

  // Valid view IDs
  const validViews = new Set(['cams', 'vessels', 'weather', 'house_status']);
  const deletedViews = new Set(['birdnet', 'aircraft']);

  // Clean slot mappings that reference deleted views
  for (const key of Object.keys(cleaned)) {
    if (key.endsWith('SlotMappings') && typeof cleaned[key] === 'object') {
      const mappings = { ...cleaned[key] };
      for (const [slot, viewId] of Object.entries(mappings)) {
        if (deletedViews.has(viewId)) {
          mappings[slot] = '';
          console.log(`[Migration] Cleared deleted view '${viewId}' from ${key}.${slot}`);
        }
      }
      cleaned[key] = mappings;
    }
  }

  return cleaned;
}

// ── Load server-side config ──
function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, 'cameras.json'), 'utf-8'));
  } catch (e) {
    console.error('[Config] Failed to load cameras.json:', e.message);
    return { cameras: [], layouts: [], views: [], displays: [], defaults: {} };
  }
}

// ── JSON parsing ──
app.use(express.json({ limit: '1mb' }));

// ── Reverse proxy routes (BEFORE static serving) ──
app.use('/proxy/tar1090', createProxyMiddleware({
  target: 'http://192.168.1.102',
  changeOrigin: true,
  pathRewrite: { '^/proxy/tar1090': '' },
  ws: true,
}));

app.use('/proxy/dashboard', createProxyMiddleware({
  target: 'http://192.168.1.108:8080',
  changeOrigin: true,
  pathRewrite: { '^/proxy/dashboard': '' },
}));

app.use('/proxy/dashboard-api', createProxyMiddleware({
  target: 'http://192.168.1.108:3001',
  changeOrigin: true,
  pathRewrite: { '^/proxy/dashboard-api': '' },
}));

app.use('/proxy/frigate', createProxyMiddleware({
  target: 'http://192.168.1.113:5000',
  changeOrigin: true,
  pathRewrite: { '^/proxy/frigate': '' },
}));

app.use('/proxy/go2rtc', createProxyMiddleware({
  target: 'http://192.168.1.113:1984',
  changeOrigin: true,
  pathRewrite: { '^/proxy/go2rtc': '' },
  ws: true,
}));

// ── Static files (Vite build) — no-cache for JS/CSS so deploys take effect immediately ──
app.use(express.static(join(__dirname, 'dist'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  },
}));

// ── Config API (server-driven, no frontend rebuild needed) ──
app.get('/api/cameras', (req, res) => {
  const config = loadConfig();
  res.json(config.cameras || []);
});

app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// ── State API ──
let sharedState = migrateState(loadState());
// Save migrated state back
if (sharedState) saveState(sharedState);

// Track connected displays
const connectedDisplays = new Map();

app.get('/api/state', (req, res) => {
  res.json(sharedState || {});
});

app.post('/api/state', (req, res) => {
  const clientIp = (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');

  // Block kiosk display clients from overwriting state
  // Only remote controllers and API scripts should change state
  const blockedIps = ['192.168.1.100']; // Proxmox host = kiosk
  if (blockedIps.includes(clientIp)) {
    console.log(`[State] BLOCKED state overwrite from kiosk (${clientIp})`);
    res.json({ ok: false, reason: 'display_client_blocked' });
    return;
  }

  sharedState = req.body;
  saveState(sharedState);
  console.log(`[State] Updated by ${clientIp}`);

  // Broadcast to all connected clients
  broadcastState();
  res.json({ ok: true });
});

// Force-update endpoint (for scripts, cold-start, API)
app.post('/api/state/force', (req, res) => {
  sharedState = req.body;
  saveState(sharedState);
  console.log(`[State] Force-updated by ${req.ip}`);
  broadcastState();
  res.json({ ok: true });
});

function broadcastState() {
  const msg = JSON.stringify({ type: 'state_update', state: sharedState });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

// ── Reload endpoint — tells all connected browsers to hard-refresh ──
app.post('/api/reload', (req, res) => {
  const msg = JSON.stringify({ type: 'reload' });
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
      count++;
    }
  });
  console.log(`[Reload] Sent reload to ${count} clients`);
  res.json({ ok: true, reloaded: count });
});

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    clients: wss.clients.size,
    displays: Object.fromEntries(connectedDisplays),
    stateExists: !!sharedState,
  });
});

// ── Connected displays ──
app.get('/api/displays', (req, res) => {
  res.json(Object.fromEntries(connectedDisplays));
});

// ── WebSocket ──
wss.on('connection', (ws, req) => {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  const url = req.url || '';
  console.log(`[WS] Client connected from ${ip} (${url})`);

  // Track display
  const displayId = `${ip}-${Date.now()}`;
  connectedDisplays.set(displayId, { ip, connectedAt: new Date().toISOString(), url });

  // Send current state immediately
  if (sharedState) {
    ws.send(JSON.stringify({ type: 'state_update', state: sharedState }));
  }

  // Send config so frontend knows cameras/layouts/displays
  const config = loadConfig();
  ws.send(JSON.stringify({ type: 'config', config }));

  // Send current alert immediately
  ws.send(JSON.stringify({ type: 'alert_update', alert: currentAlert }));

  // Handle incoming messages from clients
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Only accept state changes from remote controllers, not display clients
      if (msg.type === 'state_update' && msg.state) {
        const isKiosk = ip === '192.168.1.100';
        if (isKiosk) {
          console.log(`[WS] Blocked state update from kiosk (${ip})`);
          // Send back the server's state to override the client's defaults
          ws.send(JSON.stringify({ type: 'state_update', state: sharedState }));
          return;
        }

        // Accept from remote controllers
        sharedState = msg.state;
        saveState(sharedState);
        console.log(`[WS] State updated via WS by ${ip}`);
        broadcastState();
      }
    } catch (e) {
      console.error(`[WS] Parse error from ${ip}:`, e.message);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error from ${ip}: ${err.message}`);
  });

  ws.on('close', (code, reason) => {
    connectedDisplays.delete(displayId);
    console.log(`[WS] Client disconnected: ${ip} (code=${code}, reason=${reason || 'none'})`);
  });
});


// ── HA Alerts ──
let currentAlert = { level: 'Clear', message: '', timestamp: Date.now() };
let HA_TOKEN = '';
try {
  HA_TOKEN = readFileSync('/opt/display-server/.ha_token', 'utf-8').trim();
} catch (e) {
  console.error('[HA] No .ha_token found', e.message);
}

async function pollHAAlerts() {
  if (!HA_TOKEN) return;
  try {
    const [levelRes, msgRes] = await Promise.all([
      fetch('http://192.168.1.19:8123/api/states/input_select.alert_level', { headers: { Authorization: `Bearer ${HA_TOKEN}` } }),
      fetch('http://192.168.1.19:8123/api/states/input_text.alert_message', { headers: { Authorization: `Bearer ${HA_TOKEN}` } })
    ]);
    const levelData = await levelRes.json();
    const msgData = await msgRes.json();

    const newLevel = levelData.state;
    const newMsg = msgData.state;
    
    if (newLevel !== currentAlert.level || newMsg !== currentAlert.message) {
      currentAlert = { level: newLevel, message: newMsg, timestamp: Date.now() };
      broadcastAlert();
    }
  } catch (err) {
    console.error('[HA] Error polling alerts:', err.message);
  }
}

function broadcastAlert() {
  const msg = JSON.stringify({ type: 'alert_update', alert: currentAlert });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

setInterval(pollHAAlerts, 10000);
pollHAAlerts();

app.get('/api/alerts', (req, res) => {
  res.json(currentAlert);
});

// ── SPA fallback ──
app.get('/{*splat}', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// ── Start ──
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Display Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Display Server] WebSocket at ws://0.0.0.0:${PORT}/ws`);
  console.log(`[Display Server] Remote:  http://192.168.1.114:${PORT}/#remote`);
  const displays = loadConfig().displays || [];
  displays.forEach(d => console.log(`[Display Server] ${d.label}: http://192.168.1.114:${PORT}/#${d.hash || d.id}`));
  console.log(`[Display Server] Config:  cameras.json loaded with ${loadConfig().cameras?.length || 0} cameras, ${displays.length} displays`);
});
