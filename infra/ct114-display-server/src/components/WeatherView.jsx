import React, { useState, useEffect, useRef } from 'react';

/**
 * WeatherView — Full-screen NOAA satellite loop cycler.
 * Fetches all available loops from the dashboard API and cycles through them
 * with a configurable dwell time per loop (default 30s).
 * 
 * Props:
 *   config.loopDwellSeconds — seconds to show each loop (default 30)
 */
const WeatherView = React.memo(({ config }) => {
  const [loops, setLoops] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [imgKeys, setImgKeys] = useState({});
  const timerRef = useRef(null);

  const dwellMs = (config?.loopDwellSeconds || 30) * 1000;

  // Fetch loops from dashboard API
  useEffect(() => {
    const fetchLoops = async () => {
      try {
        const res = await fetch('/proxy/dashboard-api/api/nws/loops');
        if (!res.ok) return;
        const data = await res.json();
        const arr = data.loops || data;
        if (Array.isArray(arr) && arr.length > 0) {
          setLoops(arr);
          // Cache-bust keys
          const keys = {};
          arr.forEach(l => { keys[l.id] = Date.now(); });
          setImgKeys(keys);
        }
      } catch (err) {
        console.error('[WeatherView] Failed to fetch loops:', err);
      }
    };

    fetchLoops();
    // Refresh loop data every 15 minutes
    const refreshInterval = setInterval(fetchLoops, 15 * 60 * 1000);
    return () => clearInterval(refreshInterval);
  }, []);

  // Cycle through loops
  useEffect(() => {
    if (loops.length <= 1) return;
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setActiveIdx(prev => (prev + 1) % loops.length);
    }, dwellMs);

    return () => clearInterval(timerRef.current);
  }, [loops.length, dwellMs]);

  if (loops.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#000', color: '#475569', fontSize: '1.2rem'
      }}>
        Loading satellite imagery…
      </div>
    );
  }

  const activeLoop = loops[activeIdx] || loops[0];

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: '#000', overflow: 'hidden'
    }}>
      {/* All loop images — only active one is visible */}
      {loops.map((loop, idx) => (
        <img
          key={loop.id}
          src={`/proxy/dashboard-api${loop.localUrl}?v=${imgKeys[loop.id] || 0}`}
          alt={loop.name}
          style={{
            position: 'absolute', top: 0, left: 0,
            width: '100%', height: '100%',
            objectFit: 'contain',
            opacity: idx === activeIdx ? 1 : 0,
            transition: 'opacity 1.5s ease-in-out',
            zIndex: idx === activeIdx ? 1 : 0,
          }}
        />
      ))}

      {/* Loop name + progress overlay */}
      <div style={{
        position: 'absolute', bottom: 20, left: 20, zIndex: 10,
        background: 'rgba(0,0,0,0.7)', padding: '8px 16px',
        borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e2e8f0' }}>
          {activeLoop.icon || '🛰️'} {activeLoop.name}
        </span>
        {activeLoop.updatedAt && (
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            {(() => {
              const m = Math.floor((Date.now() - new Date(activeLoop.updatedAt).getTime()) / 60000);
              return m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`;
            })()}
          </span>
        )}
      </div>

      {/* Dot progress indicator */}
      {loops.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 20, right: 20, zIndex: 10,
          display: 'flex', gap: 6,
        }}>
          {loops.map((_, idx) => (
            <div
              key={idx}
              style={{
                width: 8, height: 8, borderRadius: '50%',
                background: idx === activeIdx ? '#3b82f6' : 'rgba(255,255,255,0.3)',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default WeatherView;
