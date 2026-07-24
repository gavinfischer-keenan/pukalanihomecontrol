import { useState, useEffect, useRef } from 'react'
import { hintLabel, hintPlaceholder } from '../utils.js'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * StripViewer
 * Collapsible horizontal filmstrip + full-size annotation panel.
 * Props:
 *   sessionId      — current session
 *   session        — full session object (for birth_year, subject_name)
 *   centerPhotoId  — which photo to center on initially
 *   onValidated    — callback when user validates/rejects a photo
 *   onModelUpdate  — callback to trigger "Update Model"
 */
export default function StripViewer({ sessionId, session, centerPhotoId, onValidated, onModelUpdate }) {
  const [open, setOpen]         = useState(false)
  const [window, setWindow]     = useState(10)   // ±window
  const [stripData, setStrip]   = useState(null)
  const [activeId, setActiveId] = useState(centerPhotoId || '')
  const [fullPhoto, setFull]    = useState(null) // the photo being shown large
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const stripRef = useRef(null)

  // Annotation state for the active photo
  const [dateYear,   setDateYear]   = useState('')
  const [dateMonth,  setDateMonth]  = useState('')
  const [approx,     setApprox]     = useState(true)
  const [ageOverride, setAgeOverride] = useState('')
  const [hintText,   setHintText]   = useState('')
  const [hintDir,    setHintDir]    = useState(null)  // 'older'|'younger'|'confident'|null
  const [hintResult, setHintResult] = useState(null)  // response from /hint endpoint

  useEffect(() => {
    if (open && activeId) loadStrip(activeId)
  }, [open, activeId, window])

  useEffect(() => {
    if (open && !activeId && centerPhotoId) setActiveId(centerPhotoId)
  }, [open, centerPhotoId])

  const loadStrip = async (cid) => {
    try {
      const r = await fetch(`/api/sessions/${sessionId}/strip?center_id=${cid}&window=${window}`)
      const d = await r.json()
      setStrip(d)
      const center = d.photos?.[d.center_idx]
      if (center) openPhoto(center)
    } catch {}
  }

  const openPhoto = (photo) => {
    setFull(photo)
    setDateYear(photo.date_hint_year || '')
    setDateMonth(photo.date_hint_month || '')
    setApprox(!photo.date_locked)
    setAgeOverride(photo.age_override ?? '')
    setHintText(photo.user_hint || '')
    setHintDir(photo.hint_direction || null)
    setHintResult(null)
    setMsg('')
  }

  const handleThumbnailClick = (photo) => {
    setActiveId(photo.id)
    openPhoto(photo)
    loadStrip(photo.id)
  }

  const saveValidation = async (isSubject) => {
    if (!fullPhoto) return
    setSaving(true)
    setMsg('')
    try {
      const body = {
        photo_id:    fullPhoto.id,
        is_subject:  isSubject,
        date_hint_year:  dateYear  ? parseInt(dateYear)  : null,
        date_hint_month: dateMonth ? parseInt(dateMonth) : null,
        date_hint_approx: approx,
        age_override: ageOverride !== '' ? parseInt(ageOverride) : null,
        lock_date: !!dateYear,
      }
      const res = await fetch(`/api/sessions/${sessionId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).detail)
      setMsg(isSubject ? '✓ Validated as subject' : '✕ Marked as not the subject')
      await loadStrip(activeId)
      if (onValidated) onValidated(fullPhoto.id, isSubject)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const saveHint = async (direction, text) => {
    if (!fullPhoto) return
    const dir = direction ?? hintDir
    const txt = text ?? hintText
    setSaving(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_id: fullPhoto.id,
          user_hint: txt,
          hint_direction: dir,
          nudge_years: 4,
        }),
      })
      const d = await res.json()
      setHintDir(dir)
      setHintResult(d)
      setMsg(dir
        ? `💡 Hint saved: ${hintLabel(session, dir)}`
        : '💡 Hint cleared')
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const triggerModelUpdate = async () => {
    setMsg('Updating model…')
    try {
      const r = await fetch(`/api/sessions/${sessionId}/update-model`, { method: 'POST' })
      const d = await r.json()
      setMsg(`✓ Model updated: ${d.manual_embeddings} enrolled + ${d.anchor_embeddings} anchors`)
      if (onModelUpdate) onModelUpdate(d)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    }
  }

  const birthYear = session?.birth_year
  const ageEst = fullPhoto?.age_override ?? fullPhoto?.estimated_age
  const yearEst = fullPhoto?.date_hint_year ?? fullPhoto?.estimated_year

  return (
    <div style={{marginTop:'1.5rem', border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden'}}>

      {/* Toggle bar */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width:'100%', background:'var(--bg3)', border:'none', color:'var(--text)',
          padding:'0.75rem 1.25rem', textAlign:'left', cursor:'pointer',
          display:'flex', alignItems:'center', gap:'0.75rem', fontFamily:'inherit',
          fontSize:'0.88rem', fontWeight:600
        }}
      >
        <span style={{fontSize:'1.1rem'}}>{open ? '▲' : '▼'}</span>
        <span>🎞 Chronological Strip Viewer</span>
        {stripData && (
          <span className="badge badge-muted" style={{marginLeft:'auto'}}>
            {stripData.total} photos total · showing ±{window}
          </span>
        )}
        {!open && <span className="text-muted" style={{marginLeft: stripData ? 0 : 'auto', fontSize:'0.78rem'}}>click to expand</span>}
      </button>

      {open && (
        <div style={{background:'var(--bg2)'}}>

          {/* Controls row */}
          <div style={{
            padding:'0.75rem 1.25rem',
            borderBottom:'1px solid var(--border)',
            display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap'
          }}>
            <div style={{display:'flex', alignItems:'center', gap:'0.5rem', fontSize:'0.82rem'}}>
              <span className="text-muted">Strip width:</span>
              <input type="range" min="3" max="20" step="1" value={window}
                onChange={e => setWindow(parseInt(e.target.value))}
                style={{width:100, accentColor:'var(--accent)'}} />
              <span>±{window} photos</span>
            </div>
            <div style={{marginLeft:'auto', display:'flex', gap:'0.5rem'}}>
              <button className="btn btn-ghost btn-sm" onClick={triggerModelUpdate} disabled={saving}>
                🧠 Update Model from Validations
              </button>
            </div>
          </div>

          {/* Full photo + annotation */}
          {fullPhoto && (
            <div style={{display:'grid', gridTemplateColumns:'1fr 320px', minHeight:360}}>
              {/* Photo */}
              <div style={{background:'var(--bg)', display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem'}}>
                <img
                  src={`/api/photo/${sessionId}/${fullPhoto.id}?size=900`}
                  alt={fullPhoto.rel_path}
                  style={{maxWidth:'100%', maxHeight:480, borderRadius:8, objectFit:'contain'}}
                />
              </div>

              {/* Annotation panel */}
              <div style={{padding:'1.25rem', borderLeft:'1px solid var(--border)', overflowY:'auto'}}>
                <div style={{fontWeight:600, marginBottom:'0.25rem', fontSize:'0.88rem'}}>
                  {fullPhoto.rel_path?.split('/').pop()}
                </div>
                <div className="flex gap-1 flex-wrap mt-1 mb-2">
                  {ageEst != null && <span className="badge badge-purple">~{ageEst} yrs</span>}
                  {yearEst && <span className="badge badge-blue">~{yearEst}</span>}
                  {fullPhoto.validated && <span className="badge badge-green">✓ Validated</span>}
                  {fullPhoto.date_locked && <span className="badge badge-gold">🔒 Date locked</span>}
                  <span className={`badge badge-${scoreColor(fullPhoto.match_score)}`}>
                    {Math.round((fullPhoto.match_score || 0) * 100)}% match
                  </span>
                </div>

                {/* Date hint */}
                <div style={{fontSize:'0.82rem', fontWeight:600, marginBottom:'0.4rem', color:'var(--muted)'}}>
                  Date hint
                  {fullPhoto.date_locked && <span style={{color:'var(--gold)',marginLeft:'0.4rem'}}>🔒 locked by you</span>}
                </div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem', marginBottom:'0.5rem'}}>
                  <div>
                    <label className="form-label" style={{fontSize:'0.75rem'}}>Year</label>
                    <input className="form-input" type="number"
                      placeholder={yearEst || 'e.g. 1985'}
                      min="1920" max="2026"
                      value={dateYear}
                      onChange={e => setDateYear(e.target.value)}
                      disabled={fullPhoto.date_locked && !dateYear}
                      style={{padding:'0.4rem 0.6rem', fontSize:'0.82rem'}}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{fontSize:'0.75rem'}}>Month</label>
                    <select className="form-select" value={dateMonth}
                      onChange={e => setDateMonth(e.target.value)}
                      style={{padding:'0.4rem 0.6rem', fontSize:'0.82rem'}}>
                      <option value="">—</option>
                      {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <label style={{display:'flex', gap:'0.4rem', alignItems:'center', fontSize:'0.78rem', color:'var(--muted)', marginBottom:'0.75rem', cursor:'pointer'}}>
                  <input type="checkbox" checked={approx} onChange={e => setApprox(e.target.checked)} />
                  Approximate date
                </label>

                {/* Age override */}
                <div style={{fontSize:'0.82rem', fontWeight:600, marginBottom:'0.4rem', color:'var(--muted)'}}>
                  Age override
                </div>
                <input className="form-input" type="number"
                  placeholder={`AI says: ${ageEst ?? '?'}`}
                  min="0" max="80"
                  value={ageOverride}
                  onChange={e => setAgeOverride(e.target.value)}
                  style={{padding:'0.4rem 0.6rem', fontSize:'0.82rem', marginBottom:'0.75rem'}}
                />

                {msg && (
                  <div className={`alert ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'} mb-2`}
                    style={{fontSize:'0.78rem', padding:'0.5rem 0.75rem'}}>
                    {msg}
                  </div>
                )}

                <div style={{display:'flex', gap:'0.5rem', flexDirection:'column'}}>
                  <button className="btn btn-success btn-sm" onClick={() => saveValidation(true)} disabled={saving}
                    style={{justifyContent:'center'}}>
                    ✓ Validate — this is {session?.subject_name || 'the subject'}
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => saveValidation(false)} disabled={saving}
                    style={{justifyContent:'center'}}>
                    ✕ Not this person — remove
                  </button>
                </div>

                {/* Hint panel */}
                <div style={{
                  marginTop:'1rem',padding:'0.85rem',
                  background:'var(--bg)',borderRadius:'var(--radius)',
                  border:'1px solid var(--border)'
                }}>
                  <div style={{fontWeight:600,fontSize:'0.82rem',marginBottom:'0.5rem',
                    display:'flex',alignItems:'center',gap:'0.4rem'}}>
                    <span>💡</span> Hint for {session?.subject_name || 'the subject'}
                    <span style={{fontSize:'0.7rem',color:'var(--muted)',fontWeight:400,marginLeft:'0.25rem'}}>
                      (soft — not a command)
                    </span>
                  </div>
                  <p style={{fontSize:'0.75rem',color:'var(--muted)',marginBottom:'0.6rem',lineHeight:1.5}}>
                    Tell the AI your gut feeling. These hints gently nudge the age estimate on
                    re-run — they won’t override dates you’ve confirmed.
                  </p>

                  {/* Quick hint buttons */}
                  <div style={{display:'flex',gap:'0.4rem',flexWrap:'wrap',marginBottom:'0.6rem'}}>
                    {['older','younger','confident'].map(dir => (
                      <button key={dir}
                        onClick={() => { setHintDir(dir); saveHint(dir, hintText) }}
                        disabled={saving}
                        style={{
                          padding:'0.35rem 0.7rem',border:'1px solid var(--border)',
                          borderRadius:999,fontSize:'0.75rem',cursor:'pointer',
                          fontFamily:'inherit',transition:'all 0.15s',
                          background: hintDir === dir ? 'var(--accent)' : 'var(--bg3)',
                          color: hintDir === dir ? '#fff' : 'var(--text)',
                          fontWeight: hintDir === dir ? 600 : 400,
                        }}
                      >
                        {dir === 'older'   && '📈'}
                        {dir === 'younger' && '📉'}
                        {dir === 'confident' && '✓'}
                        {' '}{hintLabel(session, dir)}
                      </button>
                    ))}
                    {hintDir && (
                      <button onClick={() => { setHintDir(null); saveHint(null, '') }} disabled={saving}
                        style={{padding:'0.35rem 0.7rem',border:'1px solid var(--border)',
                          borderRadius:999,fontSize:'0.75rem',cursor:'pointer',
                          fontFamily:'inherit',background:'var(--bg3)',color:'var(--muted)'
                        }}>
                        ✕ Clear hint
                      </button>
                    )}
                  </div>

                  {/* Free-text hint */}
                  <textarea
                    rows={2}
                    placeholder={hintPlaceholder(session)}
                    value={hintText}
                    onChange={e => setHintText(e.target.value)}
                    onBlur={() => hintText && saveHint(hintDir, hintText)}
                    style={{
                      width:'100%',padding:'0.45rem 0.6rem',fontSize:'0.78rem',
                      background:'var(--bg2)',border:'1px solid var(--border)',
                      borderRadius:4,color:'var(--text)',resize:'vertical',
                      fontFamily:'inherit',boxSizing:'border-box'
                    }}
                  />

                  {/* Show nudged age if hint applied */}
                  {hintResult?.nudged_age != null && (
                    <div style={{marginTop:'0.4rem',fontSize:'0.75rem',color:'var(--gold)'}}>
                      💡 AI says ~{hintResult.original_age}yr → hint nudges to
                      <strong style={{color:'var(--accent2)'}}> ~{hintResult.nudged_age}yr</strong>
                      {hintResult.nudged_year && ` (~${hintResult.nudged_year})`}
                      <span style={{color:'var(--muted)',marginLeft:'0.3rem'}}>(applied on re-run)</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Filmstrip */}
          <div style={{
            borderTop:'1px solid var(--border)',
            background:'var(--bg)',
            padding:'0.75rem',
            overflowX:'auto',
            whiteSpace:'nowrap',
          }} ref={stripRef}>
            {!stripData && (
              <div style={{textAlign:'center', color:'var(--muted)', padding:'1rem'}}>
                <span className="spin">⟳</span> Loading strip…
              </div>
            )}
            {stripData?.photos?.map((photo, i) => {
              const isCenter = photo.id === activeId
              const ageLabel = photo.age_override ?? photo.estimated_age
              return (
                <div
                  key={photo.id}
                  onClick={() => handleThumbnailClick(photo)}
                  style={{
                    display:'inline-block',
                    verticalAlign:'top',
                    marginRight:'0.4rem',
                    cursor:'pointer',
                    width: Math.max(60, Math.min(110, 1100 / (window * 2 + 1))),
                  }}
                >
                  <div style={{
                    border:`2px solid ${isCenter ? 'var(--accent)' :
                           photo.validated ? 'var(--green)' :
                           photo.user_confirmed === 'yes' ? 'var(--gold)' : 'var(--border)'}`,
                    borderRadius:6,
                    overflow:'hidden',
                    transition:'all 0.15s',
                    transform: isCenter ? 'scale(1.05)' : 'scale(1)',
                    boxShadow: isCenter ? '0 0 12px rgba(124,58,237,0.5)' : 'none',
                  }}>
                    <img
                      src={`/api/photo/${sessionId}/${photo.id}?size=120`}
                      alt=""
                      loading="lazy"
                      style={{width:'100%', aspectRatio:'1', objectFit:'cover', display:'block'}}
                    />
                  </div>
                  <div style={{
                    fontSize:'0.65rem', textAlign:'center', color: isCenter ? 'var(--accent2)' : 'var(--muted)',
                    marginTop:'0.2rem', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
                    fontWeight: isCenter ? 700 : 400
                  }}>
                    {ageLabel != null ? `~${ageLabel}yr` : '?'}
                  </div>
                </div>
              )
            })}
          </div>

          {stripData && (
            <div style={{
              padding:'0.4rem 1rem', fontSize:'0.72rem', color:'var(--muted)',
              borderTop:'1px solid var(--border)', display:'flex', gap:'1rem'
            }}>
              <span>Photo {stripData.global_idx + 1} of {stripData.total}</span>
              <span className="badge badge-green" style={{fontSize:'0.65rem'}}>■ validated</span>
              <span className="badge badge-gold" style={{fontSize:'0.65rem'}}>■ confirmed</span>
              <span style={{marginLeft:'auto'}}>
                Click "Update Model" after making corrections to improve accuracy
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function scoreColor(score) {
  const pct = (score || 0) * 100
  if (pct >= 55) return 'green'
  if (pct >= 40) return 'gold'
  return 'red'
}
