import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const SEV_COLOR = { 0:'#4ade80', 1:'#facc15', 2:'#fb923c', 3:'#f87171', 4:'#ef4444' };

export default function HDTrafficLayer({ incidents = [] }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!layerRef.current) layerRef.current = L.layerGroup().addTo(map);
    const layer = layerRef.current;
    layer.clearLayers();

    incidents.forEach(inc => {
      if (!inc.lat || !inc.lon) return;
      const color = SEV_COLOR[inc.severity] || SEV_COLOR[0];
      const icon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;background:${color};border:2px solid #1e293b;border-radius:3px;opacity:0.9;box-shadow:0 1px 4px #0008"></div>`,
        iconSize: [14,14], iconAnchor: [7,7]
      });
      const marker = L.marker([inc.lat, inc.lon], { icon });
      marker.bindPopup(`<b>🚗 HD Traffic</b><br/>${inc.description || ''}<br/>
        Road: ${inc.road || '–'}<br/>Severity: ${inc.severity ?? '–'}<br/>
        <small style="color:#888">Station: ${inc.station || '–'} · ${new Date(inc.ts || Date.now()).toLocaleTimeString()}</small>`);
      layer.addLayer(marker);
    });

    return () => { layer.clearLayers(); };
  }, [incidents, map]);

  return null;
}
