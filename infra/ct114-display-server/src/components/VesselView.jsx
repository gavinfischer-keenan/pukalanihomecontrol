import React from 'react';
import { DASHBOARD_URL, VESSEL_DEFAULTS } from '../displayConfig';

/**
 * VesselView — Embeds the Hawaii Dashboard vessel map in kiosk mode.
 * Zoom and center are config-driven (set via Remote UI).
 *
 * Key insight: browsers don't re-navigate iframes when React updates src.
 * We use a `key` prop that includes zoom+center to force React to unmount
 * and remount the iframe when config changes, guaranteeing a fresh load.
 */
const VesselView = React.memo(({ config }) => {
  const zoom = config?.vesselZoom ?? VESSEL_DEFAULTS.zoom;
  const center = config?.vesselCenter || VESSEL_DEFAULTS.center;
  const src = `${DASHBOARD_URL}?zoom=${zoom}&center=${center}`;

  // key forces iframe remount when zoom/center change
  const iframeKey = `vessel-${zoom}-${center}`;

  return (
    <iframe
      key={iframeKey}
      src={src}
      className="full-bleed-frame"
      title="Vessel Tracker"
      allow="fullscreen"
      style={{ border: 'none', width: '100%', height: '100%' }}
    />
  );
});

export default VesselView;
