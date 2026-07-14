import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

// Wave height (ft) → color
function waveColor(ft) {
  if (ft == null) return '#607d8b';
  if (ft < 2)  return '#26c6da';
  if (ft < 3)  return '#29b6f6';
  if (ft < 4)  return '#42a5f5';
  if (ft < 5)  return '#26a69a';
  if (ft < 7)  return '#66bb6a';
  if (ft < 10) return '#ffa726';
  if (ft < 15) return '#ef5350';
  return '#e040fb';
}

function buoyIcon(buoy) {
  // Convert m → ft
  const wvht_m = buoy.wvht;
  const ft = wvht_m != null ? wvht_m * 3.28084 : null;
  const color = waveColor(ft);
  const ftStr = ft != null ? ft.toFixed(1) : '—';
  const hasData = buoy.obs_time != null;

  // Match surf card style exactly — dark card with big ft number
  // Add a small buoy silhouette as the spot identifier icon
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="58" height="46" viewBox="0 0 58 46">
  <!-- Card background — matches surf cards -->
  <rect x="1" y="1" width="56" height="44" rx="7" fill="rgba(5,15,30,0.88)" stroke="${color}" stroke-width="2.5"/>
  <!-- Buoy silhouette icon top-left (pole + bulb) -->
  <line x1="9" y1="5" x2="9" y2="14" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
  <ellipse cx="9" cy="19" rx="5" ry="6" fill="${color}" opacity="0.85"/>
  ${hasData ? `<circle cx="9" cy="7" r="2" fill="#ffe57f"><animate attributeName="opacity" values="1;0.3;1" dur="2.5s" repeatCount="indefinite"/></circle>` : ''}
  <!-- NDBC label top-right -->
  <text x="52" y="12" text-anchor="end" font-size="7" fill="#546e7a" font-family="sans-serif">NDBC</text>
  <!-- Big ft number — same as surf cards -->
  <text x="34" y="32" text-anchor="middle" font-size="18" font-weight="900" fill="${color}" font-family="monospace">${ftStr}</text>
  <!-- ft label -->
  <text x="34" y="42" text-anchor="middle" font-size="9" fill="${color}" opacity="0.75" font-family="sans-serif" font-weight="600">ft</text>
</svg>`;

  return L.divIcon({
    html: svg,
    iconSize: [58, 46],
    iconAnchor: [29, 46],
    popupAnchor: [0, -46],
    className: 'buoy-icon',
  });
}

export default function BuoyLayer({ buoys, selected, onSelect }) {
  const map = useMap();
  const markersRef = useRef({});

  useEffect(() => {
    if (!buoys || !buoys.length) return;

    const currentIds = new Set(buoys.map(b => b.buoy_id));
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    }

    buoys.forEach(buoy => {
      if (!buoy.lat || !buoy.lon) return;
      const icon = buoyIcon(buoy);

      if (markersRef.current[buoy.buoy_id]) {
        markersRef.current[buoy.buoy_id].setLatLng([buoy.lat, buoy.lon]).setIcon(icon);
      } else {
        const marker = L.marker([buoy.lat, buoy.lon], { icon, zIndexOffset: 400 });
        marker.on('click', () => onSelect({ ...buoy, _type: 'buoy', entity_id: buoy.buoy_id }));
        marker.addTo(map);
        markersRef.current[buoy.buoy_id] = marker;
      }
    });
  }, [buoys, selected, map, onSelect]);

  useEffect(() => () => {
    Object.values(markersRef.current).forEach(m => m.remove());
  }, [map]);

  return null;
}
