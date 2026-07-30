import React from 'react';
import viewComponentMap from '../viewRegistry.jsx';
import CycleView from './CycleView';

const DisplayView = React.memo(({ displayId, state, config }) => {
  if (!state || !config) return null;

  const layoutMode = state[`${displayId}LayoutMode`];
  const slotMappings = state[`${displayId}SlotMappings`] || {};
  const slotConfigs = state[`${displayId}SlotConfigs`] || {};

  // Cycle mode — delegate to CycleView
  if (layoutMode === 'cycle') {
    const cycleSteps = state[`${displayId}CycleSteps`] || [];
    const enrichedSteps = cycleSteps.map(step => ({
      ...step,
      viewConfig: { ...(step.viewConfig || {}), displayId },
    }));
    return (
      <div className="view-container layout-1-up">
        <div className="grid-cell slot-a">
          <CycleView config={{ cycleSteps: enrichedSteps }} />
        </div>
      </div>
    );
  }

  const renderSlot = (slotId) => {
    const viewId = slotMappings[slotId];
    if (!viewId) return null;

    const ViewComponent = viewComponentMap[viewId];
    if (!ViewComponent) return <div className="placeholder-view">Unknown view: {viewId}</div>;

    // Inject displayId so views can adapt per-monitor
    const slotConfig = { ...(slotConfigs[slotId] || {}), displayId };
    return <ViewComponent config={slotConfig} />;
  };

  const layout = (config.layouts || []).find(l => l.id === layoutMode);
  const slots = layout?.slots || ['slotA'];

  return (
    <div className={`view-container layout-${layoutMode}`}>
      {slots.map((slotId, idx) => (
        <div key={slotId} className={`grid-cell slot-${String.fromCharCode(97 + idx)}`}>
          {renderSlot(slotId)}
        </div>
      ))}
    </div>
  );
});

export default DisplayView;
