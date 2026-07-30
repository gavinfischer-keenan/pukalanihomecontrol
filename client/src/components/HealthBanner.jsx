import React, { useState, useEffect } from 'react';

const HealthBanner = () => {
  const [healthStatus, setHealthStatus] = useState(null);
  const [hiddenBanners, setHiddenBanners] = useState({});

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) {
          const data = await response.json();
          setHealthStatus(data);
          setHiddenBanners({}); // Re-evaluate and show banners if still degraded
        }
      } catch (error) {
        console.error('Failed to fetch health status:', error);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 60000); // 60 seconds
    return () => clearInterval(interval);
  }, []);

  if (!healthStatus || !healthStatus.checks) return null;

  const checks = healthStatus.checks;
  
  const aisDown = checks.ais && checks.ais.ok === false;
  const adsbDown = checks.adsb && checks.adsb.ok === false;
  const dbDown = checks.database && checks.database.ok === false;

  const banners = [];

  if (dbDown && !hiddenBanners['db']) {
    banners.push({
      id: 'db',
      type: 'red',
      message: '🔴 Database Connection Lost'
    });
  }

  if (aisDown && adsbDown && !hiddenBanners['both_receivers']) {
    banners.push({
      id: 'both_receivers',
      type: 'red',
      message: '🔴 Local Receivers Offline — hardware check needed'
    });
  } else {
    if (aisDown && !adsbDown && !hiddenBanners['ais']) {
      banners.push({
        id: 'ais',
        type: 'amber',
        message: '⚠️ AIS Receiver Offline — showing AISHub data only (reduced coverage)'
      });
    }
    if (adsbDown && !aisDown && !hiddenBanners['adsb']) {
      banners.push({
        id: 'adsb',
        type: 'amber',
        message: '⚠️ ADS-B Receiver Offline — showing external data only'
      });
    }
  }

  const handleDismiss = (id) => {
    setHiddenBanners(prev => ({ ...prev, [id]: true }));
  };

  if (banners.length === 0) return null;

  return (
    <div className="health-banner-container">
      {banners.map(banner => (
        <div key={banner.id} className={`health-banner glass banner-${banner.type}`}>
          <span>{banner.message}</span>
          <button className="health-banner-dismiss" onClick={() => handleDismiss(banner.id)}>×</button>
        </div>
      ))}
    </div>
  );
};

export default HealthBanner;
