/**
 * static-server.js — serves the multi-page Hawaii Command Center
 *
 * Routes:
 *   /nws*          → dist/nws.html  (NWS/NOAA standalone app)
 *   /assets/*      → dist/assets/   (shared Vite bundles)
 *   /*             → dist/index.html (Vessel / Aviation map)
 */
'use strict';

const express = require('express');
const path    = require('path');

const PORT = process.env.PORT || 8080;
const DIST  = path.join(__dirname, 'dist');

const app = express();

// Serve all static assets (JS, CSS, images, etc.) directly
app.use(express.static(DIST, { index: false }));

// /nws  and  /nws/ and /nws/anything  → NWS standalone app
app.get(['/nws', '/nws/', '/nws/*'], (_req, res) => {
  res.sendFile(path.join(DIST, 'nws.html'));
});

// Everything else → vessel/aviation map
app.get('*', (_req, res) => {
  res.sendFile(path.join(DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Hawaii Command Center static server listening on :${PORT}`);
  console.log(`  Vessel map → http://0.0.0.0:${PORT}/`);
  console.log(`  NWS/NOAA   → http://0.0.0.0:${PORT}/nws`);
});
