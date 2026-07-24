'use strict';

/**
 * pollers/marine.js
 * ─────────────────
 * Polls the NOAA Weather API for active alerts in Hawaii.
 *
 * Data source: https://api.weather.gov/alerts/active?area=HI
 *
 * Handles:
 *   - Marine warnings / advisories  → category: 'marine'
 *   - Tsunami alerts                → category: 'tsunami'
 *   - Beach / surf hazards          → category: 'beach'
 */

const axios = require('axios');

const NOAA_URL = 'https://api.weather.gov/alerts/active?area=HI';

// ── Severity + category map ───────────────────────────────────────────────────
// Each entry: [severity, category, actionKey]
const EVENT_MAP = {
  // Tsunami
  'Tsunami Warning':           ['EXTREME',  'tsunami', 'tsunami_warning'],
  'Tsunami Watch':             ['SEVERE',   'tsunami', 'tsunami_watch'],
  'Tsunami Advisory':          ['MODERATE', 'tsunami', 'tsunami_advisory'],
  'Tsunami Information':       ['MINOR',    'tsunami', 'tsunami_info'],

  // Marine
  'Special Marine Warning':    ['SEVERE',   'marine',  'marine_rough'],
  'Gale Warning':              ['SEVERE',   'marine',  'marine_rough'],
  'Storm Warning':             ['SEVERE',   'marine',  'marine_rough'],
  'Hurricane Force Wind Warning': ['EXTREME', 'marine', 'marine_extreme'],
  'Small Craft Advisory':      ['MODERATE', 'marine',  'small_craft'],
  'Small Craft Advisory for Rough Bar': ['MODERATE', 'marine', 'small_craft'],
  'Dense Fog Advisory':        ['MINOR',    'marine',  'marine_minor'],
  'Hazardous Seas Warning':    ['SEVERE',   'marine',  'marine_rough'],
  'Hazardous Seas Watch':      ['MODERATE', 'marine',  'marine_rough'],

  // Beach / surf
  'High Surf Warning':         ['SEVERE',   'beach',   'high_surf'],
  'High Surf Advisory':        ['MODERATE', 'beach',   'high_surf'],
  'Beach Hazards Statement':   ['MODERATE', 'beach',   'beach_hazard'],
  'Rip Current Statement':     ['MODERATE', 'beach',   'rip_current'],
};

// ── Action text ───────────────────────────────────────────────────────────────
const ACTIONS = {
  tsunami_warning:  'Evacuate immediately to high ground. Go to Zone A evacuation routes now. Do not wait for official word — move now.',
  tsunami_watch:    'Be ready to evacuate. Monitor official sources. Move valuables and pets upstairs or to higher ground.',
  tsunami_advisory: 'Stay away from the shore, harbors, and low-lying coastal areas. Strong currents may persist for hours.',
  tsunami_info:     'Stay informed. No immediate threat but monitor NWS Pacific Tsunami Warning Center for updates.',
  marine_rough:     'Do not go out to sea. Small vessels should remain in port. Secure all boats and dock lines.',
  marine_extreme:   'All marine activity should cease immediately. Seek shelter in a sturdy structure well away from the coast.',
  marine_minor:     'Use caution on the water. Ensure navigation lights are working. Travel with a buddy vessel.',
  small_craft:      'Small boats should remain in port. Check full marine forecast before departing. File a float plan.',
  high_surf:        'Stay off rocks and beaches. Dangerous shore break and rip currents likely. Sneaker waves can occur unexpectedly.',
  beach_hazard:     'Heed lifeguard warnings and posted flags. Avoid swimming near rocks or piers. Buddy swim only.',
  rip_current:      'If caught in a rip current, swim parallel to shore until free, then swim diagonally back to the beach.',
};

// Default action for unmapped event types.
const DEFAULT_ACTION = 'Monitor official alerts. Follow guidance from local emergency management.';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Maps a NOAA event string to { severity, category, action }.
 * Falls back to MINOR / marine for unrecognised marine-ish events.
 * @param {string} event
 */
function classifyEvent(event) {
  const mapped = EVENT_MAP[event];
  if (mapped) {
    const [severity, category, actionKey] = mapped;
    return { severity, category, action: ACTIONS[actionKey] ?? DEFAULT_ACTION };
  }

  // Heuristic fallback for unrecognised NOAA event types.
  const lower = event.toLowerCase();
  if (lower.includes('tsunami'))      return { severity: 'MODERATE', category: 'tsunami', action: ACTIONS.tsunami_info };
  if (lower.includes('surf') || lower.includes('beach') || lower.includes('rip'))
                                       return { severity: 'MINOR',    category: 'beach',   action: ACTIONS.beach_hazard };
  if (lower.includes('marine') || lower.includes('gale') || lower.includes('seas') || lower.includes('craft'))
                                       return { severity: 'MINOR',    category: 'marine',  action: ACTIONS.marine_minor };

  return { severity: 'MINOR', category: 'marine', action: DEFAULT_ACTION };
}

/**
 * Converts a NOAA alert feature to our normalised alert object.
 * @param {object} feature — GeoJSON Feature from NOAA /alerts endpoint
 * @returns {object}
 */
function normalise(feature) {
  const p = feature.properties;
  const { severity, category, action } = classifyEvent(p.event ?? '');

  return {
    id:       p.id,
    category,
    severity,
    title:    p.headline ?? p.event ?? 'NOAA Alert',
    body:     p.description ?? p.event ?? '',
    source:   'NOAA',
    issued:   p.sent ?? p.effective ?? new Date().toISOString(),
    expires:  p.expires ?? null,
    action,
    raw:      feature,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  /** How often to refresh (5 minutes). */
  interval: 300_000,

  /**
   * Fetches active NOAA alerts for Hawaii and returns normalised alert objects.
   * @returns {Promise<object[]>}
   */
  async poll() {
    const resp = await axios.get(NOAA_URL, {
      timeout: 15_000,
      headers: {
        'User-Agent': 'HawaiiHomeAlerts/1.0 (gavin@localhost)',
        Accept: 'application/geo+json',
      },
    });

    const features = resp.data?.features ?? [];
    return features.map(normalise);
  },
};
