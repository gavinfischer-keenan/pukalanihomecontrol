import { useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

// Draw range rings in nautical miles around a center point
export default function RangeRings({ center, rings }) {
  const map = useMap();

  useEffect(() => {
    const MI_TO_M = 1609.34;
    const circles = rings.map((mi) => {
      const c = L.circle(center, {
        radius:      mi * MI_TO_M,
        color:       '#000000',   // bold black — clearly visible on ocean basemap
        opacity:     0.75,
        weight:      2.5,
        dashArray:   '8 6',       // nautical chart dashed look
        fillOpacity: 0,
        interactive: false,
      }).addTo(map);

      const labelPos = L.latLng(center[0] - (mi * MI_TO_M) / 111320, center[1]);
      const label = L.marker(labelPos, {
        icon: L.divIcon({
          className: '',
          html: `<div class="ring-label">${mi} mi</div>`,
          iconAnchor: [24, 8],
        }),
        interactive: false,
      }).addTo(map);

      return [c, label];
    });

    return () => {
      circles.flat().forEach(l => map.removeLayer(l));
    };
  }, [center, rings, map]);

  return null;
}
