import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

const FLIGHT_CAT = {
  VFR:  { color: '#00e676', bg: '#003300' },
  MVFR: { color: '#2979ff', bg: '#000d33' },
  IFR:  { color: '#ff1744', bg: '#330000' },
  LIFR: { color: '#e040fb', bg: '#220033' },
  '':   { color: '#607d8b', bg: '#1a1a1a' },
};

function catStyle(cat) {
  return FLIGHT_CAT[cat?.toUpperCase()] || FLIGHT_CAT[''];
}

function skyCover(skyCondJson) {
  try {
    const layers = JSON.parse(skyCondJson || '[]');
    if (!layers.length) return 'CLR';
    const top = layers[layers.length - 1];
    const cover = top.cover || top.coverCode || '';
    const base = top.base || top.cloudBase || '';
    return base ? `${cover}@${Math.round(base / 100)}` : cover;
  } catch {
    return '';
  }
}

function windStr(dir, spd, gst) {
  if (dir == null || spd == null) return '';
  const arrow = ['↓','↙','←','↖','↑','↗','→','↘'][Math.round(dir / 45) % 8];
  return gst ? `${arrow}${spd}G${gst}` : `${arrow}${spd}`;
}

function metarIcon(metar) {
  const style = catStyle(metar.flight_cat);
  const icao = metar.icao || '';
  const short = icao.slice(2); // e.g. PHNL → NL
  const wind = windStr(metar.wind_dir, metar.wind_spd, metar.wind_gst);
  const sky = skyCover(metar.sky_cond);
  const temp = metar.temp_c != null ? `${Math.round(metar.temp_c)}°` : '';

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="66" height="56" viewBox="0 0 66 56">
  <!-- Background card -->
  <rect x="1" y="1" width="64" height="54" rx="8" fill="${style.bg}" stroke="${style.color}" stroke-width="2.5"/>
  <!-- Flight category glow bar top -->
  <rect x="1" y="1" width="64" height="12" rx="7" fill="${style.color}" opacity="0.35"/>
  <!-- Flight category label -->
  <text x="33" y="10" text-anchor="middle" font-size="8" font-weight="bold" fill="${style.color}" font-family="sans-serif" opacity="0.9">${metar.flight_cat || 'UNK'}</text>
  
  <!-- Airport code and Temp -->
  <text x="33" y="26" text-anchor="middle" font-size="14" font-weight="bold" fill="white" font-family="monospace">${short} <tspan font-size="11" fill="#ffb74d">${temp}</tspan></text>
  
  <!-- Wind -->
  <text x="33" y="39" text-anchor="middle" font-size="10" fill="#b0bec5" font-family="monospace">${wind}</text>
  
  <!-- Sky cover -->
  <text x="33" y="50" text-anchor="middle" font-size="9.5" fill="#80cbc4" font-family="monospace">${sky}</text>
</svg>`;

  return L.divIcon({
    html: svg,
    iconSize: [66, 56],
    iconAnchor: [33, 28],
    popupAnchor: [0, -32],
    className: 'metar-icon',
  });
}

export default function MetarLayer({ metars, selected, onSelect }) {
  const map = useMap();
  const markersRef = useRef({});

  useEffect(() => {
    if (!metars || !metars.length) return;

    const currentIds = new Set(metars.map(m => m.icao));
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    }

    metars.forEach(metar => {
      if (!metar.lat || !metar.lon) return;

      const icon = metarIcon(metar);

      if (markersRef.current[metar.icao]) {
        markersRef.current[metar.icao]
          .setLatLng([metar.lat, metar.lon])
          .setIcon(icon);
      } else {
        const marker = L.marker([metar.lat, metar.lon], { icon, zIndexOffset: 450 });
        marker.on('click', () => onSelect({ ...metar, _type: 'metar', entity_id: metar.icao }));
        marker.addTo(map);
        markersRef.current[metar.icao] = marker;
      }
    });
  }, [metars, selected, map, onSelect]);

  useEffect(() => () => {
    Object.values(markersRef.current).forEach(m => m.remove());
  }, [map]);

  return null;
}
