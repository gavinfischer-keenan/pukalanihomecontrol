'use strict';

/**
 * server.js — Hawaii Alerts Engine
 * ─────────────────────────────────
 * Aggregates real-time alerts from multiple sources (NOAA, FAA, Hawaii Ocean
 * Safety, Home Assistant) and exposes them via a simple REST API.
 *
 * Container: Proxmox LXC CT 109 @ 192.168.1.109:3009
 */

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

// ── Pollers ───────────────────────────────────────────────────────────────────
const marinePoller       = require('./pollers/marine');
const aviationPoller     = require('./pollers/aviation');
const beachPoller        = require('./pollers/beach');
const homeassistantPoller = require('./pollers/homeassistant');

const POLLERS = [
  { name: 'marine',        poller: marinePoller       },
  { name: 'aviation',      poller: aviationPoller     },
  { name: 'beach',         poller: beachPoller        },
  { name: 'homeassistant', poller: homeassistantPoller },
];

// ── Severity ordering (highest = 0) ──────────────────────────────────────────
const SEVERITY_ORDER = { EXTREME: 0, SEVERE: 1, MODERATE: 2, MINOR: 3, UNKNOWN: 4 };

// ── In-memory alert store ─────────────────────────────────────────────────────
/** @type {Map<string, object>} keyed by alert.id */
const alertStore = new Map();

let lastUpdate = null;

// ── Poller runner ─────────────────────────────────────────────────────────────

/**
 * Runs a single poller, merges returned alerts into the store, and schedules
 * the next run.  Errors are caught so a bad poller never brings down the
 * server.
 *
 * @param {string} name
 * @param {{ poll: () => Promise<object[]>, interval: number }} poller
 */
async function runPoller(name, poller) {
  try {
    const alerts = await poller.poll();
    const now    = new Date();

    // Remove stale alerts that originated from this poller and are no longer
    // being returned (they may have expired or been cancelled).
    const freshIds = new Set(alerts.map(a => a.id));
    for (const [id, alert] of alertStore) {
      // Only evict alerts that belong to this poller's source.
      if (alert._pollerName === name && !freshIds.has(id)) {
        alertStore.delete(id);
      }
    }

    // Merge fresh alerts.
    for (const alert of alerts) {
      alertStore.set(alert.id, { ...alert, _pollerName: name });
    }

    lastUpdate = now.toISOString();
    console.log(`[${now.toISOString()}] [${name}] polled OK — ${alerts.length} alert(s)`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] [${name}] poll error:`, err.message);
  }

  // Schedule next run.
  setTimeout(() => runPoller(name, poller), poller.interval);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns all non-expired alerts sorted by severity then issued date (newest
 * first within the same severity).
 */
function getActiveAlerts() {
  const now = Date.now();
  return [...alertStore.values()]
    .filter(a => {
      if (!a.expires) return true;            // no expiry → always active
      return new Date(a.expires).getTime() > now;
    })
    .sort((a, b) => {
      const sA = SEVERITY_ORDER[a.severity] ?? 4;
      const sB = SEVERITY_ORDER[b.severity] ?? 4;
      if (sA !== sB) return sA - sB;
      // Within same severity: newest issued first.
      return new Date(b.issued).getTime() - new Date(a.issued).getTime();
    });
}

/**
 * Counts active alerts per category.
 * @returns {{ marine: number, aviation: number, beach: number, house: number, tsunami: number }}
 */
function getCounts(alerts) {
  const counts = { marine: 0, aviation: 0, beach: 0, house: 0, tsunami: 0 };
  for (const a of alerts) {
    if (counts[a.category] !== undefined) counts[a.category]++;
  }
  return counts;
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

app.use(cors());            // open to all origins — internal network service
app.use(express.json());

// GET /api/health
app.get('/api/health', (_req, res) => {
  const active = getActiveAlerts();
  res.json({
    ok:         true,
    counts:     getCounts(active),
    lastUpdate: lastUpdate,
  });
});

// GET /api/alerts
app.get('/api/alerts', (_req, res) => {
  res.json(getActiveAlerts());
});

// GET /api/alerts/:category
app.get('/api/alerts/:category', (req, res) => {
  const { category } = req.params;
  const valid = ['marine', 'aviation', 'beach', 'house', 'tsunami'];
  if (!valid.includes(category)) {
    return res.status(400).json({ error: `Unknown category: ${category}. Valid: ${valid.join(', ')}` });
  }
  res.json(getActiveAlerts().filter(a => a.category === category));
});

// ── Startup ───────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3009', 10);

app.listen(PORT, () => {
  console.log(`[alerts-engine] Listening on port ${PORT}`);
  console.log('[alerts-engine] Starting all pollers...');

  for (const { name, poller } of POLLERS) {
    // Fire immediately then schedule on the poller's own interval.
    runPoller(name, poller);
  }
});
