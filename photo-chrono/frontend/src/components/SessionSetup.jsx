import { useState, useEffect } from 'react'
import FolderBrowser from './FolderBrowser'
import BridgeConnect from './BridgeConnect'

const DEFAULTS = {
  subject_name: 'Subject',
  subject_sex:  'unknown',
  birth_year:   1967,
  birth_month:  2,
  birth_day:    16,
  source_path:  '/mnt/gdrive/',
  output_path:  '/mnt/gdrive/Chronological/',
}

export default function SessionSetup({ rclone, onCreated, onBack }) {
  const [form, setForm] = useState({
    name:         '',
    subject_name: DEFAULTS.subject_name,
    subject_sex:  DEFAULTS.subject_sex,
    birth_year:   DEFAULTS.birth_year,
    birth_month:  DEFAULTS.birth_month,
    birth_day:    DEFAULTS.birth_day,
    source_path:  rclone?.mounted ? DEFAULTS.source_path : '',
    output_path:  rclone?.mounted ? DEFAULTS.output_path : '',
    is_rerun:     false,
    prior_session_id: null,
  })
  const [sourceType, setSourceType] = useState('gdrive') // 'gdrive', 'local', 'server'
  const [rerunDetect, setRerunDetect] = useState(null)
  const [detecting, setDetecting]    = useState(false)
  const [priorSessions, setPriorSessions] = useState([])
  const [scanning, setScanning]      = useState(false)
  const [error, setError]            = useState('')
  const [creating, setCreating]      = useState(false)
  const [statusMsg, setStatusMsg]    = useState('')

  // Auto-detect re-run whenever source path changes (debounced)
  useEffect(() => {
    if (!form.source_path || form.source_path.length < 5) return
    const timer = setTimeout(() => detectRerun(form.source_path), 800)
    return () => clearTimeout(timer)
  }, [form.source_path])

  const detectRerun = async (path) => {
    setDetecting(true)
    try {
      const r = await fetch(`/api/sessions/detect-rerun?path=${encodeURIComponent(path)}`)
      const d = await r.json()
      setRerunDetect(d)
      setPriorSessions(d.prior_sessions || [])
      if (d.is_rerun && d.suggested_prior) {
        set('is_rerun', true)
        set('prior_session_id', d.suggested_prior.id)
      } else {
        set('is_rerun', false)
        set('prior_session_id', null)
      }
    } catch {}
    finally { setDetecting(false) }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.birth_year || form.birth_year < 1900) {
      setError('Please enter a valid birth year.'); return
    }
    if (!form.source_path.trim()) {
      setError('Source path is required.'); return
    }
    setCreating(true)
    setStatusMsg('Creating session…')
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, name: form.name || `${form.subject_name} ${form.birth_year}` }),
      })
      const session = await res.json()
      if (!res.ok) throw new Error(session.detail || 'Failed')

      setScanning(true)
      setStatusMsg(`Scanning "${form.source_path.split('/').pop()}" for photos — reading files from Google Drive, this can take 10–30 seconds…`)
      const scanRes = await fetch(`/api/sessions/${session.id}/scan`, { method: 'POST' })
      const scanData = await scanRes.json()
      if (!scanRes.ok) throw new Error(scanData.detail || 'Scan failed')

      setStatusMsg(`Found ${scanData.total} photos! Loading enrollment…`)
      onCreated({ ...session, total_photos: scanData.total })
    } catch (err) { setError(err.message); setStatusMsg('') }
    finally { setCreating(false); setScanning(false) }
  }

  const age2026 = 2026 - form.birth_year

  return (
    <div className="fade-in">
      <div className="flex items-center gap-1 mb-2">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        <h2 style={{fontSize:'1.2rem',fontWeight:700}}>New Session</h2>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 320px',gap:'1.5rem',alignItems:'start'}}>
        <form onSubmit={handleSubmit}>
          {error && <div className="alert alert-error mb-2">⚠ {error}</div>}

          {/* Subject identity */}
          <div className="card mb-2" style={{border:'2px solid var(--accent)',boxShadow:'0 0 0 4px rgba(124,58,237,0.08)'}}>
            <div className="card-title" style={{fontSize:'1rem'}}>👤 Who Are We Looking For?</div>
            <p className="text-muted" style={{marginBottom:'1rem',fontSize:'0.82rem'}}>
              This name will be used throughout — the app will ask things like
              <em style={{color:'var(--accent2)'}}> "Is this {form.subject_name || 'them'}?" </em>
              and allow hints like
              <em style={{color:'var(--accent2)'}}> "I think {form.subject_name || 'them'} looks older here"</em>.
            </p>
            <div className="form-group">
              <label className="form-label">Full name (or whatever you'd like to call them) *</label>
              <input className="form-input" placeholder="e.g. Mom, Ed, Grandpa Joe"
                value={form.subject_name}
                onChange={e => set('subject_name', e.target.value)}
                required
                style={{fontSize:'1.05rem',fontWeight:600}}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Appearance — by appearance in photos</label>
              <div style={{display:'flex',gap:'0.75rem',marginTop:'0.25rem',flexWrap:'wrap'}}>
                {[['male','Male — he/him'],['female','Female — she/her'],['unknown','Not specified / varies']].map(([val,label]) => (
                  <label key={val} style={{
                    display:'flex',alignItems:'center',gap:'0.5rem',cursor:'pointer',
                    padding:'0.6rem 1rem',borderRadius:'var(--radius)',
                    border:`2px solid ${form.subject_sex === val ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.subject_sex === val ? 'rgba(124,58,237,0.1)' : 'var(--bg3)',
                    fontSize:'0.85rem',transition:'all 0.15s',fontWeight: form.subject_sex === val ? 600 : 400
                  }}>
                    <input type="radio" name="subject_sex" value={val}
                      checked={form.subject_sex === val}
                      onChange={() => set('subject_sex', val)}
                      style={{accentColor:'var(--accent)'}}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            {form.subject_name && form.subject_sex !== 'unknown' && (
              <div className="alert alert-info" style={{fontSize:'0.8rem',marginTop:'0.5rem'}}>
                Got it. The app will say things like "Is this <strong>{form.subject_name}</strong>?"
                and "I think {form.subject_name} looks older" when asking for your hints.
              </div>
            )}
          </div>

          <div className="card mb-2">
            <div className="card-title">📋 Session Info</div>
            <div className="form-group">
              <label className="form-label">Session Name (optional)</label>
              <input className="form-input" placeholder={`e.g. ${form.subject_name || 'Subject'}'s photos`}
                value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
          </div>

          <div className="card mb-2">
            <div className="card-title">🎂 Subject's Date of Birth</div>
            <p className="text-muted" style={{marginBottom:'1rem',fontSize:'0.82rem'}}>
              Used to calculate estimated year from apparent age in photos.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Birth Year *</label>
                <input className="form-input" type="number" placeholder="e.g. 1967"
                  min="1900" max="2020"
                  value={form.birth_year} onChange={e => set('birth_year', parseInt(e.target.value)||'')} required />
              </div>
              <div className="form-group">
                <label className="form-label">Birth Month</label>
                <select className="form-select" value={form.birth_month} onChange={e => set('birth_month', parseInt(e.target.value))}>
                  {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Birth Day</label>
                <input className="form-input" type="number" placeholder="Day" min="1" max="31"
                  value={form.birth_day} onChange={e => set('birth_day', parseInt(e.target.value)||1)} />
              </div>
            </div>
            {form.birth_year > 1900 && (
              <div className="alert alert-info">
                📊 Age range in photos: <strong>0 – {age2026} years</strong>
              </div>
            )}
          </div>

          <div className="card mb-2">
            <div className="card-title">📁 Photo Locations</div>

            <div className="nav-pills mb-2">
              <button type="button" className={`nav-pill ${sourceType === 'gdrive' ? 'active' : ''}`} onClick={() => setSourceType('gdrive')}>Google Drive</button>
              <button type="button" className={`nav-pill ${sourceType === 'local' ? 'active' : ''}`} onClick={() => setSourceType('local')}>Local Computer</button>
              <button type="button" className={`nav-pill ${sourceType === 'server' ? 'active' : ''}`} onClick={() => setSourceType('server')}>Server Path</button>
            </div>

            <div className="form-group">
              {sourceType === 'gdrive' && (
                <FolderBrowser
                  label="Source Folder — where are the photos? *"
                  value={form.source_path}
                  onChange={v => set('source_path', v)}
                />
              )}
              {sourceType === 'local' && (
                <BridgeConnect 
                  onConnect={info => set('source_path', `bridge://${info.url.replace(/^https?:\/\//, '')}`)}
                />
              )}
              {sourceType === 'server' && (
                <div>
                  <label className="form-label">Server Path *</label>
                  <input className="form-input" value={form.source_path} onChange={e => set('source_path', e.target.value)} placeholder="/path/to/photos" />
                </div>
              )}
              {detecting && (
                <span style={{fontSize:'0.78rem',color:'var(--muted)',marginTop:'0.25rem',display:'block'}}>
                  <span className="spin">⟳</span> Checking folder…
                </span>
              )}
            </div>

            {/* Re-run detection result */}
            {rerunDetect && (
              <div className={`alert ${rerunDetect.is_rerun ? 'alert-warning' : 'alert-info'} mb-2`}>
                {rerunDetect.is_rerun ? (
                  <>
                    <div>
                      🔁 <strong>We think this looks like a prior run's output</strong>
                      ({Math.round(rerunDetect.confidence * 100)}% of files match our naming pattern).
                      Is that right?
                    </div>
                    {rerunDetect.sample_files?.length > 0 && (
                      <div style={{fontFamily:'monospace',fontSize:'0.75rem',marginTop:'0.4rem',opacity:0.8}}>
                        e.g. {rerunDetect.sample_files[0]}
                      </div>
                    )}
                    <div style={{marginTop:'0.75rem',display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
                      <label style={{display:'flex',gap:'0.4rem',alignItems:'center',cursor:'pointer',fontSize:'0.85rem'}}>
                        <input type="radio" name="rerun" checked={form.is_rerun === true}
                          onChange={() => set('is_rerun', true)} />
                        Yes — re-run, improve the model
                      </label>
                      <label style={{display:'flex',gap:'0.4rem',alignItems:'center',cursor:'pointer',fontSize:'0.85rem'}}>
                        <input type="radio" name="rerun" checked={form.is_rerun === false}
                          onChange={() => { set('is_rerun', false); set('prior_session_id', null) }} />
                        No — treat as a fresh run
                      </label>
                    </div>
                    {form.is_rerun && priorSessions.length > 0 && (
                      <div style={{marginTop:'0.75rem'}}>
                        <label className="form-label" style={{fontSize:'0.78rem'}}>Link to prior session (import validated anchors)</label>
                        <select className="form-select" style={{fontSize:'0.82rem'}}
                          value={form.prior_session_id || ''}
                          onChange={e => set('prior_session_id', e.target.value || null)}>
                          <option value="">— No prior session —</option>
                          {priorSessions.map(s => (
                            <option key={s.id} value={s.id}>
                              {s.name} — {s.matched_photos} matched, {new Date(s.created_at).toLocaleDateString()}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                ) : (
                  <>ℹ Folder looks like a fresh set of photos — first run mode.</>
                )}
              </div>
            )}

            <div className="form-group">
              <FolderBrowser
                label="Output Folder — where to save sorted photos *"
                value={form.output_path}
                onChange={v => set('output_path', v)}
              />
              <p className="text-muted" style={{marginTop:'0.3rem',fontSize:'0.78rem'}}>
                Created if it doesn't exist. Can be a Google Drive folder.
              </p>
            </div>
          </div>

          {form.is_rerun && (
            <div className="alert alert-info mb-2">
              🧠 <strong>Re-run mode:</strong> Validated photos from the prior session will be used as high-confidence
              model anchors. They'll be skipped during re-scan and their user-entered dates are preserved exactly.
            </div>
          )}

          {creating && statusMsg && (
            <div className="alert alert-info mb-2" style={{textAlign:'center'}}>
              <span className="spin" style={{marginRight:'0.5rem'}}>⟳</span>
              {statusMsg}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={creating}>
            {creating
              ? <><span className="spin">⟳</span> Working…</>
              : form.is_rerun ? '→ Create Re-run Session' : '→ Create Session & Scan Photos'
            }
          </button>
        </form>

        {/* Help panel */}
        <div>
          <div className="card mb-2">
            <div className="card-title">❓ How this works</div>
            <ol style={{paddingLeft:'1.25rem',fontSize:'0.83rem',color:'var(--muted)',lineHeight:1.9}}>
              <li>Point at a folder of scanned photos</li>
              <li>Click on the subject's face (you'll confirm each selection)</li>
              <li>AI scans every photo and finds that person</li>
              <li>You review uncertain matches + add date hints</li>
              <li>Photos are copied with sortable filenames</li>
              <li>Re-run to refine: validated photos train a better model</li>
            </ol>
          </div>
          <div className="card mb-2">
            <div className="card-title">📝 Filename format</div>
            <div style={{fontSize:'0.82rem',color:'var(--muted)',lineHeight:2}}>
              <code style={{color:'#a5d6ff',display:'block',fontSize:'0.95rem',marginBottom:'0.5rem'}}>025_~1992_photo.jpg</code>
              <strong style={{color:'var(--text)'}}>025</strong> = age (primary sort)<br/>
              <strong style={{color:'var(--text)'}}>~1992</strong> = AI-estimated year<br/>
              <strong style={{color:'var(--text)'}}>=1992</strong> = 🔒 user-confirmed year<br/>
              <strong style={{color:'var(--text)'}}>photo</strong> = original filename<br/>
              <div style={{marginTop:'0.5rem',fontSize:'0.78rem'}}>
                Alphabetical sort = chronological order in any file browser or playlist.
              </div>
            </div>
          </div>
          {form.is_rerun && (
            <div className="card">
              <div className="card-title">🔁 Re-run improvements</div>
              <ul style={{paddingLeft:'1.25rem',fontSize:'0.82rem',color:'var(--muted)',lineHeight:1.9}}>
                <li>Validated photos = high-confidence anchors (2× weight)</li>
                <li>Age-bucketed enrollment samples across decades</li>
                <li>Previously validated photos are not re-scanned</li>
                <li>User-locked dates are preserved exactly as-is</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December']
