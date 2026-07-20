/**
 * static-server.js — serves the multi-page Hawaii Command Center
 * Lives at /opt/dashboard/server/ alongside server.js (shares express dep)
 *
 * Routes:
 *   /nws*    → /opt/dashboard/client/dist/nws.html  (NWS/NOAA app)
 *   /assets* → /opt/dashboard/client/dist/assets/   (Vite bundles)
 *   /*       → /opt/dashboard/client/dist/index.html (Vessel map)
 */
'use strict';

const express = require('express');
const path    = require('path');

const PORT = process.env.STATIC_PORT || 8080;
const DIST  = path.join(__dirname, '..', 'client', 'dist');

const app = express();

// Static assets (JS, CSS, fonts, images) — long cache for immutable assets
app.use(express.static(DIST, {
  index: false,
  setHeaders: (res, filePath) => {
    if (/\/assets\//.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// /nws  and /nws/ and /nws/anything  → NWS standalone app
app.use('/nws', (_req, res) => {
  res.sendFile(path.join(DIST, 'nws.html'));
});

// Everything else → vessel/aviation map
app.use((_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[static] Hawaii CC listening on :${PORT}`);
  console.log(`[static]   Vessel/Aviation → http://0.0.0.0:${PORT}/`);
  console.log(`[static]   NWS/NOAA        → http://0.0.0.0:${PORT}/nws`);
});
