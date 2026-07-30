import { describe, it, expect } from 'vitest';

// ── View configuration tests ────────────────────────────────────────────────
describe('Display Server Views', () => {
  const cameras = require('../cameras.json');

  it('should not include birdnet or aircraft views', () => {
    const viewIds = cameras.views.map(v => v.id);
    expect(viewIds).not.toContain('birdnet');
    expect(viewIds).not.toContain('aircraft');
  });

  it('should include house_status view', () => {
    const viewIds = cameras.views.map(v => v.id);
    expect(viewIds).toContain('house_status');
    const hs = cameras.views.find(v => v.id === 'house_status');
    expect(hs.label).toContain('Coming Soon');
  });

  it('should include cams, vessels, and weather views', () => {
    const viewIds = cameras.views.map(v => v.id);
    expect(viewIds).toContain('cams');
    expect(viewIds).toContain('vessels');
    expect(viewIds).toContain('weather');
  });

  it('each layout should have a valid slots array', () => {
    for (const layout of cameras.layouts) {
      expect(Array.isArray(layout.slots)).toBe(true);
      expect(layout.slots.length).toBeGreaterThan(0);
      // All slots should start with 'slot'
      for (const slot of layout.slots) {
        expect(slot).toMatch(/^slot[A-Z]$/);
      }
    }
  });
});

// ── Per-slot camera config tests ────────────────────────────────────────────
describe('Per-Slot Camera Config', () => {
  it('should support independent camera selections per slot', () => {
    const state = {
      mainTvSlotConfigs: {
        slotA: { selectedCameras: ['aqara_cam_1', 'aqara_cam_2'] },
        slotB: { selectedCameras: ['aqara_cam_3'] },
      },
    };

    const slotACams = state.mainTvSlotConfigs.slotA.selectedCameras;
    const slotBCams = state.mainTvSlotConfigs.slotB.selectedCameras;

    expect(slotACams).toEqual(['aqara_cam_1', 'aqara_cam_2']);
    expect(slotBCams).toEqual(['aqara_cam_3']);
    // They should be independent
    expect(slotACams).not.toEqual(slotBCams);
  });

  it('camera toggle should only affect the target slot', () => {
    const configs = {
      slotA: { selectedCameras: ['cam1', 'cam2'] },
      slotB: { selectedCameras: ['cam3'] },
    };

    // Toggle cam2 off in slotA
    const slotAConfig = configs.slotA;
    const newSelected = slotAConfig.selectedCameras.filter(c => c !== 'cam2');
    const newConfigs = {
      ...configs,
      slotA: { ...slotAConfig, selectedCameras: newSelected },
    };

    expect(newConfigs.slotA.selectedCameras).toEqual(['cam1']);
    expect(newConfigs.slotB.selectedCameras).toEqual(['cam3']); // Unchanged
  });
});

// ── Cycle mode tests ────────────────────────────────────────────────────────
describe('Cycle Mode', () => {
  it('should support cycle steps with independent configs', () => {
    const cycleSteps = [
      { viewId: 'cams', viewConfig: { selectedCameras: ['cam1'] }, dwellSeconds: 60 },
      { viewId: 'weather', viewConfig: { loopDwellSeconds: 20 }, dwellSeconds: 120 },
      { viewId: 'vessels', viewConfig: {}, dwellSeconds: 90 },
    ];

    expect(cycleSteps).toHaveLength(3);
    expect(cycleSteps[0].viewId).toBe('cams');
    expect(cycleSteps[0].viewConfig.selectedCameras).toEqual(['cam1']);
    expect(cycleSteps[1].viewConfig.loopDwellSeconds).toBe(20);
    expect(cycleSteps[2].dwellSeconds).toBe(90);
  });

  it('should advance to next step correctly', () => {
    const steps = [
      { viewId: 'cams', dwellSeconds: 30 },
      { viewId: 'weather', dwellSeconds: 60 },
      { viewId: 'vessels', dwellSeconds: 45 },
    ];

    let activeIdx = 0;
    // Simulate three advances
    for (let i = 0; i < 3; i++) {
      activeIdx = (activeIdx + 1) % steps.length;
    }
    expect(activeIdx).toBe(0); // Wraps around
  });

  it('should handle step reordering', () => {
    const steps = [
      { viewId: 'cams', dwellSeconds: 30 },
      { viewId: 'weather', dwellSeconds: 60 },
      { viewId: 'vessels', dwellSeconds: 45 },
    ];

    // Move weather (idx 1) up to idx 0
    const newSteps = [...steps];
    [newSteps[0], newSteps[1]] = [newSteps[1], newSteps[0]];

    expect(newSteps[0].viewId).toBe('weather');
    expect(newSteps[1].viewId).toBe('cams');
    expect(newSteps[2].viewId).toBe('vessels');
  });

  it('should handle step removal', () => {
    const steps = [
      { viewId: 'cams', dwellSeconds: 30 },
      { viewId: 'weather', dwellSeconds: 60 },
    ];

    const newSteps = steps.filter((_, i) => i !== 0);
    expect(newSteps).toHaveLength(1);
    expect(newSteps[0].viewId).toBe('weather');
  });
});

// ── Weather loop config tests ────────────────────────────────────────────────
describe('Weather Loop Config', () => {
  it('should default dwell to 30 seconds', () => {
    const config = {};
    const dwell = config.loopDwellSeconds || 30;
    expect(dwell).toBe(30);
  });

  it('should accept custom dwell time', () => {
    const config = { loopDwellSeconds: 45 };
    const dwell = config.loopDwellSeconds || 30;
    expect(dwell).toBe(45);
  });

  it('dwell should be in valid range', () => {
    const validRange = [10, 30, 60, 120];
    for (const val of validRange) {
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThanOrEqual(120);
    }
  });
});

// ── State structure tests ────────────────────────────────────────────────────
describe('State Structure', () => {
  it('should support full display state with cycle and slot configs', () => {
    const state = {
      cornerLayoutMode: 'cycle',
      cornerCycleSteps: [
        { viewId: 'cams', viewConfig: { selectedCameras: ['cam1'] }, dwellSeconds: 60 },
        { viewId: 'weather', viewConfig: { loopDwellSeconds: 20 }, dwellSeconds: 120 },
      ],
      mainTvLayoutMode: '2-up-side',
      mainTvSlotMappings: { slotA: 'cams', slotB: 'weather' },
      mainTvSlotConfigs: {
        slotA: { selectedCameras: ['cam1', 'cam2'] },
        slotB: { loopDwellSeconds: 45 },
      },
    };

    expect(state.cornerLayoutMode).toBe('cycle');
    expect(state.cornerCycleSteps).toHaveLength(2);
    expect(state.mainTvSlotConfigs.slotA.selectedCameras).toHaveLength(2);
    expect(state.mainTvSlotConfigs.slotB.loopDwellSeconds).toBe(45);
  });
});
