import React, { useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

/**
 * HDRadarLayer — overlays a live Doppler radar PNG received via HD Radio broadcast
 * on the Leaflet map using the bounding box from the DWRI metadata file.
 *
 * The radar image covers the entire Hawaiian island chain:
 *   NW corner: ~23.97°N, 160.66°W
 *   SE corner: ~18.95°N, 155.27°W
 *
 * Source: iHeartMedia HD Radio DWR (Doppler Weather Radar) data service,
 *         broadcast simultaneously on FM 92.3 / 93.9 / 98.5 / 101.9 MHz.
 */
export default function HDRadarLayer({ radarData, opacity = 0.65, visible = true }) {
  const map = useMap();
  const overlayRef = useRef(null);

  useEffect(() => {
    // Remove any existing overlay
    if (overlayRef.current) {
      overlayRef.current.remove();
      overlayRef.current = null;
    }

    if (!visible || !radarData?.ok || !radarData.data_b64) return;

    const { nw, se, data_b64, ts } = radarData;
    if (!nw || !se) return;

    // Leaflet ImageOverlay bounds: [[sw_lat, sw_lon], [ne_lat, ne_lon]]
    const bounds = [[se[0], nw[1]], [nw[0], se[1]]];
    const dataUrl = `data:image/png;base64,${data_b64}`;

    const overlay = L.imageOverlay(dataUrl, bounds, {
      opacity,
      interactive: false,
      className: 'hd-radar-overlay',
    });

    overlay.addTo(map);
    overlayRef.current = overlay;

    return () => {
      if (overlayRef.current) {
        overlayRef.current.remove();
        overlayRef.current = null;
      }
    };
  }, [map, radarData, opacity, visible]);

  // Update opacity without re-creating the overlay
  useEffect(() => {
    if (overlayRef.current) overlayRef.current.setOpacity(opacity);
  }, [opacity]);

  return null;
}
