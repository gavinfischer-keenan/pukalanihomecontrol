import { useState, useEffect } from 'react';

const PRODUCTS = [
  { id: 'SRF', label: '🏄 Surf Forecast (SRF)' },
  { id: 'AFD', label: '💬 Area Forecast Discussion (AFD)' },
  { id: 'RWR', label: '🌡️ Regional Weather Roundup (RWR)' },
  { id: 'CWF', label: '⛵ Coastal Waters Forecast (CWF)' },
  { id: 'HSF', label: '🌊 High Seas Forecast (HSF)' },
];

const CPC_IMAGES = [
  {
    id: 'hi-temp',
    label: '🌡️ 90-Day Temp Outlook',
    url: 'https://www.cpc.ncep.noaa.gov/products/predictions/90day/tools/briefing/hi.temp.gif',
  },
  {
    id: 'hi-prcp',
    label: '🌧️ 90-Day Precip Outlook',
    url: 'https://www.cpc.ncep.noaa.gov/products/predictions/90day/tools/briefing/hi.prcp.gif',
  },
];

function formatIssuance(raw) {
  if (!raw) return '';
  // try to parse common NWS header patterns
  const match = raw.match(/\d{3,4}\s*[AP]M\s+\w+\s+\w+\s+\w+\s+\d+\s+\d{4}/);
  if (match) return match[0];
  // fallback: first non-empty line
  const line = raw.split('\n').find(l => l.trim());
  return line ? line.slice(0, 60) : '';
}

function ProductCard({ id, label, apiBase, defaultOpen }) {
  const [open, setOpen]   = useState(defaultOpen);
  const [text, setText]   = useState(null);
  const [time, setTime]   = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/api/nws/text/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        setText(d.text || d.raw || '');
        setTime(d.issuedAt ? new Date(d.issuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : formatIssuance(d.text || ''));
      })
      .catch(e => setError(e.message));
  }, [apiBase, id]);

  return (
    <div className={`nws-product-card${open ? ' open' : ''}`}>
      <div className="nws-product-header" onClick={() => setOpen(o => !o)}>
        <span className="nws-product-label">{label}</span>
        {time && <span className="nws-product-time">{time}</span>}
        <span className="nws-product-chevron">▼</span>
      </div>
      <div className="nws-product-body">
        {error ? (
          <div className="nws-fetch-error">⚠ {error}</div>
        ) : text === null ? (
          <div className="nws-loop-spinner">Loading…</div>
        ) : (
          <pre className="nws-product-text">{text}</pre>
        )}
      </div>
    </div>
  );
}

function EnsoSection({ apiBase }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/api/nws/enso`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => setData(d))
      .catch(e => setError(e.message));
  }, [apiBase]);

  if (error) {
    return <div className="nws-fetch-error">⚠ ENSO data unavailable: {error}</div>;
  }
  if (!data) {
    return <div className="nws-loop-spinner">Loading ENSO data…</div>;
  }

  const phase    = data.phase || 'neutral';
  const history  = Array.isArray(data.history) ? data.history.slice(-24) : [];
  const maxAbs   = Math.max(1, ...history.map(h => Math.abs(h.oni || 0)));

  return (
    <div className="nws-enso-card">
      <div className="nws-enso-top">
        <span className={`nws-enso-phase ${phase}`}>
          {phase === 'el_nino' ? 'El Niño' : phase === 'la_nina' ? 'La Niña' : 'Neutral'}
        </span>
        <span className="nws-enso-desc">
          {data.description || `ONI: ${data.oni != null ? data.oni.toFixed(2) : 'N/A'}`}
        </span>
      </div>
      {history.length > 0 && (
        <div className="nws-enso-bars" title="Last 24 seasons — ONI index">
          {history.map((h, i) => {
            const barH = Math.max(4, Math.round((Math.abs(h.oni || 0) / maxAbs) * 56));
            const cls  = h.phase || 'neutral';
            return (
              <div key={i} className="nws-enso-bar-wrap" title={`${h.season || ''}: ${h.oni != null ? h.oni.toFixed(2) : '?'}`}>
                <div
                  className={`nws-enso-bar ${cls}`}
                  style={{ height: `${barH}px` }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CpcImages() {
  const ts = Date.now();
  return (
    <div className="nws-cpc-grid">
      {CPC_IMAGES.map(img => (
        <div key={img.id} className="nws-cpc-card">
          <div className="nws-cpc-label">{img.label}</div>
          <img
            src={`${img.url}?t=${ts}`}
            alt={img.label}
            onError={e => { e.target.style.opacity = 0.3; }}
          />
        </div>
      ))}
    </div>
  );
}

export default function NWSForecastPanel({ apiBase }) {
  return (
    <div className="nws-forecast-scroll">
      {/* Text products */}
      <div>
        <div className="nws-section-title">Text Products</div>
        {PRODUCTS.map((p, i) => (
          <ProductCard
            key={p.id}
            id={p.id}
            label={p.label}
            apiBase={apiBase}
            defaultOpen={i === 0}
          />
        ))}
      </div>

      {/* ENSO / RONI tracker */}
      <div>
        <div className="nws-section-title">ENSO / RONI Tracker</div>
        <EnsoSection apiBase={apiBase} />
      </div>

      {/* CPC seasonal outlooks */}
      <div>
        <div className="nws-section-title">CPC 90-Day Outlooks — Hawaii</div>
        <CpcImages />
      </div>
    </div>
  );
}
