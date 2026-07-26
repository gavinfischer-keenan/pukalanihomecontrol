import { useState, useEffect, useRef } from 'react';

// Aircraft photo from planespotters.net (browser fetch — no 403 from client)
async function fetchAircraftPhoto(hex) {
  try {
    const r = await fetch(`https://api.planespotters.net/pub/photos/hex/${hex}`);
    const data = await r.json();
    const photo = data.photos?.[0];
    if (!photo) return null;
    return {
      url:          photo.thumbnail_large?.src || photo.thumbnail?.src,
      photographer: photo.photographer,
      link:         photo.link,
    };
  } catch { return null; }
}

const VESSEL_TYPES = {
  0:'Unknown', 20:'WIG', 30:'Fishing', 31:'Towing', 32:'Towing (large)',
  33:'Dredging', 34:'Diving Ops', 35:'Military', 36:'Sailing', 37:'Pleasure Craft',
  40:'HSC', 50:'Pilot', 51:'SAR', 52:'Tug', 53:'Port Tender',
  54:'Anti-pollution', 55:'Law Enforcement', 58:'Medical',
  60:'Passenger', 69:'Passenger (other)',
  70:'Cargo', 79:'Cargo (other)',
  80:'Tanker', 89:'Tanker (other)', 90:'Other',
};
const NAV_STATUS = {
  0:'Underway (engine)', 1:'At Anchor', 2:'Not Under Command',
  3:'Restricted Manoeuvring', 4:'Constrained by Draught',
  5:'Moored', 6:'Aground', 7:'Fishing', 8:'Underway (sailing)',
  11:'Towing Astern', 12:'Towing Alongside', 15:'Undefined',
};
const FLIGHT_CAT_COLOR = {
  VFR: '#00e676', MVFR: '#2979ff', IFR: '#ff1744', LIFR: '#e040fb',
};

function vesselTypeName(code) {
  if (code == null) return null;
  return VESSEL_TYPES[code] || VESSEL_TYPES[Math.floor(code/10)*10] || `Type ${code}`;
}
function navStatusName(code) {
  return code != null ? (NAV_STATUS[code] || `Status ${code}`) : null;
}
function fmt(v, d = 0) {
  if (v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n.toFixed(d);
}
function vrArrow(vr) {
  return vr > 100 ? ' ▲' : vr < -100 ? ' ▼' : ' →';
}
function decodeSky(json) {
  try {
    const layers = JSON.parse(json || '[]');
    if (!layers.length) return 'Clear';
    return layers.map(l => {
      const cover = l.cover || l.coverCode || '';
      const base  = l.base  || l.cloudBase || '';
      return base ? `${cover} @ ${Number(base).toLocaleString()}ft` : cover;
    }).join(' · ');
  } catch { return null; }
}

function SurfDetail({ e }) {
  const dir = e.wave_dir != null ? `${e.wave_dir}°` : null;
  const swDir = e.swell_dir != null ? `${e.swell_dir}°` : null;
  const age = e.updated ? new Date(e.updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <>
      <Section title="SURF">
        <Row label="Wave Height"  value={e.wave_ft != null ? `${e.wave_ft.toFixed(1)}ft` : null} highlight />
        <Row label="Wave Period"  value={e.wave_period != null ? `${e.wave_period.toFixed(0)}s` : null} />
        <Row label="Wave Dir"     value={dir} />
      </Section>
      <Section title="SWELL">
        <Row label="Swell Height" value={e.swell_ft != null ? `${e.swell_ft.toFixed(1)}ft` : null} highlight />
        <Row label="Swell Period" value={e.swell_period != null ? `${e.swell_period.toFixed(0)}s` : null} />
        <Row label="Swell Dir"    value={swDir} />
      </Section>
      <Section title="SPOT">
        <Row label="Location"    value={e.group} />
        <Row label="Position"    value={e.lat != null ? `${e.lat.toFixed(4)}°N, ${Math.abs(e.lon).toFixed(4)}°W` : null} />
        <Row label="Updated"     value={age} />
        <Row label="Source"      value="Open-Meteo Marine" />
      </Section>
    </>
  );
}


function Row({ label, value, unit, highlight }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={`detail-row ${highlight ? 'detail-row-highlight' : ''}`}>
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value}{unit ? <span className="detail-unit"> {unit}</span> : null}</span>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div className="detail-section">
      <div className="detail-section-title">{title}</div>
      {children}
    </div>
  );
}

