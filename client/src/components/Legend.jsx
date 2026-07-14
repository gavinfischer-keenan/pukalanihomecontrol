import { useMemo } from 'react';
import './Legend.css';

import { classifyAircraft, makeAircraftSvg } from './AircraftLayer';
import { classifyVessel, VESSEL_CLASS_COLOR, makeVesselSvg } from './VesselLayer';

const formatLabel = (str) => {
  if (!str) return 'Unknown';
  return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

// NOTE: All hooks must be called unconditionally — visible check is at the render return
export default function Legend({ aircraft, vessels, bounds, visible, layers }) {
  // useMemo is ALWAYS called regardless of visible — React rules of hooks
  const { uniqueAc, uniqueVessels } = useMemo(() => {
    if (!bounds || !visible) return { uniqueAc: [], uniqueVessels: [] };

    const acSet = new Set();
    const vSet  = new Set();

    aircraft.forEach(ac => {
      if (ac.lat != null && ac.lon != null && bounds.contains([ac.lat, ac.lon])) {
        acSet.add(classifyAircraft(ac));
      }
    });

    vessels.forEach(v => {
      if (v.lat != null && v.lon != null && bounds.contains([v.lat, v.lon])) {
        vSet.add(classifyVessel(v.vessel_type, v.entity_id));
      }
    });

    return {
      uniqueAc:      Array.from(acSet).sort(),
      uniqueVessels: Array.from(vSet).sort(),
    };
  }, [aircraft, vessels, bounds, visible]);

  // Early return AFTER all hooks
  if (!visible) return null;

  const showAircraftAltitude = layers?.aircraft?.enabled || layers?.acTrails?.enabled;
  const showTides = layers?.tides?.enabled;

  return (
    <div className="legend-panel">
      <div className="legend-header">On-Screen Legend</div>

      {uniqueAc.length > 0 && (
        <div className="legend-section">
          <div className="legend-section-title">AIRCRAFT TYPES</div>
          {uniqueAc.map(cls => (
            <div key={cls} className="legend-item">
              <div
                className="legend-icon"
                dangerouslySetInnerHTML={{ __html: makeAircraftSvg(cls, '#ffffff', 0, false, false) }}
              />
              <div className="legend-label">{formatLabel(cls)}</div>
            </div>
          ))}
        </div>
      )}

      {showAircraftAltitude && uniqueAc.length > 0 && (
        <div className="legend-section">
          <div className="legend-section-title">A/C TRAIL ALTITUDE</div>
          <div className="legend-color-scale">
            <span style={{ background: '#e74c3c' }} title="< 1,000 ft" />
            <span style={{ background: '#e67e22' }} title="< 5,000 ft" />
            <span style={{ background: '#f1c40f' }} title="< 10,000 ft" />
            <span style={{ background: '#2ecc71' }} title="< 20,000 ft" />
            <span style={{ background: '#3498db' }} title="< 30,000 ft" />
            <span style={{ background: '#9b59b6' }} title="30,000+ ft" />
          </div>
          <div className="legend-scale-labels">
            <span>Surface</span>
            <span>FL300+</span>
          </div>
        </div>
      )}

      {uniqueVessels.length > 0 && (
        <div className="legend-section">
          <div className="legend-section-title">VESSEL TYPES</div>
          {uniqueVessels.map(cls => (
            <div key={cls} className="legend-item">
              <div
                className="legend-icon"
                dangerouslySetInnerHTML={{ __html: makeVesselSvg(cls, VESSEL_CLASS_COLOR[cls] || '#ffffff', 0, false) }}
              />
              <div className="legend-label">{formatLabel(cls)}</div>
            </div>
          ))}
          <div className="legend-item" style={{ marginTop: '4px' }}>
            <div className="legend-icon">
              <svg viewBox="0 0 24 24"><line x1="2" y1="12" x2="22" y2="12" stroke="#e74c3c" strokeWidth="2" strokeDasharray="4,6" /></svg>
            </div>
            <div className="legend-label" style={{ fontSize: '10px' }}>Projected Path (30m)</div>
          </div>
        </div>
      )}

      {showTides && (
        <div className="legend-section">
          <div className="legend-section-title">TIDE TREND</div>
          <div className="legend-item">
            <span style={{ color: '#00ff88', fontWeight: 'bold', fontSize: '16px' }}>↑</span>
            <span className="legend-label">Rising</span>
          </div>
          <div className="legend-item">
            <span style={{ color: '#ff4444', fontWeight: 'bold', fontSize: '16px' }}>↓</span>
            <span className="legend-label">Falling</span>
          </div>
        </div>
      )}

      {uniqueAc.length === 0 && uniqueVessels.length === 0 && !showTides && (
        <div className="legend-empty">Nothing visible on screen</div>
      )}
    </div>
  );
}
