import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
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

// ── JSON parsing ──
app.use(express.json({ limit: '1mb' }));

// ── Reverse proxy routes (BEFORE static serving) ──
// tar1090 — our own ADS-B radar at CT102 (AIRCRAFT ONLY)
app.use('/proxy/tar1090', createProxyMiddleware({
  target: 'http://192.168.1.102',
  changeOrigin: true,
  pathRewrite: { '^/proxy/tar1090': '' },
  ws: true,
}));

// CT108 Integrated Dashboard — has BOTH AIS vessels + ADS-B aircraft + range rings + radar + tides + weather
app.use('/proxy/dashboard', createProxyMiddleware({
  target: 'http://192.168.1.108:8080',
  changeOrigin: true,
  pathRewrite: { '^/proxy/dashboard': '' },
}));

// CT108 Dashboard API (PostGIS queries, vessel data, weather, etc.)
app.use('/proxy/dashboard-api', createProxyMiddleware({
  target: 'http://192.168.1.108:3001',
  changeOrigin: true,
  pathRewrite: { '^/proxy/dashboard-api': '' },
}));

// Frigate NVR API at CT113
app.use('/proxy/frigate', createProxyMiddleware({
  target: 'http://192.168.1.113:5000',
  changeOrigin: true,
  pathRewrite: { '^/proxy/frigate': '' },
}));

// go2rtc WebRTC streaming at CT113 — for live video to kiosk displays
app.use('/proxy/go2rtc', createProxyMiddleware({
  target: 'http://192.168.1.113:1984',
  changeOrigin: true,
  pathRewrite: { '^/proxy/go2rtc': '' },
  ws: true,
}));

// BirdNET Go API at CT112
app.use('/proxy/birdnet', createProxyMiddleware({
  target: 'http://192.168.1.112:8080',
  changeOrigin: true,
  pathRewrite: { '^/proxy/birdnet': '' },
}));

// ── Static files (Vite build) ──
app.use(express.static(join(__dirname, 'dist')));

// ── State API ──
let sharedState = loadState();

app.get('/api/state', (req, res) => {
  res.json(sharedState || {});
});

app.post('/api/state', (req, res) => {
  sharedState = req.body;
  saveState(sharedState);
  
  // Broadcast to all connected display clients
  const msg = JSON.stringify({ type: 'state_update', state: sharedState });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
  res.json({ ok: true });
});

// ── Reload endpoint (for deploy automation) ──
app.post('/api/reload', (req, res) => {
  const msg = JSON.stringify({ type: 'reload' });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
  res.json({ ok: true, reloaded: wss.clients.size });
});

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    clients: wss.clients.size,
    stateExists: !!sharedState,
  });
});

// ── WebSocket: on connect, send current state ──
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] Client connected from ${ip}`);
  if (sharedState) {
    ws.send(JSON.stringify({ type: 'state_update', state: sharedState }));
  }
  ws.on('close', () => console.log(`[WS] Client disconnected: ${ip}`));
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
  console.log(`[Display Server] Proxies: tar1090→CT102, frigate→CT113, birdnet→CT112, go2rtc→CT113`);
  console.log(`[Display Server] Remote:  http://192.168.1.114:${PORT}/#remote`);
  console.log(`[Display Server] Corner:  http://192.168.1.114:${PORT}/#corner`);
  console.log(`[Display Server] Main TV: http://192.168.1.114:${PORT}/#maintv`);
});