function BuoyDetail({ e }) {
  const age = e.obs_time ? `${Math.round((Date.now() - new Date(e.obs_time)) / 60000)} min ago` : null;
  return (
    <>
      <Section title="WAVES">
        <Row label="Wave Height"  value={fmt(e.wvht, 2)} unit="m" highlight />
        <Row label="Dom. Period"  value={fmt(e.dpd, 1)}  unit="s" />
        <Row label="Avg Period"   value={fmt(e.apd, 1)}  unit="s" />
        <Row label="Wave Dir"     value={e.mwd != null ? `${e.mwd}°` : null} />
      </Section>
      <Section title="WIND">
        <Row label="Direction"  value={e.wdir != null ? `${e.wdir}°` : null} />
        <Row label="Speed"      value={fmt(e.wspd, 1)} unit="m/s" highlight />
        <Row label="Gust"       value={fmt(e.gst, 1)}  unit="m/s" />
      </Section>
      <Section title="OCEAN">
        <Row label="Water Temp" value={fmt(e.wtmp, 1)} unit="°C" highlight />
        <Row label="Air Temp"   value={fmt(e.atmp, 1)} unit="°C" />
        <Row label="Pressure"   value={fmt(e.pres, 1)} unit="hPa" />
      </Section>
      <Section title="STATION">
        <Row label="ID"         value={e.buoy_id} />
        <Row label="Position"   value={e.lat != null ? `${e.lat.toFixed(3)}°N, ${Math.abs(e.lon).toFixed(3)}°W` : null} />
        <Row label="Observed"   value={age} />
      </Section>
    </>
  );
}

