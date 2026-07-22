import { useState, useEffect, useRef } from 'react';
import './NWSForecastPanel.css';

/* ── Product Catalog ──────────────────────────────────────────────────── */
const CATEGORIES = [
  {
    key: 'surf',
    icon: '🏄',
    label: 'Surf',
    products: [
      { id: 'SRF', label: 'Surf Forecast', desc: 'Wave heights, swell direction, surf conditions' },
    ],
  },
  {
    key: 'weather',
    icon: '🌤️',
    label: 'Weather',
    products: [
      { id: 'AFD', label: 'Area Forecast Discussion', desc: 'Meteorologist analysis & reasoning' },
      { id: 'RWR', label: 'Regional Weather Roundup', desc: 'Current conditions across Hawaii' },
    ],
  },
  {
    key: 'marine',
    icon: '⛵',
    label: 'Marine',
    products: [
      { id: 'CWF', label: 'Coastal Waters Forecast', desc: 'Wind, seas & conditions for near-shore waters' },
      { id: 'HSF', label: 'High Seas Forecast', desc: 'Open ocean conditions & warnings' },
    ],
  },
  {
    key: 'climate',
    icon: '📊',
    label: 'Climate',
    products: [],           // No text products; rendered as ENSO + CPC
  },
];

const CPC_IMAGES = [
  {
    id: 'hi-temp',
    label: '🌡️ 90-Day Temperature Outlook',
    url: 'https://www.cpc.ncep.noaa.gov/products/predictions/90day/tools/briefing/hi.temp.gif',
  },
  {
    id: 'hi-prcp',
    label: '🌧️ 90-Day Precipitation Outlook',
    url: 'https://www.cpc.ncep.noaa.gov/products/predictions/90day/tools/briefing/hi.prcp.gif',
  },
];

