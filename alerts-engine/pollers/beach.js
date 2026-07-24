'use strict';

/**
 * pollers/beach.js
 * ────────────────
 * Fetches current ocean conditions from Hawaii Ocean Safety (SOEST).
 *
 * Primary URL:   https://oceansafety.soest.hawaii.edu/api/conditions/
 * Fallback URL:  https://oceansafety.soest.hawaii.edu/api/current/
 *
 * If both endpoints fail, returns [] so other pollers keep working.
 *
 * risk_level mapping:
 *   >= 4 → SEVERE
 *   == 3 → MODERATE
 *   < 3  → skipped (not alert-worthy)
 */

const axios = require('axios');
const { createHash } = require('crypto');

const PRIMARY_URL  = 'https://oceansafety.soest.hawaii.edu/api/conditions/';
const FALLBACK_URL = 'https://oceansafety.soest.hawaii.edu/api/current/';

const ACTION_TEXT = 'Check with lifeguards before entering water. Observe posted warning flags. When in doubt, stay out.';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generates a stable ID for a beach condition entry from its location name and
 * the current date (so it rotates daily but is stable within a day).
 * @param {object} entry
 */
function beachId(entry) {
  const location = entry.location ?? entry.beach ?? entry.name ?? 'unknown';
  const day      = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return 'beach_' + createHash('sha1').update(`${location}:${day}`).digest('hex').slice(0, 12);
}

/**
 * Converts a risk_level number to our severity string.
 * @param {number} level
 */
function riskToSeverity(level) {
  if (level >= 4) return 'SEVERE';
  if (level >= 3) return 'MODERATE';
  return null; // not alert-worthy
}

/**
 * Normalises a single ocean-safety condition entry into an alert object.
 * Returns null for entries below the alert threshold.
 * @param {object} entry
 */
function normalise(entry) {
  const riskLevel = parseInt(entry.risk_level ?? entry.riskLevel ?? entry.risk ?? '0', 10);
  const severity  = riskToSeverity(riskLevel);

  if (!severity) return null; // below threshold

  const location = entry.location ?? entry.beach ?? entry.name ?? 'Hawaii Beach';
  const hazard   = entry.hazard   ?? entry.condition ?? entry.description ?? 'Hazardous conditions';

  return {
    id:       beachId(entry),
    category: 'beach',
    severity,
    title:    `Beach Hazard — ${location}`,
    body:     `${hazard} (Risk Level: ${riskLevel}/5)`,
    source:   'Hawaii Ocean Safety',
    issued:   entry.updated ?? entry.date ?? new Date().toISOString(),
    expires:  null,   // conditions change daily; we poll hourly
    action:   ACTION_TEXT,
    raw:      entry,
  };
}

/**
 * Tries to fetch from a URL.  Returns the response data array or null if the
 * request fails.
 * @param {string} url
 * @returns {Promise<object[]|null>}
 */
async function tryFetch(url) {
  try {
    const resp = await axios.get(url, { timeout: 20_000 });
    // Accept both an array at the root and { data: [...] } style responses.
    if (Array.isArray(resp.data))       return resp.data;
    if (Array.isArray(resp.data?.data)) return resp.data.data;
    if (Array.isArray(resp.data?.conditions)) return resp.data.conditions;
    // Unknown shape — log and treat as empty.
    console.warn('[beach] Unexpected response shape from', url, ':', typeof resp.data);
    return [];
  } catch (err) {
    // 404 expected for wrong endpoint; anything else is also tolerated.
    if (err.response?.status !== 404) {
      console.error(`[beach] Fetch error for ${url}:`, err.message);
    }
    return null;
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  /** How often to refresh (1 hour — daily conditions change slowly). */
  interval: 3_600_000,

  /**
   * Fetches Hawaii ocean conditions and returns alert objects for hazardous
   * locations.  Attempts the primary URL first; falls back to secondary.
   * @returns {Promise<object[]>}
   */
  async poll() {
    let entries = await tryFetch(PRIMARY_URL);

    if (entries === null) {
      console.info('[beach] Primary URL failed — trying fallback...');
      entries = await tryFetch(FALLBACK_URL);
    }

    if (entries === null) {
      console.warn('[beach] Both Ocean Safety endpoints unavailable — returning []');
      return [];
    }

    return entries
      .map(normalise)
      .filter(Boolean); // remove null (below-threshold) entries
  },
};
