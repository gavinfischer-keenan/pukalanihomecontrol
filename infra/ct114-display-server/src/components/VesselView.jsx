import React from 'react';
import { DASHBOARD_URL, VESSEL_DEFAULTS } from '../displayConfig';

/**
 * VesselView — Embeds the Hawaii Dashboard vessel map in kiosk mode.
 * Zoom and center are config-driven (set via Remote UI).
 * No hard-coded zoom levels — everything comes from state.
 *
 * Props:
 *   config.vesselZoom   — Leaflet zoom level (7-17, default from VESSEL_DEFAULTS)
 *   config.vesselCenter — "lat,lon" string (default: HOME_BASE)
 */
const VesselView = React.memo(({ config }) => {
  const zoom = config?.vesselZoom ?? VESSEL_DEFAULTS.zoom;
  const center = config?.vesselCenter || VESSEL_DEFAULTS.center;
  const src = `${DASHBOARD_URL}?zoom=${zoom}&center=${center}`;

  return (
    <iframe
      src={src}
      className="full-bleed-frame"
      title="Vessel Tracker"
      allow="fullscreen"
      style={{ border: 'none', width: '100%', height: '100%' }}
    />
  );
});

export default VesselView;
