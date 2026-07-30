/**
 * display-server.test.js — Comprehensive test suite for the display system.
 * Tests cover: config, state migration, view registry, reload pipeline, API endpoints.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load config ──
function loadConfig() {
  return JSON.parse(readFileSync(join(ROOT, 'cameras.json'), 'utf-8'));
}

// ── Load display config constants ──
const displayConfigSrc = readFileSync(join(ROOT, 'src', 'displayConfig.js'), 'utf-8');

// ── Inline migrateState for testing ──
function migrateState(state) {
  if (!state) return state;
  const cleaned = { ...state };
  delete cleaned.birdnetDetections;
  const deletedViews = new Set(['birdnet', 'aircraft']);
  for (const key of Object.keys(cleaned)) {
    if (key.endsWith('SlotMappings') && typeof cleaned[key] === 'object') {
      const mappings = { ...cleaned[key] };
      for (const [slot, viewId] of Object.entries(mappings)) {
        if (deletedViews.has(viewId)) {
          mappings[slot] = '';
        }
      }
      cleaned[key] = mappings;
    }
  }
  return cleaned;
}

// ════════════════════════════════════════════════════════════════
// Config Tests
// ════════════════════════════════════════════════════════════════
describe('cameras.json config', () => {
  const config = loadConfig();

  it('has a displays array', () => {
    expect(config.displays).toBeDefined();
    expect(Array.isArray(config.displays)).toBe(true);
    expect(config.displays.length).toBeGreaterThanOrEqual(2);
  });

  it('each display has required fields', () => {
    for (const d of config.displays) {
      expect(d.id).toBeTruthy();
      expect(d.label).toBeTruthy();
      expect(d.resolution).toBeTruthy();
    }
  });

  it('display IDs are unique', () => {
    const ids = config.displays.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has cameras array with active cameras', () => {
    expect(config.cameras).toBeDefined();
    const active = config.cameras.filter(c => c.active);
    expect(active.length).toBeGreaterThan(0);
  });

  it('has layouts with valid slot arrays', () => {
    expect(config.layouts.length).toBeGreaterThan(0);
    for (const l of config.layouts) {
      expect(l.id).toBeTruthy();
      expect(l.label).toBeTruthy();
      expect(Array.isArray(l.slots)).toBe(true);
      expect(l.slots.length).toBeGreaterThan(0);
    }
  });

  it('views contain no deleted views (birdnet, aircraft)', () => {
    const viewIds = config.views.map(v => v.id);
    expect(viewIds).not.toContain('birdnet');
    expect(viewIds).not.toContain('aircraft');
  });

  it('defaults reference only valid views', () => {
    const viewIds = new Set(config.views.map(v => v.id));
    for (const [displayId, defaults] of Object.entries(config.defaults || {})) {
      for (const [slot, viewId] of Object.entries(defaults.slotMappings || {})) {
        expect(viewIds.has(viewId)).toBe(true);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════
// Display Config Constants
// ════════════════════════════════════════════════════════════════
describe('displayConfig.js constants', () => {
  it('exports HOME_BASE with correct Pukalani coordinates', () => {
    // 3786 Pukalani Pl coordinates
    expect(displayConfigSrc).toContain('21.2861516');
    expect(displayConfigSrc).toContain('-157.7935187');
  });

  it('exports DASHBOARD_URL pointing to CT108', () => {
    expect(displayConfigSrc).toContain('http://192.168.1.108:8080');
  });

  it('exports VIEW_REGISTRY without deleted views', () => {
    expect(displayConfigSrc).not.toContain("id: 'birdnet'");
    expect(displayConfigSrc).not.toContain("id: 'aircraft'");
  });

  it('exports CENTER_PRESETS with home and oahu', () => {
    expect(displayConfigSrc).toContain('Home');
    expect(displayConfigSrc).toContain('Oahu');
  });
});

// ════════════════════════════════════════════════════════════════
// State Migration
// ════════════════════════════════════════════════════════════════
describe('state migration', () => {
  it('removes birdnetDetections', () => {
    const dirty = { birdnetDetections: [{ species: 'test' }], mainTvLayoutMode: '1-up' };
    const clean = migrateState(dirty);
    expect(clean.birdnetDetections).toBeUndefined();
    expect(clean.mainTvLayoutMode).toBe('1-up');
  });

  it('clears slot mappings referencing birdnet', () => {
    const dirty = {
      cornerSlotMappings: { slotA: 'vessels', slotB: 'birdnet' },
    };
    const clean = migrateState(dirty);
    expect(clean.cornerSlotMappings.slotA).toBe('vessels');
    expect(clean.cornerSlotMappings.slotB).toBe('');
  });

  it('clears slot mappings referencing aircraft', () => {
    const dirty = {
      mainTvSlotMappings: { slotA: 'aircraft' },
    };
    const clean = migrateState(dirty);
    expect(clean.mainTvSlotMappings.slotA).toBe('');
  });

  it('preserves valid state', () => {
    const valid = {
      mainTvLayoutMode: '1-up',
      mainTvSlotMappings: { slotA: 'cams' },
      mainTvSlotConfigs: { slotA: { selectedCameras: ['cam1'] } },
    };
    const clean = migrateState(valid);
    expect(clean).toEqual(valid);
  });

  it('handles null state', () => {
    expect(migrateState(null)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
// View Registry
// ════════════════════════════════════════════════════════════════
describe('viewRegistry', () => {
  const registrySrc = readFileSync(join(ROOT, 'src', 'viewRegistry.jsx'), 'utf-8');

  it('exists as a separate module', () => {
    expect(registrySrc).toBeTruthy();
  });

  it('imports all view components', () => {
    expect(registrySrc).toContain("import CameraGrid from");
    expect(registrySrc).toContain("import VesselView from");
    expect(registrySrc).toContain("import WeatherView from");
  });

  it('does not contain deleted views', () => {
    expect(registrySrc).not.toContain('BirdNet');
    expect(registrySrc).not.toContain('Aircraft');
  });

  it('exports a default object', () => {
    expect(registrySrc).toContain('export default viewComponentMap');
  });
});

// ════════════════════════════════════════════════════════════════
// Component Architecture
// ════════════════════════════════════════════════════════════════
describe('component architecture', () => {
  const displayViewSrc = readFileSync(join(ROOT, 'src', 'components', 'DisplayView.jsx'), 'utf-8');
  const cycleViewSrc = readFileSync(join(ROOT, 'src', 'components', 'CycleView.jsx'), 'utf-8');
  const vesselViewSrc = readFileSync(join(ROOT, 'src', 'components', 'VesselView.jsx'), 'utf-8');
  const remoteCtrlSrc = readFileSync(join(ROOT, 'src', 'components', 'RemoteController.jsx'), 'utf-8');

  it('DisplayView uses shared viewRegistry', () => {
    expect(displayViewSrc).toContain("from '../viewRegistry.jsx'");
    expect(displayViewSrc).not.toContain('const viewComponentMap = {');
  });

  it('CycleView uses shared viewRegistry', () => {
    expect(cycleViewSrc).toContain("from '../viewRegistry.jsx'");
    expect(cycleViewSrc).not.toContain('const viewComponentMap = {');
  });

  it('VesselView reads config for zoom/center (no hard-coded zoom)', () => {
    expect(vesselViewSrc).toContain('config?.vesselZoom');
    expect(vesselViewSrc).toContain('VESSEL_DEFAULTS');
    // Should NOT contain hard-coded zoom levels
    expect(vesselViewSrc).not.toMatch(/zoom\s*=\s*1[0-5]\s*;/);
  });

  it('VesselView uses DASHBOARD_URL from config', () => {
    expect(vesselViewSrc).toContain('DASHBOARD_URL');
    expect(vesselViewSrc).not.toContain('192.168.1.108:8080');
  });

  it('RemoteController renders displays dynamically', () => {
    expect(remoteCtrlSrc).toContain('config?.displays');
    expect(remoteCtrlSrc).toContain('displays.map');
    // Should NOT hard-code display names
    expect(remoteCtrlSrc).not.toContain("renderDisplaySection('Main TV'");
  });

  it('RemoteController has vessel zoom/center UI', () => {
    expect(remoteCtrlSrc).toContain('vesselZoom');
    expect(remoteCtrlSrc).toContain('vesselCenter');
    expect(remoteCtrlSrc).toContain('CENTER_PRESETS');
  });
});

// ════════════════════════════════════════════════════════════════
// Reload Pipeline
// ════════════════════════════════════════════════════════════════
describe('reload pipeline', () => {
  const hookSrc = readFileSync(join(ROOT, 'src', 'hooks', 'useDisplayState.js'), 'utf-8');
  const serverSrc = readFileSync(join(ROOT, 'server.js'), 'utf-8');

  it('useDisplayState handles reload WS message', () => {
    expect(hookSrc).toContain("msg.type === 'reload'");
    expect(hookSrc).toContain('window.location.reload');
  });

  it('server sets no-cache headers on JS/CSS', () => {
    expect(serverSrc).toContain('Cache-Control');
    expect(serverSrc).toContain('no-cache');
  });

  it('server reload endpoint sends to all clients', () => {
    expect(serverSrc).toContain("type: 'reload'");
    expect(serverSrc).toContain('wss.clients.forEach');
  });
});

// ════════════════════════════════════════════════════════════════
// Server Features
// ════════════════════════════════════════════════════════════════
describe('server.js features', () => {
  const serverSrc = readFileSync(join(ROOT, 'server.js'), 'utf-8');

  it('has state migration on startup', () => {
    expect(serverSrc).toContain('migrateState');
  });

  it('blocks kiosk IP from state writes', () => {
    expect(serverSrc).toContain('192.168.1.100');
    expect(serverSrc).toContain('display_client_blocked');
  });

  it('sends config with displays to WS clients', () => {
    expect(serverSrc).toContain("type: 'config'");
    expect(serverSrc).toContain('loadConfig()');
  });
});
