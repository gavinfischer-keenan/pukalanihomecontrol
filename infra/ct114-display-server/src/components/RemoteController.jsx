import React, { useState } from 'react';

const VIEWS = [
  { id: 'cams', label: '📹 Camera Grid' },
  { id: 'vessels', label: '🚢 Vessel Tracker' },
  { id: 'weather', label: '🌤️ Weather Loops' },
  { id: 'house_status', label: '🏠 House Status (Coming Soon)' },
];

const RemoteController = ({ state, config, cameras, updateState }) => {
  const [expanded, setExpanded] = useState({ mainTv: true, corner: false });

  if (!state) return <div className="remote-loading">Connecting to server...</div>;

  const layouts = [
    ...(config?.layouts || [
      { id: '1-up', label: 'Full Screen', slots: ['slotA'] },
      { id: '2-up-side', label: '2-Up Side by Side', slots: ['slotA', 'slotB'] },
      { id: '2-up-stack', label: '2-Up Stacked', slots: ['slotA', 'slotB'] },
      { id: '3-up-leftbig', label: '3-Up (Left Big)', slots: ['slotA', 'slotB', 'slotC'] },
      { id: '4-up', label: '4-Up Grid', slots: ['slotA', 'slotB', 'slotC', 'slotD'] },
    ]),
    { id: 'cycle', label: '🔄 Cycle Mode', slots: [] },
  ];

  const views = config?.views?.filter(v => v.id !== 'birdnet' && v.id !== 'aircraft') || VIEWS;
  const activeCameras = (cameras || []).filter(c => c.active);

  // ── Layout change ──
  const handleLayoutChange = (displayId, value) => {
    if (value === 'cycle') {
      const existing = state[`${displayId}CycleSteps`] || [];
      updateState({
        [`${displayId}LayoutMode`]: 'cycle',
        [`${displayId}CycleSteps`]: existing.length > 0 ? existing : [
          { viewId: 'cams', viewConfig: {}, dwellSeconds: 30 },
        ],
      });
      return;
    }

    const layout = layouts.find(l => l.id === value);
    const slots = layout?.slots || ['slotA'];
    const currentMappings = state[`${displayId}SlotMappings`] || {};
    const newMappings = {};
    slots.forEach((slot, i) => {
      newMappings[slot] = currentMappings[slot] || (i === 0 ? 'cams' : '');
    });

    updateState({
      [`${displayId}LayoutMode`]: value,
      [`${displayId}SlotMappings`]: newMappings,
    });
  };

  // ── Slot view change ──
  const handleSlotChange = (displayId, slotId, value) => {
    updateState({
      [`${displayId}SlotMappings`]: {
        ...state[`${displayId}SlotMappings`],
        [slotId]: value,
      },
    });
  };

  // ── Per-slot camera toggle (BUG FIX: was always writing to slotA) ──
  const handleCameraToggle = (displayId, slotId, camId) => {
    const configs = state[`${displayId}SlotConfigs`] || {};
    const slotConfig = configs[slotId] || {};
    const selected = slotConfig.selectedCameras || [];

    const newSelected = selected.includes(camId)
      ? selected.filter(c => c !== camId)
      : [...selected, camId];

    updateState({
      [`${displayId}SlotConfigs`]: {
        ...configs,
        [slotId]: { ...slotConfig, selectedCameras: newSelected },
      },
    });
  };

  // ── Weather dwell time change ──
  const handleDwellChange = (displayId, slotId, seconds) => {
    const configs = state[`${displayId}SlotConfigs`] || {};
    const slotConfig = configs[slotId] || {};
    updateState({
      [`${displayId}SlotConfigs`]: {
        ...configs,
        [slotId]: { ...slotConfig, loopDwellSeconds: seconds },
      },
    });
  };

  // ── Cycle step management ──
  const handleCycleAddStep = (displayId) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    steps.push({ viewId: 'cams', viewConfig: {}, dwellSeconds: 30 });
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  const handleCycleRemoveStep = (displayId, idx) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    steps.splice(idx, 1);
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  const handleCycleStepViewChange = (displayId, idx, viewId) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    steps[idx] = { ...steps[idx], viewId, viewConfig: {} };
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  const handleCycleStepDwellChange = (displayId, idx, seconds) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    steps[idx] = { ...steps[idx], dwellSeconds: seconds };
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  const handleCycleStepCameraToggle = (displayId, idx, camId) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    const step = { ...steps[idx] };
    const vc = { ...(step.viewConfig || {}) };
    const selected = vc.selectedCameras || [];
    vc.selectedCameras = selected.includes(camId)
      ? selected.filter(c => c !== camId)
      : [...selected, camId];
    step.viewConfig = vc;
    steps[idx] = step;
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  const handleCycleStepLoopDwell = (displayId, idx, seconds) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    const step = { ...steps[idx] };
    step.viewConfig = { ...(step.viewConfig || {}), loopDwellSeconds: seconds };
    steps[idx] = step;
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  const handleCycleStepMove = (displayId, idx, direction) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= steps.length) return;
    [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  // ── Render per-view config controls ──
  const renderViewConfig = (viewId, configState, handlers) => {
    if (viewId === 'cams' && activeCameras.length > 0) {
      const selected = configState?.selectedCameras || [];
      return (
        <div className="control-group" style={{ marginTop: 8 }}>
          <label>Cameras</label>
          <div className="camera-toggles">
            {activeCameras.map(cam => (
              <button
                key={cam.id}
                className={`cam-toggle ${selected.includes(cam.id) ? 'cam-active' : ''}`}
                onClick={() => handlers.onCameraToggle(cam.id)}
              >
                {cam.name}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (viewId === 'weather') {
      const dwell = configState?.loopDwellSeconds || 30;
      return (
        <div className="control-group" style={{ marginTop: 8 }}>
          <label>Loop Dwell Time: {dwell}s</label>
          <input
            type="range" min="10" max="120" step="5" value={dwell}
            onChange={e => handlers.onDwellChange(parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      );
    }

    return null;
  };

  // ── Render cycle step editor ──
  const renderCycleConfig = (displayId) => {
    const steps = state[`${displayId}CycleSteps`] || [];

    return (
      <div className="cycle-config">
        <label style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'block' }}>
          Cycle Steps
        </label>

        {steps.map((step, idx) => (
          <div key={idx} className="cycle-step" style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
            padding: 12, marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>#{idx + 1}</span>
              <select
                value={step.viewId}
                onChange={e => handleCycleStepViewChange(displayId, idx, e.target.value)}
                style={{
                  flex: 1, padding: '6px 10px', background: '#1e293b',
                  color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6,
                  fontSize: '0.85rem',
                }}
              >
                {views.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="number" min="5" max="600" value={step.dwellSeconds || 30}
                  onChange={e => handleCycleStepDwellChange(displayId, idx, parseInt(e.target.value) || 30)}
                  style={{
                    width: 55, padding: '6px 8px', background: '#1e293b',
                    color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6,
                    fontSize: '0.85rem', textAlign: 'center',
                  }}
                />
                <span style={{ color: '#64748b', fontSize: '0.75rem' }}>sec</span>
              </div>
              <button
                onClick={() => handleCycleStepMove(displayId, idx, -1)}
                disabled={idx === 0}
                style={{ background: 'none', border: 'none', color: idx === 0 ? '#334155' : '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
              >▲</button>
              <button
                onClick={() => handleCycleStepMove(displayId, idx, 1)}
                disabled={idx === steps.length - 1}
                style={{ background: 'none', border: 'none', color: idx === steps.length - 1 ? '#334155' : '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}
              >▼</button>
              <button
                onClick={() => handleCycleRemoveStep(displayId, idx)}
                style={{
                  background: '#7f1d1d', border: 'none', color: '#fca5a5',
                  borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem',
                }}
              >✕</button>
            </div>

            {/* Per-step view config */}
            {renderViewConfig(step.viewId, step.viewConfig || {}, {
              onCameraToggle: (camId) => handleCycleStepCameraToggle(displayId, idx, camId),
              onDwellChange: (sec) => handleCycleStepLoopDwell(displayId, idx, sec),
            })}
          </div>
        ))}

        <button
          onClick={() => handleCycleAddStep(displayId)}
          style={{
            width: '100%', padding: '10px', background: '#1e293b',
            border: '1px dashed #475569', borderRadius: 8, color: '#94a3b8',
            cursor: 'pointer', fontSize: '0.9rem',
          }}
        >
          + Add Step
        </button>
      </div>
    );
  };

  // ── Render display section ──
  const renderDisplaySection = (title, displayId) => {
    const layoutMode = state[`${displayId}LayoutMode`] || '1-up';
    const mappings = state[`${displayId}SlotMappings`] || {};
    const configs = state[`${displayId}SlotConfigs`] || {};
    const layout = layouts.find(l => l.id === layoutMode);
    const slots = layout?.slots || ['slotA'];
    const isExpanded = expanded[displayId];
    const isCycle = layoutMode === 'cycle';

    return (
      <div className="remote-section">
        <h2
          onClick={() => setExpanded(e => ({ ...e, [displayId]: !e[displayId] }))}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          {isExpanded ? '▼' : '▶'} {title}
        </h2>

        {isExpanded && (
          <div className="section-controls">
            <div className="control-group">
              <label>Layout</label>
              <select value={layoutMode} onChange={e => handleLayoutChange(displayId, e.target.value)}>
                {layouts.map(l => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>

            {isCycle ? (
              renderCycleConfig(displayId)
            ) : (
              <>
                {/* Slot view selectors */}
                {slots.map(slot => (
                  <div key={slot} className="control-group">
                    <label>{slot.replace('slot', 'Slot ')} View</label>
                    <select value={mappings[slot] || ''} onChange={e => handleSlotChange(displayId, slot, e.target.value)}>
                      <option value="">— Select —</option>
                      {views.map(v => (
                        <option key={v.id} value={v.id}>{v.label}</option>
                      ))}
                    </select>
                  </div>
                ))}

                {/* Per-slot config (cameras, weather dwell) — BUG FIX: each slot independent */}
                {slots.map(slot => {
                  const viewId = mappings[slot];
                  if (!viewId) return null;
                  const slotConfig = configs[slot] || {};

                  return (
                    <div key={`${slot}-config`}>
                      {slots.length > 1 && viewId === 'cams' && (
                        <label style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                          {slot.replace('slot', 'Slot ')} cameras:
                        </label>
                      )}
                      {renderViewConfig(viewId, slotConfig, {
                        onCameraToggle: (camId) => handleCameraToggle(displayId, slot, camId),
                        onDwellChange: (sec) => handleDwellChange(displayId, slot, sec),
                      })}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="remote-control">
      <h1>🎛️ Display Remote</h1>
      <div className="connection-badge">● Connected</div>
      {renderDisplaySection('Main TV', 'mainTv')}
      {renderDisplaySection('Corner Monitor', 'corner')}
    </div>
  );
};

export default RemoteController;
