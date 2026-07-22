import { useState, useEffect, useCallback, useRef } from 'react';
import './NWSLoopsGrid.css';

const LIVE_POLL_MS  = 60 * 1000;
const QUIET_POLL_MS = 10 * 60 * 1000;

/* ── Day-only loops (visible band — white at night) ─────────────────────── */
const DAY_ONLY = new Set(['hfo_state_vis', 'hfo_oahu_vis', 'hfo_hi_vis', 'hfo_kauai_vis']);

/* ── Descriptions ────────────────────────────────────────────────────────── */
const DESCRIPTIONS = {
  geocolor:      'True-color daytime / infrared night composite. Best general-purpose loop — shows clouds as they appear to the eye during the day.',
  infrared:      'Band 13 longwave IR. Cloud-top temperatures: bright white = colder = taller storms. Essential for overnight and tropical tracking.',
  watervapor:    'Band 8 upper-level water vapor (~20,000–30,000ft). Dark = dry air, bright = moist. Great for tracking troughs and Kona Low precursors.',
  hfo_state_vis: 'Full State of Hawaii visible loop from NWS Honolulu. Best overview of island-scale cloud patterns and trade wind flow.',
  hfo_oahu_vis:  'Oahu and Maui county islands visible loop. Higher detail for the populated main islands.',
  hfo_hi_vis:    'Big Island (Hawaii County) visible loop. Useful for watching orographic clouds over Mauna Kea/Loa and vog plumes.',
  hfo_kauai_vis: 'Kauai visible loop. Detailed view of the Garden Isle — useful for watching north-shore cloud buildup.',
  hfo_ir:        'Hawaii Infrared loop from NWS HFO. Shows cloud-top temps across the island chain — complements the GOES-18 IR view.',
};

const TIPS = {
  geocolor:      'Best for: Daytime awareness, cloud identification, trade wind clouds',
  infrared:      'Best for: Storm tracking, overnight monitoring, thunderstorm intensity',
  watervapor:    'Best for: Moisture plumes, upper troughs, multi-day outlooks',
  hfo_state_vis: 'Best for: Island chain overview, daily weather awareness',
  hfo_oahu_vis:  'Best for: Oahu/Maui day-to-day cloud patterns',
  hfo_hi_vis:    'Best for: Big Island orographics, vog, summit visibility',
  hfo_kauai_vis: 'Best for: Kauai north shore conditions',
  hfo_ir:        'Best for: Nighttime cloud tracking, rain band identification',
};

/* Returns true if it is currently night in Hawaii (UTC-10) */
function isNightHST() {
  const hstHour = (new Date().getUTCHours() - 10 + 24) % 24;
  return hstHour >= 20 || hstHour < 6; // 8pm – 6am HST
}

function timeSince(isoStr) {
  if (!isoStr) return null;
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '< 1 min ago';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

/* ── Group loops by their group field ───────────────────────────────────── */
function groupLoops(loops) {
  const groups = {};
  for (const l of loops) {
    const g = l.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(l);
  }
  return groups;
}

export default function NWSLoopsGrid({ apiBase }) {
  const [loops,             setLoops]             = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState(null);
  const [selected,          setSelected]          = useState(null);
  const [liveRefreshActive, setLiveRefreshActive] = useState(false);
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

  useEffect(() => { fetchLoops(); }, [fetchLoops]);

  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const pollMs = liveRefreshActive ? LIVE_POLL_MS : QUIET_POLL_MS;
    pollTimerRef.current = setInterval(fetchLoops, pollMs);
    return () => clearInterval(pollTimerRef.current);
  }, [liveRefreshActive, fetchLoops]);

  useEffect(() => {
    if (!selected && loops.length > 0) setSelected(loops[0].id);
  }, [loops, selected]);

  if (loading && loops.length === 0) {
    return <div className="nlg-status">Loading satellite imagery…</div>;
  }
  if (error && loops.length === 0) {
    return <div className="nlg-status nlg-error">⚠ Failed to load imagery: {error}</div>;
  }
  if (!loops.length) {
    return <div className="nlg-status">No imagery available yet — server may still be caching.</div>;
  }

  const activeLoop = loops.find(l => l.id === selected) || loops[0];
  const imgKey     = imgKeys[activeLoop.id] || 0;
  const grouped    = groupLoops(loops);

  return (
    <div className="nlg-root">
      {/* ── Left: grouped loop selector ── */}
      <div className="nlg-sidebar">
        <div className="nlg-sidebar-title">Satellite Imagery</div>
        <div className="nlg-list">
          {Object.entries(grouped).map(([groupName, items]) => (
            <div key={groupName} className="nlg-group">
              <div className="nlg-group-label">{groupName}</div>
              {items.map(loop => {
                const isActive  = selected === loop.id;
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
                      {DAY_ONLY.has(loop.id) && (
                        <span className={`nlg-day-badge${isNightHST() ? ' nlg-day-badge--night' : ''}`}>
                          {isNightHST() ? '🌙 night' : '☀️ day'}
                        </span>
                      )}
                      {timeLabel && <span className="nlg-item-time">{timeLabel}</span>}
                    </div>
                    {DESCRIPTIONS[loop.id] && (
                      <div className="nlg-item-desc">{DESCRIPTIONS[loop.id]}</div>
                    )}
                    {TIPS[loop.id] && (
                      <div className="nlg-item-tip">💡 {TIPS[loop.id]}</div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: viewer ── */}
      <div className="nlg-viewer">
        <div className="nlg-viewer-header">
          <span className="nlg-viewer-icon">{activeLoop.icon || '🌐'}</span>
          <span className="nlg-viewer-title">{activeLoop.name}</span>
          {activeLoop.group && (
            <span className="nlg-viewer-group">{activeLoop.group}</span>
          )}
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
          {DAY_ONLY.has(activeLoop.id) && isNightHST() && (
            <div className="nlg-night-overlay">
              🌙 Visible satellite requires sunlight
              <span>White frames are normal at night · Switch to Infrared or Water Vapor for 24/7 coverage</span>
            </div>
          )}
        </div>

        {liveRefreshActive && (
          <div className="nlg-refresh-banner">
            <span className="nlg-refresh-spinner" />
            Fetching current imagery from NOAA/NWS — will update automatically
          </div>
        )}
        {!liveRefreshActive && activeLoop.updatedAt && (
          <div className="nlg-cache-note">
            📦 Showing cached imagery · Background refresh: 05:00, 11:00, 17:00, 23:00 HST
          </div>
        )}
      </div>
    </div>
  );
}
