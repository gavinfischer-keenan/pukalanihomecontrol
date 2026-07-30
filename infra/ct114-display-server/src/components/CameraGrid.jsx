import React, { useState, useEffect } from 'react';
import CameraStream from './CameraStream';

const CameraGrid = React.memo(({ config }) => {
  const [cameras, setCameras] = useState([]);
  const selectedIds = config?.selectedCameras || [];

  // Fetch camera registry to resolve names
  useEffect(() => {
    fetch('/api/cameras')
      .then(r => r.json())
      .then(setCameras)
      .catch(() => {});
  }, []);

  const gridCount = Math.max(selectedIds.length, 1);
  const gridClass = `grid-${Math.min(gridCount, 6)}`;

  return (
    <div className={`camera-grid ${gridClass}`}>
      {selectedIds.map(camId => {
        const cam = cameras.find(c => c.id === camId);
        const frigateName = cam?.frigateName || camId;
        const label = cam?.name || camId;
        
        return (
          <div key={camId} className="camera-cell">
            <CameraStream frigateName={frigateName} />
            <div className="cam-label">{label}</div>
          </div>
        );
      })}
      {selectedIds.length === 0 && (
        <div style={{ color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          No cameras selected
        </div>
      )}
    </div>
  );
});

export default CameraGrid;
