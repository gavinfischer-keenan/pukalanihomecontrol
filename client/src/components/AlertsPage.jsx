import { useState, useEffect, useCallback } from 'react';
import './AlertsPage.css';

const ALERTS_API = `http://${window.location.hostname}:3001/api/alerts`;

const CATEGORY_META = {
  house:    { icon: '🏠', label: 'HOUSE ALERTS', order: 0 },
  tsunami:  { icon: '🌊', label: 'TSUNAMI',      order: 1 },
  marine:   { icon: '⛵', label: 'MARINE',        order: 2 },
  aviation: { icon: '✈️', label: 'AVIATION',      order: 3 },
  beach:    { icon: '🏖️', label: 'BEACH',         order: 4 },
  police:   { icon: '🚔', label: 'POLICE / FIRE', order: 5 },
};

const SEVERITY_ORDER = { EXTREME: 0, SEVERE: 1, MODERATE: 2, MINOR: 3, UNKNOWN: 4 };

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    });
  } catch { return ''; }
}

function formatAge(iso) {
  if (!iso) return '';
  try {
    const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  } catch { return ''; }
}

function SummaryBadge({ label, count, cls }) {
  if (count === 0) return null;
  return (
    <div className={`alerts-count-badge ${cls}`}>
      <span>{count}</span>
      <span>{label}</span>
    </div>
  );
}

function AlertCard({ alert }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`alert-card severity-${alert.severity}`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="alert-card-top">
        <span className="alert-severity-tag">{alert.severity}</span>
        <span className="alert-title">{alert.title}</span>
        <span className="alert-source">{alert.source}</span>
      </div>

      {(expanded || alert.severity === 'EXTREME' || alert.severity === 'SEVERE') && (
        <div className="alert-body">{alert.body}</div>
      )}

      {alert.action && (expanded || alert.severity === 'EXTREME') && (
        <div className="alert-action">
          <span className="alert-action-icon">📋</span>
          <span className="alert-action-text">{alert.action}</span>
        </div>
      )}

      <div className="alert-footer">
        {alert.issued && (
          <span className="alert-meta">Issued: {formatTime(alert.issued)} ({formatAge(alert.issued)})</span>
        )}
        {alert.expires && (
          <span className="alert-meta">Expires: {formatTime(alert.expires)}</span>
        )}
        {!expanded && alert.body && alert.severity !== 'EXTREME' && alert.severity !== 'SEVERE' && (
          <span className="alert-meta" style={{ color: '#37474f', fontStyle: 'italic' }}>Click for details</span>
        )}
      </div>
    </div>
  );
}

function CategorySection({ category, alerts }) {
  const meta = CATEGORY_META[category] || { icon: '⚠️', label: category.toUpperCase() };
  const sorted = [...alerts].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );

  return (
    <div className="alerts-category">
      <div className="alerts-category-header">
        <span className="alerts-category-icon">{meta.icon}</span>
        <span className="alerts-category-title">{meta.label}</span>
        <span className="alerts-category-count">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</span>
      </div>
      {sorted.map(alert => (
        <AlertCard key={alert.id} alert={alert} />
      ))}
    </div>
  );
}

export default function AlertsPage({ onClose }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(ALERTS_API);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAlerts(Array.isArray(data) ? data : []);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(`Unable to reach alerts service: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const t = setInterval(fetchAlerts, 30000);
    return () => clearInterval(t);
  }, [fetchAlerts]);

  // Group by category, sorted by category order then severity
  const grouped = {};
  alerts.forEach(a => {
    if (!grouped[a.category]) grouped[a.category] = [];
    grouped[a.category].push(a);
  });

  const categoriesInOrder = Object.keys(grouped).sort((a, b) => {
    const oa = CATEGORY_META[a]?.order ?? 99;
    const ob = CATEGORY_META[b]?.order ?? 99;
    return oa - ob;
  });

  // Summary counts
  const counts = { EXTREME: 0, SEVERE: 0, MODERATE: 0, MINOR: 0 };
  alerts.forEach(a => { if (counts[a.severity] !== undefined) counts[a.severity]++; });
  const totalActive = alerts.length;

  const allClear = !loading && !error && totalActive === 0;

  return (
    <div className="alerts-overlay">
      {/* Header */}
      <div className="alerts-header">
        <span className="alerts-header-icon">🚨</span>
        <span className="alerts-header-title">Alerts &amp; Advisories</span>
        <span className="alerts-header-location">Pukalani, Oahu · 50 nm radius</span>
        {lastUpdate && (
          <span className="alerts-last-update">Updated {formatAge(lastUpdate)}</span>
        )}
        <button className="alerts-refresh-btn" onClick={fetchAlerts}>↻ Refresh</button>
        <button className="alerts-close-btn" onClick={onClose}>✕</button>
      </div>

      {/* Summary bar */}
      {!loading && !error && (
        <div className="alerts-summary-bar">
          {totalActive === 0
            ? <div className="alerts-count-badge badge-clear">✓ All Clear</div>
            : <>
                <SummaryBadge label="EXTREME" count={counts.EXTREME} cls="badge-extreme" />
                <SummaryBadge label="SEVERE"  count={counts.SEVERE}  cls="badge-severe" />
                <SummaryBadge label="MODERATE" count={counts.MODERATE} cls="badge-moderate" />
                <SummaryBadge label="MINOR"   count={counts.MINOR}   cls="badge-minor" />
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: '10px', color: '#37474f', alignSelf: 'center' }}>
                  {totalActive} active alert{totalActive !== 1 ? 's' : ''}
                </span>
              </>
          }
        </div>
      )}

      {/* Body */}
      <div className="alerts-body">
        {loading && (
          <div className="alerts-loading">
            <span>⏳</span>
            <span>Loading alerts from all sources…</span>
          </div>
        )}

        {error && (
          <div className="alerts-error">
            ⚠️ {error}
            <br />
            <small>Alerts service may be starting up. Will retry automatically.</small>
          </div>
        )}

        {allClear && (
          <div className="alerts-all-clear">
            <div className="all-clear-icon">✅</div>
            <div className="all-clear-title">All Clear</div>
            <div className="all-clear-sub">
              No active marine, aviation, beach, or house alerts at this time.
              Monitoring NOAA, FAA, and all home sensors.
            </div>
          </div>
        )}

        {categoriesInOrder.map(cat => (
          <CategorySection key={cat} category={cat} alerts={grouped[cat]} />
        ))}
      </div>
    </div>
  );
}
