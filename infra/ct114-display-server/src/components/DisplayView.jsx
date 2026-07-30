import React from 'react';
import CameraGrid from './CameraGrid';
import VesselView from './VesselView';
import WeatherView from './WeatherView';
import CycleView from './CycleView';

const viewComponentMap = {
  cams: CameraGrid,
  vessels: VesselView,
  weather: WeatherView,
  house_status: () => <div className="placeholder-view">🏠 House Status — Coming Soon</div>,
};

const DisplayView = React.memo(({ displayId, state, config }) => {
  if (!state || !config) return null;

  const layoutMode = state[`${displayId}LayoutMode`];
  const slotMappings = state[`${displayId}SlotMappings`] || {};
  const slotConfigs = state[`${displayId}SlotConfigs`] || {};

  // Cycle mode — full screen auto-cycling
  if (layoutMode === 'cycle') {
    const cycleSteps = state[`${displayId}CycleSteps`] || [];
    return (
      <div className="view-container layout-1-up">
        <div className="grid-cell slot-a">
          <CycleView config={{ cycleSteps }} />
        </div>
      </div>
    );
  }

  const renderSlot = (slotId) => {
    const viewId = slotMappings[slotId];
    if (!viewId) return null;

    const ViewComponent = viewComponentMap[viewId];
    if (!ViewComponent) return <div className="placeholder-view">Unknown view: {viewId}</div>;

    const slotConfig = slotConfigs[slotId] || {};
    return <ViewComponent config={slotConfig} />;
  };

  // Determine which slots to render based on layout
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
