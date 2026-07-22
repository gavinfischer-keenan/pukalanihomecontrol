import { useState, useEffect, useCallback, useRef } from 'react';
import './NWSLoopsGrid.css';

// How often to re-poll the metadata API while live refresh is active
const LIVE_POLL_MS   = 60 * 1000;   // 1 min — just to pick up updatedAt timestamps
// How often to re-poll when no live refresh (quiet background)
const QUIET_POLL_MS  = 10 * 60 * 1000;  // 10 min

/* ── Descriptions for each loop type ─────────────────────────────────── */
const DESCRIPTIONS = {
  geocolor:   'True-color daytime / infrared night composite. Shows clouds as they appear to the eye during the day, and thermal city lights at night.',
  infrared:   'Band 13 longwave infrared. Reveals cloud-top temperatures — brighter white = colder = taller storms. Essential for tracking tropical systems.',
  watervapor: 'Mid-level water vapor (Band 8). Shows moisture flow in the atmosphere at ~20,000–30,000ft. Dark areas = dry air, bright = moist.',
  npac:       'Wide-area view of the North Pacific basin. Tracks large-scale weather systems, fronts, and tropical disturbances approaching Hawaii.',
};

const TIPS = {
  geocolor:   'Best for: General weather awareness, cloud identification',
  infrared:   'Best for: Storm tracking, thunderstorm intensity, overnight monitoring',
  watervapor: 'Best for: Identifying moisture plumes, upper-level troughs, Kona Low precursors',
  npac:       'Best for: Multi-day weather outlook, tracking distant storms',
};

function timeSince(isoStr) {
  if (!isoStr) return null;
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '< 1 min ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export default function NWSLoopsGrid({ apiBase }) {
  const [loops,             setLoops]             = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState(null);
  const [selected,          setSelected]          = useState(null);
  const [liveRefreshActive, setLiveRefreshActive] = useState(false);
  // imgKeys: per-loop cache-busting key, incremented when we know the image refreshed
  const [imgKeys,           setImgKeys]           = useState({});
  const prevUpdatedAt = useRef({});
  const pollTimerRef  = useRef(null);

  const fetchLoops = useCallback(async () => {
    try {
      const data = await fetch(`${apiBase}/api/nws/loops`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      const loopsArr = data.loops || data;
      const arr = Array.isArray(loopsArr) ? loopsArr : [];

      // Detect any loop whose updatedAt changed → bust that image cache key
      setImgKeys(prev => {
        const next = { ...prev };
        let changed = false;
        for (const l of arr) {
          if (l.updatedAt && l.updatedAt !== prevUpdatedAt.current[l.id]) {
            next[l.id] = (prev[l.id] || 0) + 1;
            prevUpdatedAt.current[l.id] = l.updatedAt;
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      setLoops(arr);
      setLiveRefreshActive(!!data.liveRefreshActive);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // Start polling on mount; adjust cadence based on liveRefreshActive
  useEffect(() => {
    fetchLoops();  // initial fetch (triggers live refresh on server)
  }, [fetchLoops]);

  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const pollMs = liveRefreshActive ? LIVE_POLL_MS : QUIET_POLL_MS;
    pollTimerRef.current = setInterval(fetchLoops, pollMs);
    return () => clearInterval(pollTimerRef.current);
  }, [liveRefreshActive, fetchLoops]);

  // Auto-select first loop
  useEffect(() => {
    if (!selected && loops.length > 0) {
      setSelected(loops[0].id);
    }
  }, [loops, selected]);

  // ── Render ─────────────────────────────────────────────────────────────

  // Show loading spinner only on very first load with no cached data at all
  if (loading && loops.length === 0) {
    return <div className="nlg-status">Loading satellite loops…</div>;
  }
  if (error && loops.length === 0) {
    return <div className="nlg-status nlg-error">⚠ Failed to load loops: {error}</div>;
  }
  if (!loops.length) {
    return <div className="nlg-status">No loops available yet — server may still be caching.</div>;
  }

  const activeLoop = loops.find(l => l.id === selected) || loops[0];
  const imgKey     = imgKeys[activeLoop.id] || 0;

  return (
    <div className="nlg-root">
      {/* ── Left: Loop selector list ── */}
      <div className="nlg-sidebar">
        <div className="nlg-sidebar-title">Satellite &amp; Radar Loops</div>
        <div className="nlg-list">
          {loops.map(loop => {
            const isActive  = selected === loop.id;
            const desc      = DESCRIPTIONS[loop.id] || '';
            const timeLabel = timeSince(loop.updatedAt);

            return (
              <button
                key={loop.id}
                className={`nlg-item${isActive ? ' active' : ''}`}
                onClick={() => setSelected(loop.id)}
              >
                <div className="nlg-item-top">
                  <span className="nlg-item-icon">{loop.icon || '🌐'}</span>
                  <span className="nlg-item-name">{loop.name}</span>
                  {timeLabel && <span className="nlg-item-time">{timeLabel}</span>}
                </div>
                <div className="nlg-item-desc">{desc}</div>
                {TIPS[loop.id] && (
                  <div className="nlg-item-tip">💡 {TIPS[loop.id]}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: Selected loop viewer ── */}
      <div className="nlg-viewer">
        <div className="nlg-viewer-header">
          <span className="nlg-viewer-icon">{activeLoop.icon || '🌐'}</span>
          <span className="nlg-viewer-title">{activeLoop.name}</span>
          {timeSince(activeLoop.updatedAt) && (
            <span className="nlg-viewer-time">Cached {timeSince(activeLoop.updatedAt)}</span>
          )}
        </div>
        <div className="nlg-viewer-img-wrap">
          {activeLoop.localUrl ? (
            <img
              key={`${activeLoop.id}-${imgKey}`}
              src={`${apiBase}${activeLoop.localUrl}?v=${imgKey}`}
              alt={activeLoop.name}
            />
          ) : (
            <div className="nlg-viewer-placeholder">⏳ Caching imagery…</div>
          )}
        </div>

        {/* ── Live refresh banner ── */}
        {liveRefreshActive && (
          <div className="nlg-refresh-banner">
            <span className="nlg-refresh-spinner" />
            Fetching current loop from NOAA — image will update automatically
          </div>
        )}
        {!liveRefreshActive && activeLoop.updatedAt && (
          <div className="nlg-cache-note">
            📦 Showing cached loop · Next background refresh at 05:00, 11:00, 17:00 or 23:00 HST
          </div>
        )}
      </div>
    </div>
  );
}
