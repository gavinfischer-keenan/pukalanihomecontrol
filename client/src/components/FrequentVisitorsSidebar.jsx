import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from './FrequentVisitorsSidebar.module.css';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

function entityIcon(type) {
  return type === 'aircraft' ? '✈️' : '⛵';
}

const FILTER_ALL = 'all';
const FILTER_AIRCRAFT = 'aircraft';
const FILTER_VESSEL = 'vessel';

// ---------------------------------------------------------------------------
// PinForm — inline form to pin a new entity
// ---------------------------------------------------------------------------

function PinForm({ apiBase, onDone }) {
  const [identifier, setIdentifier] = useState('');
  const [type, setType] = useState('vessel');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setLoading(true);
    setError('');
    try {
      const endpoint =
        type === 'vessel'
          ? `${apiBase}/api/vessel-info/${identifier.trim()}`
          : `${apiBase}/api/aircraft-info/${identifier.trim()}`;
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_pinned: true }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setIdentifier('');
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={styles.pinForm} onSubmit={handleSubmit}>
      <div className={styles.pinFormRow}>
        <select
          className={styles.pinTypeSelect}
          value={type}
          onChange={(e) => setType(e.target.value)}
          disabled={loading}
        >
          <option value="vessel">⛵ Vessel</option>
          <option value="aircraft">✈️ Aircraft</option>
        </select>
        <input
          className={styles.pinInput}
          type="text"
          placeholder={type === 'vessel' ? 'MMSI…' : 'ICAO hex…'}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          disabled={loading}
        />
        <button className={styles.pinSubmit} type="submit" disabled={loading || !identifier.trim()}>
          {loading ? '…' : '+ Pin'}
        </button>
      </div>
      {error && <div className={styles.pinError}>{error}</div>}
    </form>
  );
}

// ---------------------------------------------------------------------------
// EntityRow
// ---------------------------------------------------------------------------

