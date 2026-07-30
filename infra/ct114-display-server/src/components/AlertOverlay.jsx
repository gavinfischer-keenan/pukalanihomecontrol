import React, { useState, useEffect } from 'react';

const AlertOverlay = ({ alert }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!alert || alert.level === 'Clear') {
      setVisible(false);
      return;
    }
    
    setVisible(true);

    if (alert.level === 'Soon') {
      const timer = setTimeout(() => setVisible(false), 30 * 60 * 1000);
      return () => clearTimeout(timer);
    } else if (alert.level === 'Information') {
      const timer = setTimeout(() => setVisible(false), 10 * 60 * 1000);
      return () => clearTimeout(timer);
    }
  }, [alert]);

  if (!visible || !alert || alert.level === 'Clear') return null;

  let style = {};
  let icon = '⚠️';
  
  if (alert.level === 'SEVERE') {
    style = { backgroundColor: '#ff0000', color: 'white', animation: 'pulse 2s infinite' };
    icon = '🚨';
  } else if (alert.level === 'Soon') {
    style = { backgroundColor: '#ff9900', color: '#333' };
    icon = '⏳';
  } else if (alert.level === 'Information') {
    style = { backgroundColor: '#0066ff', color: 'white' };
    icon = 'ℹ️';
  }

  const date = new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '80px',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 20px',
      boxSizing: 'border-box',
      fontWeight: 'bold',
      fontSize: '24px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
      ...style
    }}>
      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7); }
          70% { box-shadow: 0 0 0 20px rgba(255, 0, 0, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); }
        }
      `}</style>
      <span style={{ marginRight: '15px', fontSize: '32px' }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alert.message}</span>
      <span style={{ fontSize: '18px', opacity: 0.8 }}>{date}</span>
    </div>
  );
};

export default AlertOverlay;