/* ── Helpers ──────────────────────────────────────────────────────────── */
function formatIssuance(raw) {
  if (!raw) return '';
  const match = raw.match(/\d{3,4}\s*[AP]M\s+\w+\s+\w+\s+\w+\s+\d+\s+\d{4}/);
  if (match) return match[0];
  const line = raw.split('\n').find(l => l.trim());
  return line ? line.slice(0, 60) : '';
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 60000;
  if (diff < 1) return 'just now';
  if (diff < 60) return `${Math.round(diff)}m ago`;
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`;
  return `${Math.round(diff / 1440)}d ago`;
}

/* ── Product Card (accordion) ─────────────────────────────────────────── */
function ProductCard({ id, label, desc, apiBase, defaultOpen }) {
  const [open, setOpen]   = useState(defaultOpen);
  const [text, setText]   = useState(null);
  const [time, setTime]   = useState('');
  const [iso,  setIso]    = useState('');
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    fetch(`${apiBase}/api/nws/text/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => {
        setText(d.text || d.raw || '');
        const issued = d.issuedAt || '';
        setIso(issued);
        setTime(
          issued
            ? new Date(issued).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : formatIssuance(d.text || '')
        );
      })
      .catch(e => setError(e.message));
  }, [apiBase, id]);

  return (
    <div ref={ref} id={`forecast-${id}`} className={`nfp-card${open ? ' open' : ''}`}>
      <button className="nfp-card-header" onClick={() => setOpen(o => !o)}>
        <div className="nfp-card-left">
          <span className="nfp-card-id">{id}</span>
          <div className="nfp-card-meta">
            <span className="nfp-card-label">{label}</span>
            {desc && <span className="nfp-card-desc">{desc}</span>}
          </div>
        </div>
        <div className="nfp-card-right">
          {time && <span className="nfp-card-time" title={iso}>{time}</span>}
          {iso && <span className="nfp-card-ago">{timeAgo(iso)}</span>}
          <span className={`nfp-chevron${open ? ' open' : ''}`}>▾</span>
        </div>
      </button>
      {open && (
        <div className="nfp-card-body">
          {error ? (
            <div className="nfp-error">⚠ {error}</div>
          ) : text === null ? (
            <div className="nfp-loading">Loading…</div>
          ) : (
            <pre className="nfp-text">{text}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ── ENSO Section ─────────────────────────────────────────────────────── */
function EnsoSection({ apiBase }) {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/api/nws/enso`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => setData(d))
      .catch(e => setError(e.message));
  }, [apiBase]);

  if (error) return <div className="nfp-error">⚠ ENSO data unavailable: {error}</div>;
  if (!data) return <div className="nfp-loading">Loading ENSO…</div>;

  const phase   = data.phase || 'neutral';
  const history = Array.isArray(data.history) ? data.history.slice(-24) : [];
  const maxAbs  = Math.max(1, ...history.map(h => Math.abs(h.oni || 0)));

  return (
    <div className="nfp-enso">
      <div className="nfp-enso-header">
        <span className={`nfp-enso-phase ${phase}`}>
          {phase === 'el_nino' ? 'El Niño' : phase === 'la_nina' ? 'La Niña' : 'Neutral'}
        </span>
        <span className="nfp-enso-desc">
          {data.description || `ONI: ${data.oni != null ? data.oni.toFixed(2) : 'N/A'}`}
        </span>
      </div>
      {history.length > 0 && (
        <div className="nfp-enso-bars" title="Last 24 seasons — ONI index">
          {history.map((h, i) => {
            const barH = Math.max(4, Math.round((Math.abs(h.oni || 0) / maxAbs) * 56));
            return (
              <div key={i} className="nfp-enso-bar-wrap" title={`${h.season || ''}: ${h.oni != null ? h.oni.toFixed(2) : '?'}`}>
                <div className={`nfp-enso-bar ${h.phase || 'neutral'}`} style={{ height: `${barH}px` }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── CPC Outlook Images ───────────────────────────────────────────────── */
function CpcImages() {
  const ts = Date.now();
  return (
    <div className="nfp-cpc-grid">
      {CPC_IMAGES.map(img => (
        <div key={img.id} className="nfp-cpc-card">
          <div className="nfp-cpc-label">{img.label}</div>
          <img src={`${img.url}?t=${ts}`} alt={img.label} onError={e => { e.target.style.opacity = 0.3; }} />
        </div>
      ))}
    </div>
  );
}

/* ── Main Panel ───────────────────────────────────────────────────────── */
export default function NWSForecastPanel({ apiBase }) {
  const [activeCat, setActiveCat] = useState('surf');

  const cat = CATEGORIES.find(c => c.key === activeCat) || CATEGORIES[0];

  return (
    <div className="nfp-root">
      {/* ── Category nav bar ── */}
      <nav className="nfp-nav">
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            className={`nfp-nav-btn${activeCat === c.key ? ' active' : ''}`}
            onClick={() => setActiveCat(c.key)}
          >
            <span className="nfp-nav-icon">{c.icon}</span>
            <span className="nfp-nav-label">{c.label}</span>
          </button>
        ))}
      </nav>

      {/* ── Jump links (within active category) ── */}
      {cat.products.length > 1 && (
        <div className="nfp-jump">
          <span className="nfp-jump-label">Jump to:</span>
          {cat.products.map(p => (
            <a
              key={p.id}
              className="nfp-jump-link"
              href={`#forecast-${p.id}`}
              onClick={e => {
                e.preventDefault();
                document.getElementById(`forecast-${p.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {p.id}
            </a>
          ))}
        </div>
      )}

      {/* ── Content area ── */}
      <div className="nfp-content">
        {cat.key === 'climate' ? (
          <>
            <div className="nfp-section-title">ENSO / RONI Tracker</div>
            <EnsoSection apiBase={apiBase} />
            <div className="nfp-section-title" style={{ marginTop: '1.5rem' }}>CPC 90-Day Outlooks — Hawaii</div>
            <CpcImages />
          </>
        ) : (
          cat.products.map((p, i) => (
            <ProductCard
              key={p.id}
              id={p.id}
              label={p.label}
              desc={p.desc}
              apiBase={apiBase}
              defaultOpen={i === 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
