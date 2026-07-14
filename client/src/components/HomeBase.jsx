import { useEffect } from 'react';
import L from 'leaflet';
import { useMap } from 'react-leaflet';

export default function HomeBase({ position }) {
  const map = useMap();

  useEffect(() => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="home-marker">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="#f59e0b" style="filter:drop-shadow(0 0 6px #f59e0b)">
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
        </svg>
        <div class="home-label">${position.label}</div>
      </div>`,
      iconSize: [28, 40],
      iconAnchor: [14, 28],
    });

    const marker = L.marker([position.lat, position.lon], { icon, interactive: false }).addTo(map);
    return () => map.removeLayer(marker);
  }, [position, map]);

  return null;
}
