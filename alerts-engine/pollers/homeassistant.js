'use strict';

/**
 * pollers/homeassistant.js
 * ────────────────────────
 * Polls specific Home Assistant binary_sensor entities for leak, smoke, and
 * fire events on the home network.
 *
 * HA base: http://192.168.1.19:8123
 * Token:   process.env.HA_TOKEN
 *
 * Polling interval: 10 seconds (house safety is time-critical)
 *
 * Entity state → alert mapping:
 *   'on'          → SEVERE (leak) or EXTREME (smoke / fire)
 *   'unavailable' → MINOR  (device offline warning)
 *   'off'         → no alert (normal state)
 */

const axios = require('axios');

// ── Entity definitions ────────────────────────────────────────────────────────

const LEAK_SENSORS = [
  'binary_sensor.leak_cabana_bathroom_sink',
  'binary_sensor.leak_detector_window_sink',
  'binary_sensor.leak_master_bath',
  'binary_sensor.leak_back_bathroom_sink',
  'binary_sensor.leak_cabana_sink',
  'binary_sensor.leak_laundry_behind_machines',
];

const SMOKE_SENSORS = [
  'binary_sensor.smoke_detector_back_bedroom',
  'binary_sensor.smoke_detector_great_room',
  'binary_sensor.smoke_detector_laundry',
  'binary_sensor.smoke_master_bedroom',
  'binary_sensor.smoke_utility_room',
];

const FIRE_SENSORS = [
  'binary_sensor.fire_back_hallway',
  'binary_sensor.fire_cabana',
  'binary_sensor.fire_office',
];

/** All entities we care about, with their type tag. */
const ALL_ENTITIES = [
  ...LEAK_SENSORS.map(id  => ({ id, type: 'leak'  })),
  ...SMOKE_SENSORS.map(id => ({ id, type: 'smoke' })),
  ...FIRE_SENSORS.map(id  => ({ id, type: 'fire'  })),
];

// ── Per-type alert config ─────────────────────────────────────────────────────
const TYPE_CONFIG = {
  leak: {
    severity: 'SEVERE',
    titleFn:  name => `Water Leak Detected — ${name}`,
    bodyFn:   name => `Leak sensor "${name}" has been triggered.`,
    action:   'Turn off water at the main shutoff valve. Check the affected area. Call a plumber if the source is not immediately obvious.',
  },
  smoke: {
    severity: 'EXTREME',
    titleFn:  name => `Smoke Detected — ${name}`,
    bodyFn:   name => `Smoke detector "${name}" has been triggered.`,
    action:   'Evacuate the house immediately. Call 911. Do not re-enter until the fire department has cleared the building.',
  },
  fire: {
    severity: 'EXTREME',
    titleFn:  name => `Fire Detected — ${name}`,
    bodyFn:   name => `Fire sensor "${name}" has been triggered.`,
    action:   'Evacuate immediately! Call 911. Meet at the agreed family assembly point. Do NOT use elevators.',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Converts an entity_id like 'binary_sensor.leak_master_bath' to a readable
 * display name like 'Leak Master Bath'.
 * @param {string} entityId
 */
function friendlyName(entityId) {
  return entityId
    .replace(/^binary_sensor\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Builds a normalised alert for a triggered sensor.
 * @param {{ id: string, type: string }} entity
 * @param {object} stateObj — HA state object from REST API
 */
function buildTriggeredAlert(entity, stateObj) {
  const cfg  = TYPE_CONFIG[entity.type];
  const name = stateObj.attributes?.friendly_name ?? friendlyName(entity.id);
  const now  = new Date().toISOString();

  return {
    id:       `${entity.id}_triggered`,
    category: 'house',
    severity: cfg.severity,
    title:    cfg.titleFn(name),
    body:     cfg.bodyFn(name),
    source:   'HomeAssistant',
    issued:   stateObj.last_changed ?? now,
    expires:  null,   // stays active until sensor reports 'off'
    action:   cfg.action,
    raw:      stateObj,
  };
}

/**
 * Builds a MINOR alert for an unavailable sensor.
 * @param {{ id: string, type: string }} entity
 * @param {object} stateObj
 */
function buildUnavailableAlert(entity, stateObj) {
  const name = stateObj.attributes?.friendly_name ?? friendlyName(entity.id);
  const now  = new Date().toISOString();

  return {
    id:       `${entity.id}_offline`,
    category: 'house',
    severity: 'MINOR',
    title:    `Sensor Offline — ${name}`,
    body:     `Safety sensor "${name}" is reporting as unavailable. Its status cannot be confirmed.`,
    source:   'HomeAssistant',
    issued:   stateObj.last_changed ?? now,
    expires:  null,
    action:   'Check the sensor battery and connectivity. Replace or reposition if needed.',
    raw:      stateObj,
  };
}

// ── Main poller ───────────────────────────────────────────────────────────────

/**
 * Fetches the state of a single entity from the HA REST API.
 * Returns null if the request fails (HTTP error, timeout, etc.).
 * @param {string} entityId
 * @param {string} baseUrl
 * @param {string} token
 * @returns {Promise<object|null>}
 */
async function fetchState(entityId, baseUrl, token) {
  try {
    const resp = await axios.get(`${baseUrl}/api/states/${entityId}`, {
      timeout: 8_000,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return resp.data;
  } catch (err) {
    if (err.response?.status === 404) {
      // Entity doesn't exist in this HA instance — log once, don't spam.
      if (!fetchState._notFound) fetchState._notFound = new Set();
      if (!fetchState._notFound.has(entityId)) {
        console.warn(`[homeassistant] Entity not found: ${entityId}`);
        fetchState._notFound.add(entityId);
      }
    } else {
      console.error(`[homeassistant] Failed to fetch ${entityId}:`, err.message);
    }
    return null;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  /** How often to refresh (10 seconds — house safety is time-critical). */
  interval: 10_000,

  /**
   * Polls all defined binary sensors and returns alerts for any that are
   * triggered or unavailable.
   * @returns {Promise<object[]>}
   */
  async poll() {
    const haUrl   = process.env.HA_URL   ?? 'http://192.168.1.19:8123';
    const haToken = process.env.HA_TOKEN ?? '';

    if (!haToken) {
      if (!module.exports.poll._warnedToken) {
        console.warn('[homeassistant] HA_TOKEN not set — Home Assistant polling disabled.');
        module.exports.poll._warnedToken = true;
      }
      return [];
    }

    // Fetch all entity states concurrently.
    const results = await Promise.all(
      ALL_ENTITIES.map(async entity => {
        const stateObj = await fetchState(entity.id, haUrl, haToken);
        if (!stateObj) return null;

        const state = stateObj.state;

        if (state === 'on')          return buildTriggeredAlert(entity, stateObj);
        if (state === 'unavailable') return buildUnavailableAlert(entity, stateObj);
        return null; // 'off' — no alert
      })
    );

    return results.filter(Boolean);
  },
};
