/**
 * displayConfig.js — Single source of truth for display system constants.
 * All coordinates, URLs, and defaults live here — no hard-coding in components.
 */

// Home position — 3786 Pukalani Pl (from architecture.md)
export const HOME_BASE = {
  lat: 21.2861516,
  lon: -157.7935187,
  label: '3786 Pukalani Pl',
};

// Dashboard base URL (CT108)
export const DASHBOARD_URL = 'http://192.168.1.108:8080';

// Default vessel tracker settings
export const VESSEL_DEFAULTS = {
  zoom: 10,
  center: `${HOME_BASE.lat},${HOME_BASE.lon}`,
};

// View definitions — labels for the Remote UI
export const VIEW_REGISTRY = [
  { id: 'cams',         label: '📹 Camera Grid' },
  { id: 'vessels',      label: '🚢 Vessel Tracker' },
  { id: 'weather',      label: '🌤️ Weather Loops' },
  { id: 'house_status', label: '🏠 House Status (Coming Soon)' },
];

// Map center presets for the vessel tracker UI
export const CENTER_PRESETS = [
  { id: 'home',  label: 'Home — Pukalani',  lat: HOME_BASE.lat, lon: HOME_BASE.lon },
  { id: 'oahu',  label: 'Oahu Center',      lat: 21.3069,       lon: -157.8583 },
];
