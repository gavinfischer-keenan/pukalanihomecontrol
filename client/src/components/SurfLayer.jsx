import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

// Oahu surf spots with Open-Meteo Marine API fetch points
const SURF_SPOTS = [
  // North Shore
  { id: 'pipeline',   name: 'Pipeline',      lat: 21.6644, lon: -158.0531, group: 'North Shore' },
  { id: 'sunset',     name: 'Sunset Beach',  lat: 21.6780, lon: -158.0389, group: 'North Shore' },
  { id: 'waimea',     name: 'Waimea Bay',    lat: 21.6429, lon: -158.0656, group: 'North Shore' },
  { id: 'haleiwa',    name: 'Haleiwa',       lat: 21.5940, lon: -158.1050, group: 'North Shore' },
  { id: 'laniakea',   name: 'Laniakea',      lat: 21.6347, lon: -158.0836, group: 'North Shore' },
  // Town / South Shore
  { id: 'bowls',      name: 'Ala Moana Bowls', lat: 21.2844, lon: -157.8490, group: 'South Shore' },
  { id: 'diamondhead',name: 'Diamond Head',  lat: 21.2561, lon: -157.8052, group: 'South Shore' },
  { id: 'sandy',      name: 'Sandy Beach',   lat: 21.3028, lon: -157.6764, group: 'East' },
  // Leeward
  { id: 'makaha',     name: 'Makaha',        lat: 21.4728, lon: -158.2189, group: 'Leeward' },
  { id: 'maili',      name: 'Maili',         lat: 21.4195, lon: -158.1784, group: 'Leeward' },
  // Windward
  { id: 'makapuu',    name: 'Makapuu',       lat: 21.3113, lon: -157.6578, group: 'Windward' },
];

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

// Wave height → color + label
function waveStyle(ft) {
  if (ft == null) return { color: '#546e7a', ring: '#37474f', label: 'flat' };
  if (ft < 1)    return { color: '#26c6da', ring: '#00acc1', label: 'flat' };
  if (ft < 2)    return { color: '#29b6f6', ring: '#0288d1', label: 'ankle' };
  if (ft < 3)    return { color: '#42a5f5', ring: '#1976d2', label: `${ft.toFixed(0)}ft` };
  if (ft < 4)    return { color: '#26a69a', ring: '#00796b', label: `${ft.toFixed(0)}ft` };
  if (ft < 5)    return { color: '#66bb6a', ring: '#388e3c', label: `${ft.toFixed(0)}ft` };
  if (ft < 7)    return { color: '#ffa726', ring: '#ef6c00', label: `${ft.toFixed(0)}ft` };
  if (ft < 10)   return { color: '#ef5350', ring: '#c62828', label: `${ft.toFixed(0)}ft` };
  return          { color: '#e040fb', ring: '#6a1b9a', label: `${ft.toFixed(0)}ft!!` };
}

function surfIcon(spot) {
  const ft = spot._wave_ft;
  const style = waveStyle(ft);

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="52" height="40" viewBox="0 0 52 40">
  <!-- Card bg -->
  <rect x="1" y="1" width="50" height="38" rx="7" fill="rgba(5,15,30,0.88)" stroke="${style.color}" stroke-width="2"/>
  <!-- Wave height number — big -->
  <text x="26" y="24" text-anchor="middle" font-size="16" font-weight="900" fill="${style.color}" font-family="monospace">
    ${ft != null ? ft.toFixed(1) : '—'}
  </text>
  <!-- "ft" label -->
  <text x="26" y="35" text-anchor="middle" font-size="8" fill="${style.ring}" font-family="sans-serif" font-weight="600">
    ${ft != null ? 'ft' : 'loading'}
  </text>
  <!-- Wave icon top-left -->
  <text x="7" y="14" font-size="10" fill="${style.color}" opacity="0.7">≋</text>
  <!-- Spot name truncated at top right -->
  <text x="44" y="12" text-anchor="end" font-size="7" fill="#546e7a" font-family="sans-serif">${spot.name.split(' ')[0]}</text>
</svg>`;

  return L.divIcon({
    html: svg,
    iconSize: [52, 40],
    iconAnchor: [26, 40],
    popupAnchor: [0, -40],
    className: 'surf-icon',
  });
}

// Fetch Open-Meteo marine for a batch of spots
async function fetchSurfData(spots) {
  const results = {};
  // Open-Meteo allows multiple lat/lon — but marine API needs individual calls
  // Batch with Promise.all
  await Promise.all(spots.map(async (spot) => {
    try {
      const url = `${MARINE_URL}?latitude=${spot.lat}&longitude=${spot.lon}` +
        `&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction` +
        `&wind_speed_unit=mph&length_unit=imperial`;
      const r = await fetch(url);
      const data = await r.json();
      const cur = data.current || {};
      results[spot.id] = {
        wave_ft:        cur.wave_height,
        wave_period:    cur.wave_period,
        wave_dir:       cur.wave_direction,
        swell_ft:       cur.swell_wave_height,
        swell_period:   cur.swell_wave_period,
        swell_dir:      cur.swell_wave_direction,
        updated:        cur.time,
      };
    } catch {
      results[spot.id] = null;
    }
  }));
  return results;
}

export default function SurfLayer({ selected, onSelect }) {
  const map = useMap();
  const markersRef = useRef({});
  const [surfData, setSurfData] = useState({});

  // Fetch every 15 minutes (surf doesn't change fast)
  useEffect(() => {
    let active = true;
    const doFetch = async () => {
      const data = await fetchSurfData(SURF_SPOTS);
      if (active) setSurfData(data);
    };
    doFetch();
    const t = setInterval(doFetch, 15 * 60 * 1000);
    return () => { active = false; clearInterval(t); };
  }, []);

  // Render markers
  useEffect(() => {
    SURF_SPOTS.forEach(spot => {
      const sd = surfData[spot.id] || {};
      const enriched = { ...spot, _wave_ft: sd.wave_ft, ...sd };
      const icon = surfIcon(enriched);

      if (markersRef.current[spot.id]) {
        markersRef.current[spot.id].setIcon(icon);
      } else {
        const marker = L.marker([spot.lat, spot.lon], { icon, zIndexOffset: 300 });
        marker.on('click', () => onSelect({
          ...enriched,
          _type: 'surf',
          entity_id: spot.id,
        }));
        marker.addTo(map);
        markersRef.current[spot.id] = marker;
      }
    });
  }, [surfData, map, onSelect]);

  useEffect(() => () => {
    Object.values(markersRef.current).forEach(m => m.remove());
  }, [map]);

  return null;
}

// Export spot list for DetailPanel
export { SURF_SPOTS };
