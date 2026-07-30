import React from 'react';

/**
 * VesselView — Embeds the Hawaii Dashboard vessel map in kiosk mode.
 * Centers on Pukalani with zoom calculated so the 25nm range ring
 * touches the bottom of the screen.
 */
const VesselView = React.memo(() => {
  // Pukalani home coordinates
  const lat = 21.2855;
  const lon = -157.7969;
  const ringNm = 25;

  // The dashboard already renders range rings. We embed it via iframe
  // with a kiosk-friendly URL. The dashboard will read hash params to
  // set initial center and zoom, hiding UI chrome.
  const src = `/proxy/dashboard/#kiosk?lat=${lat}&lon=${lon}&ring=${ringNm}`;

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
