'use strict';

/**
 * pollers/aviation.js
 * ───────────────────
 * Polls:
 *   1. NOAA Aviation Weather Center — SIGMETs & AIRMETs near Hawaii
 *   2. FAA NOTAM API              — NOTAMs for PHNL (Honolulu Intl)
 *
 * SIGMETs → severity SEVERE
 * AIRMETs → severity MODERATE
 * NOTAMs  → severity MINOR (mostly)
 *
 * FAA NOTAM API requires a client_id / client_secret (set in .env).
 * If credentials are missing or the request returns 401, that source is
 * skipped gracefully and an informational log is emitted.
 */

const axios = require('axios');

// ── Hawaii FIR bounding box (approximate) ────────────────────────────────────
const HI_LAT_MIN = 15;
const HI_LAT_MAX = 28;
const HI_LON_MIN = -162;
const HI_LON_MAX = -145;

const AWC_BASE    = 'https://aviationweather.gov/api/data/airsigmet';
const FAA_NOTAM   = 'https://external-api.faa.gov/notamapi/v1/notams';

const ACTION_TEXT = 'Monitor ATIS at 127.9 MHz. Contact Honolulu Approach on 118.3. Check NOTAMs before any flight.';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if a lat/lon point falls within the Hawaii FIR bounding box.
 * AWC items may have a single point or a polygon; we check the first vertex.
 *
 * @param {object} item — AWC airsigmet response item
 */
function isNearHawaii(item) {
  const coords = item.coords ?? [];
  if (coords.length === 0) return true; // no coords → include by default

  // coords is an array of { lat, lon } objects
  const { lat, lon } = coords[0];
  return (
    lat >= HI_LAT_MIN && lat <= HI_LAT_MAX &&
    lon >= HI_LON_MIN && lon <= HI_LON_MAX
  );
}

/**
 * Builds a unique, stable ID for an AWC item.
 * @param {object}  item
 * @param {'sigmet'|'airmet'} type
 */
function awcId(item, type) {
  // AWC items may have an `airSigmetId`, `icaoId`, or we can compose one.
  return `awc_${type}_${item.airSigmetId ?? item.icaoId ?? item.seriesId ?? JSON.stringify(item).slice(0, 32)}`;
}

/**
 * Normalises a single AWC SIGMET or AIRMET item.
 * @param {object}  item
 * @param {'sigmet'|'airmet'} type
 * @returns {object}
 */
function normaliseAwc(item, type) {
  const isSigmet   = type === 'sigmet';
  const severity   = isSigmet ? 'SEVERE' : 'MODERATE';
  const hazard     = item.hazard ?? item.type ?? type.toUpperCase();
  const title      = `${type.toUpperCase()}: ${hazard}`;

  return {
    id:       awcId(item, type),
    category: 'aviation',
    severity,
    title,
    body:     item.rawAirSigmet ?? item.rawText ?? JSON.stringify(item),
    source:   'NOAA AWC',
    issued:   item.validTimeFrom ? new Date(item.validTimeFrom).toISOString() : new Date().toISOString(),
    expires:  item.validTimeTo   ? new Date(item.validTimeTo).toISOString()   : null,
    action:   ACTION_TEXT,
    raw:      item,
  };
}

/**
 * Fetches SIGMETs or AIRMETs from the AWC API.
 * @param {'sigmet'|'airmet'} type
 * @returns {Promise<object[]>} — normalised alerts
 */
async function fetchAwcType(type) {
  try {
    const resp = await axios.get(AWC_BASE, {
      params:  { format: 'json', type },
      timeout: 15_000,
    });

    const items = Array.isArray(resp.data) ? resp.data : (resp.data?.data ?? []);
    return items
      .filter(isNearHawaii)
      .map(item => normaliseAwc(item, type));
  } catch (err) {
    console.error(`[aviation] AWC ${type} fetch failed:`, err.message);
    return [];
  }
}

// ── FAA NOTAMs ────────────────────────────────────────────────────────────────

/**
 * Returns a severity for a FAA NOTAM based on its keyword content.
 * Most NOTAMs are MINOR; runway closures, etc. get MODERATE.
 * @param {object} notam
 */
function notamSeverity(notam) {
  const text = (notam.coreNOTAMData?.notam?.text ?? '').toUpperCase();
  if (/CLSD|CLOSED/.test(text)) return 'MODERATE';
  if (/TFR|TEMPORARY FLIGHT RESTRICTION/.test(text)) return 'MODERATE';
  return 'MINOR';
}

/**
 * Normalises a single FAA NOTAM object.
 * @param {object} notam
 */
function normaliseNotam(notam) {
  const core  = notam.coreNOTAMData?.notam ?? {};
  const id    = core.id ?? notam.id ?? `notam_${Math.random().toString(36).slice(2)}`;
  const text  = core.text ?? JSON.stringify(notam);

  return {
    id:       `faa_notam_${id}`,
    category: 'aviation',
    severity: notamSeverity(notam),
    title:    `NOTAM ${id}`,
    body:     text,
    source:   'FAA',
    issued:   core.issued   ? new Date(core.issued).toISOString()   : new Date().toISOString(),
    expires:  core.effectiveEnd ? new Date(core.effectiveEnd).toISOString() : null,
    action:   ACTION_TEXT,
    raw:      notam,
  };
}

/**
 * Fetches NOTAMs from the FAA API for PHNL.
 * Requires FAA_CLIENT_ID and FAA_CLIENT_SECRET in .env.
 * Returns [] gracefully if credentials are missing or the request fails.
 * @returns {Promise<object[]>}
 */
async function fetchNotams() {
  const clientId     = process.env.FAA_CLIENT_ID;
  const clientSecret = process.env.FAA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // Silently skip on startup; only log once so logs don't flood.
    if (!fetchNotams._warned) {
      console.warn('[aviation] FAA_CLIENT_ID / FAA_CLIENT_SECRET not set — NOTAM polling disabled.');
      fetchNotams._warned = true;
    }
    return [];
  }

  try {
    const resp = await axios.get(FAA_NOTAM, {
      params: { locationIdentifier: 'PHNL', pageSize: 20 },
      headers: {
        client_id:     clientId,
        client_secret: clientSecret,
      },
      timeout: 15_000,
    });

    const items = resp.data?.items ?? [];
    return items.map(normaliseNotam);
  } catch (err) {
    if (err.response?.status === 401) {
      console.warn('[aviation] FAA NOTAM API returned 401 — check credentials.');
    } else {
      console.error('[aviation] FAA NOTAM fetch failed:', err.message);
    }
    return [];
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  /** How often to refresh (10 minutes). */
  interval: 600_000,

  /**
   * Polls AWC SIGMETs, AIRMETs, and FAA NOTAMs concurrently.
   * @returns {Promise<object[]>}
   */
  async poll() {
    const [sigmets, airmets, notams] = await Promise.all([
      fetchAwcType('sigmet'),
      fetchAwcType('airmet'),
      fetchNotams(),
    ]);

    return [...sigmets, ...airmets, ...notams];
  },
};
