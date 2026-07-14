export default function StatusBar({ aircraft, vessels, lastUpdate, status }) {
  const acWithPos = aircraft.filter(a => a.lat != null).length;
  const acTotal = aircraft.length;
  const vsCount = vessels.length;
  const updateAge = lastUpdate ? Math.round((Date.now() - lastUpdate.getTime()) / 1000) : null;

  return (
    <div className="status-bar glass">
      <div className="status-group">
        <span className="status-icon">✈️</span>
        <span className="status-value">{acWithPos}</span>
        <span className="status-label">Aircraft</span>
        {acTotal > acWithPos && <span className="status-dim"> ({acTotal - acWithPos} no pos)</span>}
      </div>

      <div className="status-divider" />

      <div className="status-group">
        <span className="status-icon">⛵</span>
        <span className="status-value">{vsCount}</span>
        <span className="status-label">Vessels</span>
      </div>

      <div className="status-divider" />

      <div className="status-group">
        <span className={`status-dot ${updateAge != null && updateAge < 5 ? 'status-dot-live' : 'status-dot-stale'}`} />
        <span className="status-label">
          {updateAge != null ? `${updateAge}s ago` : 'Connecting…'}
        </span>
      </div>

      {status.tar1090_messages != null && (
        <>
          <div className="status-divider" />
          <div className="status-group">
            <span className="status-label">ADS-B Msgs</span>
            <span className="status-value">{(status.tar1090_messages || 0).toLocaleString()}</span>
          </div>
        </>
      )}

      {status.ais_messages_5min != null && (
        <>
          <div className="status-divider" />
          <div className="status-group">
            <span className={`status-dot ${status.ais_messages_5min > 0 ? 'status-dot-live' : 'status-dot-stale'}`} />
            <span className="status-label">AIS (5m)</span>
            <span className="status-value">{status.ais_messages_5min}</span>
          </div>
        </>
      )}

      <div className="status-spacer" />

      <div className="status-group">
        <span className="status-label">Hawaii Command Center</span>
      </div>
    </div>
  );
}
