import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

export default function HDGasLayer({ stations = [] }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!layerRef.current) layerRef.current = L.layerGroup().addTo(map);
    const layer = layerRef.current;
    layer.clearLayers();

    stations.forEach(s => {
      if (!s.lat || !s.lon) return;
      const price = s.regular ?? s.midgrade ?? s.premium ?? s.diesel ?? '?';
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:#1e3a5f;color:#fbbf24;padding:2px 4px;border-radius:4px;font-size:10px;font-weight:700;border:1px solid #fbbf24;white-space:nowrap;box-shadow:0 1px 4px #0008">⛽ $${price}</div>`,
        iconSize: [60,20], iconAnchor: [30,10]
      });
      const marker = L.marker([s.lat, s.lon], { icon });
      marker.bindPopup(`<b>⛽ ${s.name || 'Gas Station'}</b><br/>
        Regular: $${s.regular ?? '–'}<br/>Midgrade: $${s.midgrade ?? '–'}<br/>
        Premium: $${s.premium ?? '–'}<br/>Diesel: $${s.diesel ?? '–'}<br/>
        <small style="color:#888">Station: ${s.station || '–'} · ${new Date(s.ts || Date.now()).toLocaleTimeString()}</small>`);
      layer.addLayer(marker);
    });

    return () => { layer.clearLayers(); };
  }, [stations, map]);

  return null;
}