function EntityRow({ entity, apiBase, selected, onClick }) {
  const displayName = entity.friendly_name || entity.name || entity.identifier;
  const photoUrl =
    entity.first_photo
      ? `${apiBase}/uploads/entities/${entity.entity_type}/${entity.identifier}/${entity.first_photo}`
      : null;

  return (
    <div
      className={`${styles.entityRow} ${selected ? styles.entityRowSelected : ''}`}
      onClick={() => onClick(entity)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick(entity)}
      aria-selected={selected}
    >
      {/* Left: icon + photo */}
      <div className={styles.entityIconCol}>
        <span className={styles.entityTypeIcon}>{entityIcon(entity.entity_type)}</span>
        {photoUrl && (
          <img
            className={styles.entityThumb}
            src={photoUrl}
            alt={displayName}
            width={16}
            height={16}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
      </div>

      {/* Center: name + labels */}
      <div className={styles.entityInfo}>
        <div className={styles.entityNameRow}>
          <span className={styles.entityName}>{displayName}</span>
          <span className={styles.entityBadges}>
            {entity.is_pinned && <span className={styles.pinnedBadge} title="Pinned">⭐</span>}
            {entity.auto_detected && <span className={styles.autoBadge} title="Auto-detected">🤖</span>}
          </span>
        </div>
        {entity.days_label && (
          <div className={styles.entityDaysLabel}>{entity.days_label}</div>
        )}
        {entity.time_label && (
          <div className={styles.entityTimeLabel}>{entity.time_label}</div>
        )}
      </div>

      {/* Right: seen_days + last_seen */}
      <div className={styles.entityMeta}>
        {entity.seen_days != null && (
          <span className={styles.seenDaysBadge}>{entity.seen_days} days</span>
        )}
        <span className={styles.lastSeen}>{relativeTime(entity.last_seen)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FrequentVisitorsSidebar
// ---------------------------------------------------------------------------

export default function FrequentVisitorsSidebar({ apiBase, onSelectEntity, visible, onClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const [entities, setEntities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState(FILTER_ALL);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [showPinForm, setShowPinForm] = useState(false);
  const intervalRef = useRef(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/known-entities`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Sort: pinned first, then auto_detected, then by last_seen desc
      const sorted = [...(data.entities || data)].sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        if (a.auto_detected && !b.auto_detected) return -1;
        if (!a.auto_detected && b.auto_detected) return 1;
        return new Date(b.last_seen || 0) - new Date(a.last_seen || 0);
      });
      setEntities(sorted);
    } catch (err) {
      console.error('[FrequentVisitorsSidebar] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (!visible) return;
    fetchEntities();
    intervalRef.current = setInterval(fetchEntities, 5 * 60 * 1000);
    return () => clearInterval(intervalRef.current);
  }, [visible, fetchEntities]);

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  const filtered = entities.filter((e) => {
    if (filter === FILTER_AIRCRAFT && e.entity_type !== 'aircraft') return false;
    if (filter === FILTER_VESSEL && e.entity_type !== 'vessel') return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const name = (e.friendly_name || e.name || '').toLowerCase();
      const id = (e.identifier || '').toLowerCase();
      if (!name.includes(q) && !id.includes(q)) return false;
    }
    return true;
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleSelect(entity) {
    const key = `${entity.entity_type}:${entity.identifier}`;
    setSelectedId(key);
    onSelectEntity?.(entity);
  }

  function handlePinDone() {
    setShowPinForm(false);
    fetchEntities();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!visible) return null;

  return (
    <div
      className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}
      role="complementary"
      aria-label="Frequent visitors"
    >
      {/* Collapse/expand tab */}
      <button
        className={styles.collapseTab}
        onClick={() => setCollapsed((c) => !c)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        {collapsed ? '▶' : '◀'}
      </button>

      {/* Main panel — hidden when collapsed */}
      {!collapsed && (
        <div className={styles.panel}>
          {/* Header */}
          <div className={styles.header}>
            <span className={styles.headerTitle}>
              <span className={styles.headerIcon}>📍</span>
              Frequent Visitors
            </span>
            <button className={styles.closeBtn} onClick={onClose} aria-label="Close sidebar">
              ✕
            </button>
          </div>

          {/* Filter tabs */}
          <div className={styles.filterTabs} role="tablist">
            {[
              { key: FILTER_ALL, label: 'All' },
              { key: FILTER_AIRCRAFT, label: '✈ Aircraft' },
              { key: FILTER_VESSEL, label: '⛵ Vessels' },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={`${styles.filterTab} ${filter === key ? styles.filterTabActive : ''}`}
                onClick={() => setFilter(key)}
                role="tab"
                aria-selected={filter === key}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className={styles.searchWrapper}>
            <span className={styles.searchIcon}>🔍</span>
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Search by name or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className={styles.searchClear} onClick={() => setSearch('')} aria-label="Clear search">
                ✕
              </button>
            )}
          </div>

          {/* Entity list */}
          <div className={styles.entityList}>
            {loading && entities.length === 0 ? (
              <div className={styles.spinner} aria-label="Loading">
                <div className={styles.spinnerDot} />
                <div className={styles.spinnerDot} />
                <div className={styles.spinnerDot} />
              </div>
            ) : filtered.length === 0 ? (
              <div className={styles.emptyState}>
                {search || filter !== FILTER_ALL
                  ? 'No matching visitors found.'
                  : 'No frequent visitors yet. Vessels and aircraft seen 3+ days appear here automatically.'}
              </div>
            ) : (
              filtered.map((entity) => {
                const key = `${entity.entity_type}:${entity.identifier}`;
                return (
                  <EntityRow
                    key={key}
                    entity={entity}
                    apiBase={apiBase}
                    selected={selectedId === key}
                    onClick={handleSelect}
                  />
                );
              })
            )}
          </div>

          {/* Pin section */}
          <div className={styles.pinSection}>
            {showPinForm ? (
              <PinForm apiBase={apiBase} onDone={handlePinDone} />
            ) : (
              <button className={styles.pinToggleBtn} onClick={() => setShowPinForm(true)}>
                ＋ Pin MMSI / ICAO hex
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
