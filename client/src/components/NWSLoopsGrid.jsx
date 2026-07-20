import { useState, useEffect, useCallback } from 'react';

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes
const FRESH_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

function timeSince(isoStr) {
  if (!isoStr) return null;
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '< 1 min ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function isFresh(isoStr) {
  if (!isoStr) return false;
  return Date.now() - new Date(isoStr).getTime() < FRESH_THRESHOLD_MS;
}

export default function NWSLoopsGrid({ apiBase }) {
  const [loops, setLoops]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [expanded, setExpanded] = useState(null);

  const fetchLoops = useCallback(async () => {
    try {
      const data = await fetch(`${apiBase}/api/nws/loops`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      const loopsArr = data.loops || data;
      setLoops(Array.isArray(loopsArr) ? loopsArr : []);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchLoops();
    const t = setInterval(fetchLoops, REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchLoops]);

  if (loading) {
    return (
      <div className="nws-loops-scroll">
        <div className="nws-loop-spinner">Loading loops…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="nws-loops-scroll">
        <div className="nws-fetch-error">⚠ Failed to load loops: {error}</div>
      </div>
    );
  }

  if (!loops.length) {
    return (
      <div className="nws-loops-scroll">
        <div className="nws-placeholder">No loops available yet — server may still be caching.</div>
      </div>
    );
  }

  return (
    <div className="nws-loops-scroll">
      <div className="nws-loops-grid">
        {loops.map(loop => {
          const isExpanded = expanded === loop.id;
          const fresh      = isFresh(loop.updatedAt);
          const timeLabel  = timeSince(loop.updatedAt);
          return (
            <div
              key={loop.id}
              className={`nws-loop-card${isExpanded ? ' expanded' : ''}`}
              onClick={() => setExpanded(isExpanded ? null : loop.id)}
            >
              <div className="nws-loop-card-header">
                <span className="nws-loop-icon">{loop.icon || '🌐'}</span>
                <span className="nws-loop-name">{loop.name}</span>
                {fresh && <span className="nws-loop-dot" title="Recently updated" />}
                {timeLabel && (
                  <span className="nws-loop-time">{timeLabel}</span>
                )}
              </div>
              <div className="nws-loop-img-wrap">
                {loop.localUrl ? (
                  <img
                    src={`${apiBase}${loop.localUrl}?t=${Date.now()}`}
                    alt={loop.name}
                    loading="lazy"
                  />
                ) : (
                  <div className="nws-loop-spinner">
                    ⏳ Caching…
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
