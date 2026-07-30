import React, { useState } from 'react';
import { VIEW_REGISTRY, CENTER_PRESETS, VESSEL_DEFAULTS } from '../displayConfig';

const RemoteController = ({ state, config, cameras, updateState }) => {
  const [expanded, setExpanded] = useState({});

  if (!state) return <div className="remote-loading">Connecting to server...</div>;

  // Dynamic display list from config (extensible — add displays in cameras.json)
  const displays = config?.displays || [
    { id: 'mainTv', label: 'Main TV' },
    { id: 'corner', label: 'Corner Monitor' },
  ];

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

  const views = config?.views?.filter(v => !['birdnet', 'aircraft'].includes(v.id)) || VIEW_REGISTRY;
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

  const handleSlotChange = (displayId, slotId, value) => {
    updateState({
      [`${displayId}SlotMappings`]: {
        ...state[`${displayId}SlotMappings`],
        [slotId]: value,
      },
    });
  };

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

  const handleSlotConfigChange = (displayId, slotId, key, value) => {
    const configs = state[`${displayId}SlotConfigs`] || {};
    const slotConfig = configs[slotId] || {};
    updateState({
      [`${displayId}SlotConfigs`]: {
        ...configs,
        [slotId]: { ...slotConfig, [key]: value },
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

  const handleCycleStepChange = (displayId, idx, field, value) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    const step = { ...steps[idx] };
    if (field === 'viewId') {
      step.viewId = value;
      step.viewConfig = {};
    } else if (field === 'dwellSeconds') {
      step.dwellSeconds = value;
    } else {
      // viewConfig field
      step.viewConfig = { ...(step.viewConfig || {}), [field]: value };
    }
    steps[idx] = step;
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

  const handleCycleStepMove = (displayId, idx, direction) => {
    const steps = [...(state[`${displayId}CycleSteps`] || [])];
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= steps.length) return;
    [steps[idx], steps[newIdx]] = [steps[newIdx], steps[idx]];
    updateState({ [`${displayId}CycleSteps`]: steps });
  };

  // ── Per-view config controls ──
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

    if (viewId === 'vessels') {
      const zoom = configState?.vesselZoom ?? VESSEL_DEFAULTS.zoom;
      const center = configState?.vesselCenter || VESSEL_DEFAULTS.center;
      return (
        <div style={{ marginTop: 8 }}>
          <div className="control-group">
            <label>Map Zoom: {zoom}</label>
            <input
              type="range" min="7" max="17" step="1" value={zoom}
              onChange={e => handlers.onConfigChange('vesselZoom', parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div className="control-group">
            <label>Map Center</label>
            <select
              value={center}
              onChange={e => handlers.onConfigChange('vesselCenter', e.target.value)}
            >
              {CENTER_PRESETS.map(p => (
                <option key={p.id} value={`${p.lat},${p.lon}`}>{p.label}</option>
              ))}
            </select>
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
            onChange={e => handlers.onConfigChange('loopDwellSeconds', parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
      );
    }

    return null;
  };

  // ── Cycle config ──
  const renderCycleConfig = (displayId) => {
    const steps = state[`${displayId}CycleSteps`] || [];
    return (
      <div className="cycle-config">
        <label style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'block' }}>
          Cycle Steps
        </label>
        {steps.map((step, idx) => (
          <div key={idx} style={{
            background: '#0f172a', border: '1px solid #334155', borderRadius: 8,
            padding: 12, marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>#{idx + 1}</span>
              <select
                value={step.viewId}
                onChange={e => handleCycleStepChange(displayId, idx, 'viewId', e.target.value)}
                style={{ flex: 1, padding: '6px 10px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6, fontSize: '0.85rem' }}
              >
                {views.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <input
                type="number" min="5" max="600" value={step.dwellSeconds || 30}
                onChange={e => handleCycleStepChange(displayId, idx, 'dwellSeconds', parseInt(e.target.value) || 30)}
                style={{ width: 55, padding: '6px 8px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6, fontSize: '0.85rem', textAlign: 'center' }}
              />
              <span style={{ color: '#64748b', fontSize: '0.75rem' }}>sec</span>
              <button onClick={() => handleCycleStepMove(displayId, idx, -1)} disabled={idx === 0}
                style={{ background: 'none', border: 'none', color: idx === 0 ? '#334155' : '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}>▲</button>
              <button onClick={() => handleCycleStepMove(displayId, idx, 1)} disabled={idx === steps.length - 1}
                style={{ background: 'none', border: 'none', color: idx === steps.length - 1 ? '#334155' : '#94a3b8', cursor: 'pointer', fontSize: '1rem' }}>▼</button>
              <button onClick={() => handleCycleRemoveStep(displayId, idx)}
                style={{ background: '#7f1d1d', border: 'none', color: '#fca5a5', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}>✕</button>
            </div>
            {renderViewConfig(step.viewId, step.viewConfig || {}, {
              onCameraToggle: (camId) => handleCycleStepCameraToggle(displayId, idx, camId),
              onConfigChange: (key, val) => handleCycleStepChange(displayId, idx, key, val),
            })}
          </div>
        ))}
        <button onClick={() => handleCycleAddStep(displayId)}
          style={{ width: '100%', padding: '10px', background: '#1e293b', border: '1px dashed #475569', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}>
          + Add Step
        </button>
      </div>
    );
  };

  // ── Render display section ──
  const renderDisplaySection = (display) => {
    const displayId = display.id;
    const title = display.label;
    const layoutMode = state[`${displayId}LayoutMode`] || '1-up';
    const mappings = state[`${displayId}SlotMappings`] || {};
    const configs = state[`${displayId}SlotConfigs`] || {};
    const layout = layouts.find(l => l.id === layoutMode);
    const slots = layout?.slots || ['slotA'];
    const isExpanded = expanded[displayId] ?? (displayId === displays[0]?.id);
    const isCycle = layoutMode === 'cycle';

    return (
      <div key={displayId} className="remote-section">
        <h2 onClick={() => setExpanded(e => ({ ...e, [displayId]: !isExpanded }))}
          style={{ cursor: 'pointer', userSelect: 'none' }}>
          {isExpanded ? '▼' : '▶'} {title}
          {display.resolution && <span style={{ fontSize: '0.7rem', color: '#64748b', marginLeft: 8 }}>{display.resolution}</span>}
        </h2>

        {isExpanded && (
          <div className="section-controls">
            <div className="control-group">
              <label>Layout</label>
              <select value={layoutMode} onChange={e => handleLayoutChange(displayId, e.target.value)}>
                {layouts.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </div>

            {isCycle ? renderCycleConfig(displayId) : (
              <>
                {slots.map(slot => (
                  <div key={slot} className="control-group">
                    <label>{slot.replace('slot', 'Slot ')} View</label>
                    <select value={mappings[slot] || ''} onChange={e => handleSlotChange(displayId, slot, e.target.value)}>
                      <option value="">— Select —</option>
                      {views.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                  </div>
                ))}

                {slots.map(slot => {
                  const viewId = mappings[slot];
                  if (!viewId) return null;
                  const slotConfig = configs[slot] || {};
                  return (
                    <div key={`${slot}-config`}>
                      {slots.length > 1 && (viewId === 'cams' || viewId === 'vessels') && (
                        <label style={{ fontSize: '0.75rem', color: '#64748b', fontStyle: 'italic' }}>
                          {slot.replace('slot', 'Slot ')} settings:
                        </label>
                      )}
                      {renderViewConfig(viewId, slotConfig, {
                        onCameraToggle: (camId) => handleCameraToggle(displayId, slot, camId),
                        onConfigChange: (key, val) => handleSlotConfigChange(displayId, slot, key, val),
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
      {displays.map(d => renderDisplaySection(d))}
    </div>
  );
};

export default RemoteController;
