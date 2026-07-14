import { useState, useEffect, useRef } from 'react';
import useDraggable from './useDraggable';
import './AirportStatusBar.css';

const ALWAYS_ON = ['KHNL'];

async function fetchFAAStatus() {
  try {
    const apiBase = window.location.hostname === 'localhost'
      ? 'http://localhost:3001'
      : `http://${window.location.hostname}:3001`;
    const r = await fetch(`${apiBase}/api/airport-status`);
    if (!r.ok) return null;
    const xml = await r.text();
    
    const status = {};
    
    const extractPrograms = (xmlStr, typeName) => {
      const blockRegex = new RegExp(`<Name>${typeName}</Name>.*?(?:</Delay_type>|<Name>)`, 'is');
      const blockMatch = xmlStr.match(blockRegex);
      if (!blockMatch) return [];
      
      const programs = [];
      const progMatches = blockMatch[0].matchAll(/<Program>(.*?)<\/Program>/gs);
      for (const m of progMatches) {
        const arpt = m[1].match(/<ARPT>([^<]+)<\/ARPT>/)?.[1];
        const reason = m[1].match(/<Reason>([^<]+)<\/Reason>/)?.[1];
        if (arpt) programs.push({ arpt, reason, type: typeName });
      }
      return programs;
    };

    const gsp = extractPrograms(xml, 'Ground Stop Programs');
    const gdp = extractPrograms(xml, 'Ground Delay Programs');
    const arr = extractPrograms(xml, 'Arrival Delays');
    const dep = extractPrograms(xml, 'Departure Delays');
    const clo = extractPrograms(xml, 'Airport Closures');

    const all = [...gsp, ...gdp, ...arr, ...dep, ...clo];
    for (const p of all) {
      if (!status[p.arpt]) status[p.arpt] = [];
      status[p.arpt].push(p);
    }
    
    return status;
  } catch {
    return null;
  }
}

function AirportCard({ code, delays, isOffline }) {
  const short = code.replace(/^K/, '');
  
  if (isOffline) {
    return (
      <div className="apt-card" style={{ borderColor: '#455a64', background: 'rgba(80,80,80,0.12)' }}>
        <div className="apt-card-head">
          <span className="apt-icao" style={{ color: '#78909c' }}>{short}</span>
          <span className="apt-cat" style={{ color: '#78909c', borderColor: '#455a64' }}>FAA Offline</span>
        </div>
      </div>
    );
  }

  if (!delays || delays.length === 0) {
    return (
      <div className="apt-card" style={{ borderColor: '#00c864', background: 'rgba(0,200,100,0.12)' }}>
        <div className="apt-card-head">
          <span className="apt-icao" style={{ color: '#00e676' }}>{short}</span>
          <span className="apt-cat" style={{ color: '#00e676', borderColor: '#00c864' }}>Normal Ops</span>
        </div>
      </div>
    );
  }

  return (
    <div className="apt-card" style={{ borderColor: '#f44336', background: 'rgba(244,67,54,0.15)' }}>
      <div className="apt-card-head">
        <span className="apt-icao" style={{ color: '#ef9a9a' }}>{short}</span>
        <span className="apt-cat" style={{ color: '#ef9a9a', borderColor: '#f44336' }}>Delays</span>
      </div>
      <div style={{ marginTop: '8px' }}>
        {delays.map((d, i) => (
          <div key={i} className="apt-delay" style={{ color: '#ff7043', fontSize: '10px', marginBottom: '4px', lineHeight: '1.2' }}>
            ⚠️ {d.type.replace(' Programs', '').replace(' Delays', ' Delay')}<br/>
            <span style={{ color: '#b0bec5', fontSize: '9px' }}>{d.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AirportStatusBar({ extraAirports, visible }) {
  const [faaData, setFaaData] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const intervalRef = useRef(null);

  const extras  = Object.entries(extraAirports || {})
    .filter(([, on]) => on)
    .map(([code]) => code);
  const allCodes = [...ALWAYS_ON, ...extras];

  useEffect(() => {
    if (!visible) return;
    const load = async () => {
      const data = await fetchFAAStatus();
      if (data === null) {
        setIsOffline(true);
      } else {
        setIsOffline(false);
        setFaaData(data);
      }
    };
    load();
    intervalRef.current = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [visible]);

  const dragProps = useDraggable('airportStatus', { x: window.innerWidth / 2 - 200, y: 12 });

  if (!visible) return null;

  return (
    <div className="apt-status-bar" {...dragProps}>
      {allCodes.map(code => {
        const shortCode = code.replace(/^K/, '');
        const delays = faaData ? (faaData[shortCode] || faaData[code]) : null;
        return (
          <AirportCard
            key={code}
            code={code}
            delays={delays}
            isOffline={isOffline || faaData === null}
          />
        );
      })}
    </div>
  );
}
