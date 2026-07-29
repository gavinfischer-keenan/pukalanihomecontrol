import React from 'react';
import { Polyline, Polygon, Tooltip } from 'react-leaflet';

function getDestination(lat, lon, distanceMi, bearingDeg) {
  const R = 3958.8; // Earth radius in statute miles
  const brng = (bearingDeg * Math.PI) / 180;
  const d = distanceMi / R;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

export default function ReferenceObjects({ position }) {
  if (!position) return null;
  const origin = [position.lat, position.lon];

  // Helper to draw a spoke
  const Spoke = ({ bearing, lengthMi, color, label, dashArray }) => {
    const dest = getDestination(position.lat, position.lon, lengthMi, bearing);
    return (
      <Polyline positions={[origin, dest]} color={color} weight={1.5} opacity={0.6} dashArray={dashArray || '4, 4'}>
        <Tooltip sticky direction="top" className="reference-tooltip">
          <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{label}</div>
          <div style={{ fontSize: '10px', color: '#999' }}>Bearing: {bearing}°</div>
        </Tooltip>
      </Polyline>
    );
  };

  // Helper for shaded sector (e.g., Diamond Head block)
  const Sector = ({ startBearing, endBearing, lengthMi, color, label }) => {
    const points = [origin];
    for (let b = startBearing; b <= endBearing; b += 1) {
      points.push(getDestination(position.lat, position.lon, lengthMi, b));
    }
    if ((endBearing - startBearing) % 1 !== 0) {
       points.push(getDestination(position.lat, position.lon, lengthMi, endBearing));
    }
    points.push(origin); // close polygon

    return (
      <Polygon positions={points} color={color} weight={1} opacity={0.3} fillColor={color} fillOpacity={0.15}>
        <Tooltip sticky direction="top" className="reference-tooltip">
          <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{label}</div>
          <div style={{ fontSize: '10px', color: '#999' }}>Bearing: {startBearing}° - {endBearing}°</div>
        </Tooltip>
      </Polygon>
    );
  };

  // Helper to draw a tricolor dashed line (Black/White/Blue)
  const TricolorSpoke = ({ bearing, lengthMi, label }) => {
    const dest = getDestination(position.lat, position.lon, lengthMi, bearing);
    // Base layer: Blue
    // Middle layer: Black dash (draws 0-10, gap 10-30)
    // Top layer: White dash (draws 10-20, gap 20-40, using offset 20)
    // Result: 0-10 Black, 10-20 White, 20-30 Blue (base showing through)
    return (
      <>
        {/* Base layer (Blue) */}
        <Polyline positions={[origin, dest]} color="#4fc3f7" weight={2.5} opacity={0.85}>
          <Tooltip sticky direction="top" className="reference-tooltip">
            <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{label}</div>
            <div style={{ fontSize: '10px', color: '#999' }}>Bearing: {bearing}°</div>
          </Tooltip>
        </Polyline>
        {/* Middle layer (Black) */}
        <Polyline positions={[origin, dest]} color="#000000" weight={2.5} opacity={0.85} dashArray="10, 20" dashOffset="0" interactive={false} />
        {/* Top layer (White) */}
        <Polyline positions={[origin, dest]} color="#ffffff" weight={2.5} opacity={0.85} dashArray="10, 20" dashOffset="20" interactive={false} />
      </>
    );
  };

  return (
    <>
      <TricolorSpoke bearing={130} lengthMi={25} label="Left edge of ocean view" />
      <Spoke bearing={151} lengthMi={25} color="#ffffff" label="White apartment building (The Regency)" />
      <TricolorSpoke bearing={247} lengthMi={25} label="Waikiki high rises end / Ala Moana" />
      <Sector startBearing={195} endBearing={215} lengthMi={25} color="#f44336" label="Diamond Head (View Blocked)" />
    </>
  );
}
