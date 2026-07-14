import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

// Determine tide trend (rising/falling) from upcoming hi/lo
function tideTrend(station) {
  if (!station.upcoming_hilo || !station.upcoming_hilo.length) return 'unknown';
  const next = station.upcoming_hilo[0];
  return next.tide_type === 'H' ? 'rising' : 'falling';
}

function trendArrow(trend) {
  if (trend === 'rising')  return '↑';
  if (trend === 'falling') return '↓';
  return '—';
}

function trendColor(trend) {
  if (trend === 'rising')  return '#29b6f6';   // blue = rising toward high
  if (trend === 'falling') return '#ef5350';   // red = falling toward low
  return '#78909c';
}

// Border color based on whether we're near high or low water
function borderColor(station) {
  if (!station.upcoming_hilo || !station.upcoming_hilo.length) return '#78909c';
  const next = station.upcoming_hilo[0];
  // If next event is High, we're currently low (and rising). Near low = blue.
  // If next event is Low, we're currently high (and falling). Near high = red.
  return next.tide_type === 'H' ? '#1e88e5' : '#e53935';
}

function tideIcon(station) {
  const ft = station.current_ft;
  const trend = tideTrend(station);
  const arrowColor = trendColor(trend);
  const boxBorder  = borderColor(station);
  const arrow = trendArrow(trend);
  const heightStr = ft != null ? ft.toFixed(2) + "'" : '--';

  // Next hi/lo info
  let nextStr = '';
  if (station.upcoming_hilo && station.upcoming_hilo.length > 0) {
    const next = station.upcoming_hilo[0];
    const t = new Date(next.pred_time);
    const h = t.getHours() % 12 || 12;
    const m = String(t.getMinutes()).padStart(2, '0');
    const ap = t.getHours() >= 12 ? 'p' : 'a';
    nextStr = `${next.tide_type}${h}:${m}${ap}`;
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="58" height="54" viewBox="0 0 58 54">
  <!-- Box outline: blue when rising toward high, red when at high/falling -->
  <rect x="1" y="1" width="56" height="52" rx="8" fill="rgba(10,20,40,0.9)" stroke="${boxBorder}" stroke-width="2.5"/>
  <!-- Wave indicator top-left -->
  <text x="7" y="17" font-size="12" fill="${arrowColor}">≋</text>
  <!-- TIDE label -->
  <text x="29" y="14" text-anchor="middle" font-size="8" font-weight="bold" fill="#b0bec5" font-family="sans-serif">TIDE</text>
  <!-- Current height -->
  <text x="26" y="32" text-anchor="middle" font-size="14" font-weight="bold" fill="white" font-family="monospace">${heightStr}</text>
  <!-- Trend arrow — slightly bigger and bolder -->
  <text x="46" y="32" text-anchor="middle" font-size="18" font-weight="bold" fill="${arrowColor}">${arrow}</text>
  <!-- Next hi/lo -->
  <text x="29" y="48" text-anchor="middle" font-size="8.5" fill="#80cbc4" font-family="monospace">${nextStr}</text>
</svg>`;

  return L.divIcon({
    html: svg,
    iconSize: [58, 54],
    iconAnchor: [29, 54],
    popupAnchor: [0, -54],
    className: 'tide-icon',
  });
}

export default function TideLayer({ tides, selected, onSelect }) {
  const map = useMap();
  const markersRef = useRef({});

  useEffect(() => {
    if (!tides || !tides.length) return;

    const currentIds = new Set(tides.map(t => t.station_id));
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    }

    tides.forEach(station => {
      if (!station.lat || !station.lon) return;

      const icon = tideIcon(station);

      if (markersRef.current[station.station_id]) {
        markersRef.current[station.station_id]
          .setLatLng([station.lat, station.lon])
          .setIcon(icon);
      } else {
        const marker = L.marker([station.lat, station.lon], { icon, zIndexOffset: 350 });
        marker.on('click', () => onSelect({ ...station, _type: 'tide', entity_id: station.station_id }));
        marker.addTo(map);
        markersRef.current[station.station_id] = marker;
      }
    });
  }, [tides, selected, map, onSelect]);

  useEffect(() => () => {
    Object.values(markersRef.current).forEach(m => m.remove());
  }, [map]);

  return null;
}
