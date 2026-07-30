import React, { useState, useEffect, useRef } from 'react';
import CameraGrid from './CameraGrid';
import VesselView from './VesselView';
import WeatherView from './WeatherView';

/**
 * CycleView — Full-screen auto-cycling through a list of views.
 * Each step has its own view type, config, and dwell time.
 *
 * Props:
 *   config.cycleSteps — Array of { viewId, viewConfig, dwellSeconds }
 */

const viewComponentMap = {
  cams: CameraGrid,
  vessels: VesselView,
  weather: WeatherView,
  house_status: () => (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#0a0f1a', color: '#475569', fontSize: '1.5rem', gap: 12,
    }}>
      <span style={{ fontSize: '3rem' }}>🏠</span>
      House Status — Coming Soon
    </div>
  ),
};

const CycleView = React.memo(({ config }) => {
  const steps = config?.cycleSteps || [];
  const [activeIdx, setActiveIdx] = useState(0);
  const [fading, setFading] = useState(false);
  const timerRef = useRef(null);

  // Reset index if steps change
  useEffect(() => {
    if (steps.length > 0 && activeIdx >= steps.length) {
      setActiveIdx(0);
    }
  }, [steps.length, activeIdx]);

  // Auto-advance timer
  useEffect(() => {
    if (steps.length <= 1) return;
    if (timerRef.current) clearTimeout(timerRef.current);

    const currentStep = steps[activeIdx];
    const dwellMs = (currentStep?.dwellSeconds || 30) * 1000;

    timerRef.current = setTimeout(() => {
      setFading(true);
      // Brief fade, then switch
      setTimeout(() => {
        setActiveIdx(prev => (prev + 1) % steps.length);
        setFading(false);
      }, 500);
    }, dwellMs);

    return () => clearTimeout(timerRef.current);
  }, [activeIdx, steps]);

  if (steps.length === 0) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#0a0f1a', color: '#475569', fontSize: '1.2rem',
      }}>
        No cycle steps configured — use the Remote to add views
      </div>
    );
  }

  const currentStep = steps[activeIdx] || steps[0];
  const ViewComponent = viewComponentMap[currentStep.viewId];

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      background: '#000', overflow: 'hidden',
    }}>
      {/* Current view */}
      <div style={{
        width: '100%', height: '100%',
        opacity: fading ? 0 : 1,
        transition: 'opacity 0.5s ease-in-out',
      }}>
        {ViewComponent ? (
          <ViewComponent config={currentStep.viewConfig || {}} />
        ) : (
          <div style={{
            width: '100%', height: '100%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#475569',
          }}>
            Unknown view: {currentStep.viewId}
          </div>
        )}
      </div>

      {/* Progress dots */}
      {steps.length > 1 && (
        <div style={{
          position: 'absolute', bottom: 12, left: '50%',
          transform: 'translateX(-50%)', zIndex: 20,
          display: 'flex', gap: 8, padding: '6px 12px',
          background: 'rgba(0,0,0,0.6)', borderRadius: 20,
        }}>
          {steps.map((step, idx) => (
            <div
              key={idx}
              title={step.viewId}
              style={{
                width: 10, height: 10, borderRadius: '50%',
                background: idx === activeIdx ? '#3b82f6' : 'rgba(255,255,255,0.25)',
                transition: 'background 0.3s',
                boxShadow: idx === activeIdx ? '0 0 6px #3b82f6' : 'none',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default CycleView;