function TideDetail({ e }) {
  const upcoming = e.upcoming_hilo || [];
  return (
    <>
      <Section title="CURRENT">
        <Row label="Water Level" value={e.current_ft != null ? `${Number(e.current_ft).toFixed(2)}ft` : null} highlight />
        <Row label="Observed"    value={e.current_time ? new Date(e.current_time).toLocaleTimeString() : null} />
      </Section>
      <Section title="UPCOMING HI / LO">
        {upcoming.slice(0, 6).map((p, i) => {
          const t = new Date(p.pred_time);
          const label = p.tide_type === 'H' ? '▲ High' : '▼ Low';
          const color = p.tide_type === 'H' ? '#29b6f6' : '#ff7043';
          return (
            <div key={i} className="detail-row">
              <span className="detail-label" style={{ color }}>{label}</span>
              <span className="detail-value">
                {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                <span className="detail-unit"> — {Number(p.height_ft).toFixed(2)}ft</span>
              </span>
            </div>
          );
        })}
        {upcoming.length === 0 && <div style={{ color: '#546e7a', fontSize: 11, padding: '6px 0' }}>Collecting tide data…</div>}
      </Section>
      <Section title="STATION">
        <Row label="ID"       value={e.station_id} />
        <Row label="Position" value={e.lat != null ? `${e.lat.toFixed(3)}°N, ${Math.abs(e.lon).toFixed(3)}°W` : null} />
        <Row label="Datum"    value="MLLW" />
      </Section>
    </>
  );
}

function MetarDetail({ e }) {
  const catColor = FLIGHT_CAT_COLOR[e.flight_cat?.toUpperCase()] || '#607d8b';
  const age = e.obs_time ? `${Math.round((Date.now() - new Date(e.obs_time)) / 60000)} min ago` : null;
  return (
    <>
      <Section title="FLIGHT CATEGORY">
        <div className="detail-row">
          <span className="detail-label">Category</span>
          <span className="detail-value" style={{ color: catColor, fontWeight: 800, fontSize: 15 }}>
            {e.flight_cat || '—'}
          </span>
        </div>
      </Section>
      <Section title="WIND">
        <Row label="Direction" value={e.wind_dir != null ? `${e.wind_dir}°` : null} />
        <Row label="Speed"     value={e.wind_spd} unit="kt" highlight />
        <Row label="Gust"      value={e.wind_gst} unit="kt" />
      </Section>
      <Section title="SKY & VIS">
        <Row label="Visibility" value={e.vis_sm} unit="SM" />
        <Row label="Sky"        value={decodeSky(e.sky_cond)} />
        <Row label="Wx"         value={e.wx_string} />
      </Section>
      <Section title="TEMP / PRESSURE">
        <Row label="Temp"      value={e.temp_c != null ? `${e.temp_c}°C / ${(e.temp_c * 9/5 + 32).toFixed(0)}°F` : null} highlight />
        <Row label="Dewpoint"  value={e.dewp_c != null ? `${e.dewp_c}°C` : null} />
        <Row label="Altimeter" value={fmt(e.altim_hpa, 1)} unit="hPa" />
      </Section>
      <Section title="RAW METAR">
        <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#80cbc4', lineHeight: 1.6, wordBreak: 'break-all', padding: '4px 0' }}>
          {e.raw_metar || '—'}
        </div>
      </Section>
      <Section title="STATION">
        <Row label="ICAO"     value={e.icao} />
        <Row label="Name"     value={e.name} />
        <Row label="Observed" value={age} />
      </Section>
    </>
  );
}

// ─── Inline Edit Form — Vessel ────────────────────────────────────────────────
function VesselEditForm({ mmsi, apiBase, initialData, onClose, onSaved }) {
  const FIELDS = [
    { key: 'vessel_name',   label: 'Vessel Name',   type: 'text' },
    { key: 'imo',           label: 'IMO',            type: 'text' },
    { key: 'call_sign',     label: 'Call Sign',      type: 'text' },
    { key: 'flag',          label: 'Flag',           type: 'text' },
    { key: 'vessel_type',   label: 'Vessel Type',    type: 'text' },
    { key: 'gross_tonnage', label: 'Gross Tonnage',  type: 'number' },
    { key: 'year_built',    label: 'Year Built',     type: 'number' },
    { key: 'length_m',      label: 'Length (m)',     type: 'number' },
    { key: 'beam_m',        label: 'Beam (m)',       type: 'number' },
    { key: 'owner',         label: 'Owner',          type: 'text' },
    { key: 'operator',      label: 'Operator',       type: 'text' },
    { key: 'notes',         label: 'Notes',          type: 'textarea' },
  ];

  const [form, setForm]       = useState(() => {
    const init = {};
    FIELDS.forEach(f => { init[f.key] = initialData?.[f.key] ?? ''; });
    return init;
  });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState(null);
  const fileRef               = useRef();

  function handleChange(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = new FormData();
      // Append text fields
      FIELDS.forEach(f => {
        if (form[f.key] !== '') body.append(f.key, form[f.key]);
      });
      // Append photo if selected
      if (fileRef.current?.files?.[0]) {
        body.append('photo', fileRef.current.files[0]);
      }
      const r = await fetch(`${apiBase}/api/vessel-info/${mmsi}`, {
        method: 'POST',
        body,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="detail-section" style={{
      borderTop: '1px solid rgba(0,188,212,0.3)',
      background: 'rgba(0,188,212,0.04)',
      borderRadius: '0 0 8px 8px',
      padding: '10px 12px',
    }}>
      <div className="detail-section-title" style={{ color: '#00bcd4', marginBottom: 10 }}>
        ✏️ EDIT VESSEL INFO
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {FIELDS.map(f => (
          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 10, color: '#78909c', letterSpacing: '0.05em' }}>{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea
                value={form[f.key]}
                onChange={ev => handleChange(f.key, ev.target.value)}
                rows={3}
                style={inputStyle}
              />
            ) : (
              <input
                type={f.type}
                value={form[f.key]}
                onChange={ev => handleChange(f.key, ev.target.value)}
                style={inputStyle}
              />
            )}
          </div>
        ))}

        {/* Photo upload + paste */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 10, color: '#78909c', letterSpacing: '0.05em' }}>Photo</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ ...inputStyle, padding: '4px 6px', cursor: 'pointer' }}
          />
          <div
            onPaste={(e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              for (const item of items) {
                if (item.type.startsWith('image/')) {
                  e.preventDefault();
                  const blob = item.getAsFile();
                  const dt = new DataTransfer();
                  dt.items.add(new File([blob], `paste_${Date.now()}.png`, { type: blob.type }));
                  if (fileRef.current) fileRef.current.files = dt.files;
                  // Show preview
                  const preview = e.currentTarget.querySelector('img');
                  const url = URL.createObjectURL(blob);
                  if (preview) { preview.src = url; preview.style.display = 'block'; }
                  else {
                    const img = document.createElement('img');
                    img.src = url;
                    img.style.cssText = 'max-width:100%;max-height:120px;border-radius:6px;margin-top:4px;object-fit:cover;border:1px solid rgba(255,255,255,0.15);';
                    e.currentTarget.appendChild(img);
                  }
                  // Update label
                  const lbl = e.currentTarget.querySelector('span');
                  if (lbl) lbl.textContent = '\u2705 Image pasted! Ready to save.';
                  break;
                }
              }
            }}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#00bcd4'; }}
            onDragLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
              const file = e.dataTransfer?.files?.[0];
              if (file && file.type.startsWith('image/')) {
                const dt = new DataTransfer();
                dt.items.add(file);
                if (fileRef.current) fileRef.current.files = dt.files;
                const preview = e.currentTarget.querySelector('img');
                const url = URL.createObjectURL(file);
                if (preview) { preview.src = url; preview.style.display = 'block'; }
                else {
                  const img = document.createElement('img');
                  img.src = url;
                  img.style.cssText = 'max-width:100%;max-height:120px;border-radius:6px;margin-top:4px;object-fit:cover;border:1px solid rgba(255,255,255,0.15);';
                  e.currentTarget.appendChild(img);
                }
                const lbl = e.currentTarget.querySelector('span');
                if (lbl) lbl.textContent = '\u2705 Image dropped! Ready to save.';
              }
            }}
            tabIndex={0}
            style={{
              border: '2px dashed rgba(255,255,255,0.15)',
              borderRadius: 8,
              padding: '12px 8px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.2s',
              background: 'rgba(0,188,212,0.04)',
              outline: 'none',
            }}
          >
            <span style={{ fontSize: 11, color: '#78909c' }}>
              {String.fromCodePoint(0x1F4CB)} Paste image here (Ctrl+V) or drag & drop
            </span>
          </div>
        </div>

        {error && (
          <div style={{ color: '#ff5252', fontSize: 11, padding: '4px 0' }}>⚠ {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="submit" disabled={saving} style={btnPrimaryStyle}>
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          <button type="button" onClick={onClose} style={btnSecondaryStyle}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Inline Edit Form — Aircraft ──────────────────────────────────────────────
function AircraftEditForm({ icaoHex, apiBase, initialData, onClose, onSaved }) {
  const FIELDS = [
    { key: 'registration',   label: 'Registration',   type: 'text' },
    { key: 'aircraft_type',  label: 'Aircraft Type',  type: 'text' },
    { key: 'operator',       label: 'Operator',       type: 'text' },
    { key: 'notes',          label: 'Notes',          type: 'textarea' },
  ];

  const [form, setForm]     = useState(() => {
    const init = {};
    FIELDS.forEach(f => { init[f.key] = initialData?.[f.key] ?? ''; });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  function handleChange(key, val) {
    setForm(prev => ({ ...prev, [key]: val }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/api/aircraft-info/${icaoHex}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="detail-section" style={{
      borderTop: '1px solid rgba(0,188,212,0.3)',
      background: 'rgba(0,188,212,0.04)',
      borderRadius: '0 0 8px 8px',
      padding: '10px 12px',
    }}>
      <div className="detail-section-title" style={{ color: '#00bcd4', marginBottom: 10 }}>
        ✏️ EDIT AIRCRAFT INFO
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {FIELDS.map(f => (
          <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 10, color: '#78909c', letterSpacing: '0.05em' }}>{f.label}</label>
            {f.type === 'textarea' ? (
              <textarea
                value={form[f.key]}
                onChange={ev => handleChange(f.key, ev.target.value)}
                rows={3}
                style={inputStyle}
              />
            ) : (
              <input
                type={f.type}
                value={form[f.key]}
                onChange={ev => handleChange(f.key, ev.target.value)}
                style={inputStyle}
              />
            )}
          </div>
        ))}

        {error && (
          <div style={{ color: '#ff5252', fontSize: 11, padding: '4px 0' }}>⚠ {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="submit" disabled={saving} style={btnPrimaryStyle}>
            {saving ? 'Saving…' : '💾 Save'}
          </button>
          <button type="button" onClick={onClose} style={btnSecondaryStyle}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Shared inline styles ────────────────────────────────────────────────────
const inputStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(0,188,212,0.25)',
  borderRadius: 4,
  color: '#eceff1',
  fontSize: 12,
  padding: '5px 8px',
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
};
const btnPrimaryStyle = {
  flex: 1,
  background: 'rgba(0,188,212,0.2)',
  border: '1px solid rgba(0,188,212,0.5)',
  borderRadius: 4,
  color: '#00bcd4',
  fontSize: 12,
  fontWeight: 700,
  padding: '6px 12px',
  cursor: 'pointer',
};
const btnSecondaryStyle = {
  flex: 1,
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 4,
  color: '#90a4ae',
  fontSize: 12,
  padding: '6px 12px',
  cursor: 'pointer',
};

// ─── Seen Days Badge ──────────────────────────────────────────────────────────
function SeenDaysBadge({ days }) {
  if (days == null) return null;
  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      background: 'rgba(0,188,212,0.15)',
      border: '1px solid rgba(0,188,212,0.35)',
      borderRadius: 20,
      padding: '3px 10px',
      fontSize: 11,
      color: '#80deea',
      fontWeight: 600,
      marginTop: 4,
    }}>
      📅 Seen on {days} {days === 1 ? 'day' : 'days'}
    </div>
  );
}

// ─── Main DetailPanel ─────────────────────────────────────────────────────────
export default function DetailPanel({ entity, onClose, apiBase }) {
  const [history, setHistory]         = useState(null);
  const [photo, setPhoto]             = useState(null);
  const [prediction, setPrediction]   = useState(null);
  const [routes, setRoutes]           = useState([]);
  // Extra info fetched from vessel-info / aircraft-info endpoints
  const [entityInfo, setEntityInfo]   = useState(null);
  // Edit form visibility
  const [showEdit, setShowEdit]       = useState(false);

  useEffect(() => {
    if (!entity) {
      setHistory(null); setPhoto(null); setPrediction(null);
      setRoutes([]); setEntityInfo(null); setShowEdit(false);
      return;
    }
    const type = entity._type || (entity.hex ? 'aircraft' : 'vessel');
    if (type === 'buoy' || type === 'tide' || type === 'metar' || type === 'surf') return;

    const id = entity.hex || entity.entity_id;
    fetch(`${apiBase}/api/history/${id}`)
      .then(r => r.json()).then(setHistory).catch(() => {});

    if (type === 'aircraft' && entity.hex) {
      fetchAircraftPhoto(entity.hex).then(setPhoto).catch(() => {});
      // Fetch aircraft-info for seen_days + threshold_met
      fetch(`${apiBase}/api/aircraft-info/${entity.hex}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => setEntityInfo(data))
        .catch(() => {});
    }

    if (type === 'vessel' && entity.entity_id) {
      // Fetch vessel-info for seen_days + photo_url
      fetch(`${apiBase}/api/vessel-info/${entity.entity_id}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => setEntityInfo(data))
        .catch(() => {});
      fetch(`${apiBase}/api/vessel-predictions`)
        .then(r => r.json())
        .then(rows => {
          const p = (rows || []).find(r => r.mmsi === String(entity.entity_id));
          setPrediction(p || null);
        }).catch(() => {});
      fetch(`${apiBase}/api/vessel-routes/${entity.entity_id}`)
        .then(r => r.json()).then(setRoutes).catch(() => []);
    }
  }, [entity, apiBase]);

  if (!entity) return null;

  const type = entity._type || (entity.hex ? 'aircraft' : 'vessel');

  const KNOWN_VESSELS = {
    '303867000': { name: 'USCGC KIMBALL' },
    '367151310': { name: 'AMERICAN CONTENDER' },
    '367396410': { name: 'LADY MARIA' },
    '338XXXXXX': { name: 'USCG' },
  };

  const headerMap = {
    aircraft: { title: (entity.flight||'').trim() || entity.hex?.toUpperCase(), sub: entity.hex?.toUpperCase(), icon: '✈️' },
    vessel:   { title: entity.vessel_name || (KNOWN_VESSELS[entity.entity_id] ? KNOWN_VESSELS[entity.entity_id].name : entity.entity_id), sub: `MMSI ${entity.entity_id}`, icon: '⛵' },
    buoy:     { title: entity.name || entity.buoy_id,          sub: `NDBC ${entity.buoy_id}`,   icon: '🔵' },
    tide:     { title: entity.name || entity.station_id,       sub: `CO-OPS ${entity.station_id}`, icon: '〰️' },
    metar:    { title: entity.icao,                            sub: entity.name || 'Airport Weather', icon: '🛬' },
    surf:     { title: entity.name || entity.id,               sub: entity.group || 'Surf Spot', icon: '🏄' },
  };
  const h = headerMap[type] || headerMap.aircraft;

  // Whether the aircraft edit button should be visible
  const showAircraftEdit = type === 'aircraft' && entityInfo?.threshold_met === true;

  return (
    <div className="detail-panel glass">
      <div className="detail-header">
        <div>
          <div className="detail-title">{h.icon} {h.title}</div>
          <div className="detail-subtitle">{h.sub}</div>
          {/* Seen Days Badge — vessel and aircraft */}
          {(type === 'vessel' || type === 'aircraft') && entityInfo?.seen_days != null && (
            <SeenDaysBadge days={entityInfo.seen_days} />
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          {/* EDIT button — vessel (always) */}
          {type === 'vessel' && (
            <button
              onClick={() => setShowEdit(v => !v)}
              style={{
                background: showEdit ? 'rgba(0,188,212,0.25)' : 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(0,188,212,0.4)',
                borderRadius: 4,
                color: '#00bcd4',
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {showEdit ? '✕ Close' : '✏️ Edit'}
            </button>
          )}
          {/* EDIT button — aircraft (only when threshold_met) */}
          {showAircraftEdit && (
            <button
              onClick={() => setShowEdit(v => !v)}
              style={{
                background: showEdit ? 'rgba(0,188,212,0.25)' : 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(0,188,212,0.4)',
                borderRadius: 4,
                color: '#00bcd4',
                fontSize: 11,
                fontWeight: 700,
                padding: '4px 10px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {showEdit ? '✕ Close' : '✏️ Edit'}
            </button>
          )}
          <button className="detail-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Vessel photo from vessel-info */}
      {type === 'vessel' && entityInfo?.photo_url && (
        <div style={{ lineHeight: 0 }}>
          <img
            src={entityInfo.photo_url}
            alt="vessel"
            style={{ width: '100%', maxHeight: 140, objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      {/* Aircraft photo — tar1090 style */}
      {type === 'aircraft' && photo && (
        <a href={photo.link} target="_blank" rel="noreferrer" style={{ display: 'block', lineHeight: 0 }}>
          <img
            src={photo.url}
            alt="aircraft"
            style={{ width: '100%', maxHeight: 120, objectFit: 'cover', display: 'block' }}
          />
          <div style={{ fontSize: 9, color: '#546e7a', padding: '3px 8px', background: 'rgba(0,0,0,0.5)' }}>
            📷 {photo.photographer}
          </div>
        </a>
      )}

      {type === 'aircraft' && (
        <>
          <Section title="IDENTIFICATION">
            <Row label="Callsign"   value={(entity.flight||'').trim() || '—'} />
            <Row label="ICAO Hex"   value={entity.hex?.toUpperCase()} />
            <Row label="Squawk"     value={entity.squawk} />
            <Row label="Category"   value={entity.category} />
            <Row label="Type"       value={entity.type} />
          </Section>
          <Section title="SPATIAL">
            <Row label="Groundspeed" value={fmt(entity.gs)}      unit="kt" />
            <Row label="Baro Alt"    value={entity.alt_baro === 'ground' ? 'Ground' : fmt(entity.alt_baro)} unit={entity.alt_baro !== 'ground' ? 'ft' : ''} highlight />
            <Row label="Geom Alt"    value={fmt(entity.alt_geom)} unit="ft" />
            <Row label="Vert. Rate"  value={entity.baro_rate != null ? `${vrArrow(entity.baro_rate)}${fmt(Math.abs(entity.baro_rate))}` : null} unit="ft/min" />
            <Row label="Track"       value={fmt(entity.track ?? entity.calc_track, 1)} unit="°" />
            <Row label="Position"    value={entity.lat != null ? `${entity.lat.toFixed(4)}°, ${entity.lon.toFixed(4)}°` : null} />
            <Row label="Distance"    value={entity.r_dst != null ? `${entity.r_dst.toFixed(1)} nmi @ ${Math.round(entity.r_dir)}°` : null} />
          </Section>
          <Section title="SIGNAL">
            <Row label="Source"    value={entity.type?.toUpperCase()} />
            <Row label="RSSI"      value={fmt(entity.rssi, 1)}     unit="dBFS" />
            <Row label="Messages"  value={entity.messages?.toLocaleString()} />
            <Row label="Last Pos"  value={entity.seen_pos != null ? `${entity.seen_pos.toFixed(1)}s` : null} />
            <Row label="Last Seen" value={entity.seen != null ? `${entity.seen.toFixed(1)}s` : null} />
          </Section>
          <Section title="NAV / FMS">
            <Row label="Sel. Alt"  value={fmt(entity.nav_altitude_mcp)} unit="ft" />
            <Row label="Sel. Hdg"  value={fmt(entity.nav_heading, 1)}   unit="°" />
            <Row label="Nav QNH"   value={fmt(entity.nav_qnh, 1)}       unit="hPa" />
          </Section>

          {/* Aircraft edit form — slide in below */}
          {showAircraftEdit && showEdit && (
            <AircraftEditForm
              icaoHex={entity.hex}
              apiBase={apiBase}
              initialData={entityInfo}
              onClose={() => setShowEdit(false)}
              onSaved={() => { setShowEdit(false); onClose?.(); }}
            />
          )}
        </>
      )}

      {type === 'vessel' && (
        <>
          <Section title="IDENTIFICATION">
            <Row label="MMSI"        value={entity.entity_id} highlight />
            <Row label="Vessel Name" value={entity.vessel_name} />
            <Row label="Callsign"    value={entity.callsign} />
            <Row label="Type"        value={vesselTypeName(entity.vessel_type)} />
          </Section>
          <Section title="SPATIAL">
            <Row label="Speed"      value={fmt(entity.speed, 1)}   unit="kt" highlight />
            <Row label="Heading"    value={fmt(entity.heading, 1)} unit="°" />
            <Row label="ROT"        value={fmt(entity.rot, 1)}     unit="°/min" />
            <Row label="Nav Status" value={navStatusName(entity.nav_status)} />
            <Row label="Position"   value={entity.lat != null ? `${entity.lat.toFixed(4)}°, ${entity.lon.toFixed(4)}°` : null} />
          </Section>
          <Section title="VOYAGE">
            <Row label="Destination" value={entity.destination} />
            <Row label="ETA"         value={entity.eta} />
            <Row label="Draught"     value={fmt(entity.draught, 1)} unit="m" />
          </Section>
          {/* Predicted destination — show if no AIS-declared dest or as supplement */}
          {prediction && (
            <Section title="PREDICTED DESTINATION">
              <div className="detail-row detail-row-highlight">
                <span className="detail-label">Est. Dest</span>
                <span className="detail-value" style={{ color: '#80cbc4' }}>{prediction.predicted_dest}</span>
              </div>
              <Row label="Confidence" value={`${Math.round((prediction.confidence || 0) * 100)}%`} />
              <Row label="Method"
                value={{
                  ais_declared:     '📡 AIS declared',
                  historical:       '📊 Historical pattern',
                  heading_corridor: '🧭 Heading corridor',
                }[prediction.method] || prediction.method}
              />
              <Row label="Updated" value={prediction.predicted_at
                ? `${Math.round((Date.now() - new Date(prediction.predicted_at)) / 60000)} min ago`
                : null} />
            </Section>
          )}
          <Section title="DIMENSIONS">
            <Row label="Length" value={fmt(entity.length, 0)} unit="m" />
            <Row label="Beam"   value={fmt(entity.beam, 0)}   unit="m" />
          </Section>
          {routes.length > 0 && (
            <Section title="ROUTE HISTORY">
              {routes.slice(0, 5).map((r, i) => (
                <div key={i} className="detail-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                  <span style={{ color: '#80cbc4', fontSize: 10 }}>
                    {r.depart_port} → {r.arrive_port}
                  </span>
                  <span className="detail-unit">
                    {r.distance_nm ? `${Number(r.distance_nm).toFixed(0)} nm` : ''}
                    {r.avg_speed   ? ` · ${Number(r.avg_speed).toFixed(1)} kt avg` : ''}
                    {r.arrive_time ? ` · ${new Date(r.arrive_time).toLocaleDateString()}` : ''}
                  </span>
                </div>
              ))}
            </Section>
          )}

          {/* Vessel edit form — slide in below */}
          {showEdit && (
            <VesselEditForm
              mmsi={entity.entity_id}
              apiBase={apiBase}
              initialData={entityInfo}
              onClose={() => setShowEdit(false)}
              onSaved={() => { setShowEdit(false); onClose?.(); }}
            />
          )}
        </>
      )}

      {type === 'buoy'  && <BuoyDetail  e={entity} />}
      {type === 'tide'  && <TideDetail  e={entity} />}
      {type === 'metar' && <MetarDetail e={entity} />}
      {type === 'surf'  && <SurfDetail  e={entity} />}

      {history && (
        <Section title="DATABASE">
          <Row label="Total Positions" value={history.total_positions?.toLocaleString()} />
          <Row label="First Seen" value={history.entity?.first_seen ? new Date(history.entity.first_seen).toLocaleDateString() : null} />
        </Section>
      )}
    </div>
  );
}
