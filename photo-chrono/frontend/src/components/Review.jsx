import { useState, useEffect, useRef } from 'react'
import StripViewer from './StripViewer.jsx'

const TABS = [
  { id: 'uncertain', label: '🔍 Uncertain Matches', emptyMsg: 'No uncertain matches to review!' },
  { id: 'no_face',   label: '👻 No Face Detected',  emptyMsg: 'No faceless photos to review!' },
]

export default function Review({ session, onDone }) {
  const [tab, setTab]           = useState('uncertain')
  const [uncertain, setUncertain] = useState([])
  const [noFace, setNoFace]     = useState([])
  const [idx, setIdx]           = useState(0)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [rescanning, setRescanning] = useState(false)

  const [dateYear,  setDateYear]  = useState('')
  const [dateMonth, setDateMonth] = useState('')
  const [approx,    setApprox]    = useState(true)
  const [ageOverride, setAgeOverride] = useState('')

  // Face overlay state
  const [faces, setFaces]         = useState([])
  const [selectedFace, setSelectedFace] = useState(null)
  const [imgDims, setImgDims]     = useState(null)
  const [facesThumbW, setFacesThumbW] = useState(null)
  const [facesThumbH, setFacesThumbH] = useState(null)
  const imgRef = useRef(null)

  useEffect(() => { loadAll() }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/sessions/${session.id}/review`)
      const d = await r.json()
      setUncertain(d.uncertain || d.photos || [])
      setNoFace(d.no_face || [])
      // If no uncertain, switch to no_face tab
      if (!(d.uncertain || d.photos || []).length && (d.no_face || []).length) {
        setTab('no_face')
      }
    } finally { setLoading(false) }
  }

  const queue = tab === 'uncertain' ? uncertain : noFace
  const current = queue[idx]
  const allDone = uncertain.length === 0 && noFace.length === 0

  const resetForm = () => { setDateYear(''); setDateMonth(''); setApprox(true); setAgeOverride('') }

  // Load face data when current photo changes (only for uncertain tab)
  useEffect(() => {
    if (!current) return
    setFaces([])
    setSelectedFace(null)
    setImgDims(null)
    setFacesThumbW(null)
    setFacesThumbH(null)
    if (tab === 'no_face') return  // No faces to detect
    loadFaces(current.id)
  }, [current?.id, tab])

  const loadFaces = (photoId) => {
    fetch(`/api/faces/${session.id}/${photoId}`)
      .then(r => r.json())
      .then(data => {
        const faceList = data.faces || []
        setFaces(faceList)
        setFacesThumbW(data.thumb_w || null)
        setFacesThumbH(data.thumb_h || null)
        if (current?.matched_face_idx != null) {
          setSelectedFace(current.matched_face_idx)
        } else {
          let bestIdx = 0, bestScore = -1
          faceList.forEach((f, i) => {
            if (f.score != null && f.score > bestScore) { bestScore = f.score; bestIdx = i }
          })
          setSelectedFace(bestIdx)
        }
      })
      .catch(() => {})
  }

  const rescanFaces = async () => {
    if (!current) return
    setRescanning(true)
    try {
      const r = await fetch(`/api/faces/${session.id}/${current.id}/rescan`, { method: 'POST' })
      const data = await r.json()
      const faceList = data.faces || []
      setFaces(faceList)
      setFacesThumbW(data.thumb_w || null)
      setFacesThumbH(data.thumb_h || null)
      // Re-select best face
      let bestIdx = 0, bestScore = -1
      faceList.forEach((f, i) => {
        if (f.score != null && f.score > bestScore) { bestScore = f.score; bestIdx = i }
      })
      setSelectedFace(bestIdx)
    } catch {} finally { setRescanning(false) }
  }

  const onImgLoad = () => {
    const img = imgRef.current
    if (!img) return
    setImgDims({
      naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
      dispWidth: img.clientWidth, dispHeight: img.clientHeight,
    })
  }

  useEffect(() => {
    const h = () => { if (imgRef.current) onImgLoad() }
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  const advance = async () => {
    const next = idx + 1
    if (next >= queue.length) {
      // Reload from server
      const r = await fetch(`/api/sessions/${session.id}/review`)
      const d = await r.json()
      setUncertain(d.uncertain || d.photos || [])
      setNoFace(d.no_face || [])
      const newQueue = tab === 'uncertain' ? (d.uncertain || d.photos || []) : (d.no_face || [])
      if (!newQueue.length) {
        // Switch to other tab if it has items
        const otherTab = tab === 'uncertain' ? 'no_face' : 'uncertain'
        const otherQueue = otherTab === 'uncertain' ? (d.uncertain || d.photos || []) : (d.no_face || [])
        if (otherQueue.length) { setTab(otherTab); setIdx(0) }
        // else allDone will render
      } else {
        setIdx(0)
      }
    } else {
      setIdx(next)
    }
    resetForm()
  }

  // ── Uncertain match decision ──
  const decideUncertain = async (confirmed) => {
    if (!current) return
    setSaving(true)
    try {
      await fetch(`/api/sessions/${session.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_id: current.id,
          confirmed,
          date_hint_year:  dateYear  ? parseInt(dateYear)  : null,
          date_hint_month: dateMonth ? parseInt(dateMonth) : null,
          date_hint_approx: approx,
          age_override: ageOverride !== '' ? parseInt(ageOverride) : null,
          face_idx: selectedFace,
        }),
      })
      await advance()
    } finally { setSaving(false) }
  }

  // ── No-face decision ──
  const decideNoFace = async (action) => {
    if (!current) return
    setSaving(true)
    try {
      await fetch(`/api/sessions/${session.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_id: current.id,
          confirmed: action, // 'no_face' = accept with date, 'no' = skip/exclude
          date_hint_year:  dateYear  ? parseInt(dateYear)  : null,
          date_hint_month: dateMonth ? parseInt(dateMonth) : null,
          date_hint_approx: approx,
        }),
      })
      await advance()
    } finally { setSaving(false) }
  }

  // ── Renders ──

  if (loading) return (
    <div style={{textAlign:'center',padding:'3rem'}}>
      <span className="spin" style={{fontSize:'2rem'}}>⟳</span>
      <p className="text-muted mt-2">Loading review queue…</p>
    </div>
  )

  if (allDone && !loading) return (
    <div>
      <div className="card fade-in" style={{textAlign:'center',padding:'3rem'}}>
        <div style={{fontSize:'3rem',marginBottom:'1rem'}}>✅</div>
        <h3 style={{fontWeight:700,marginBottom:'0.5rem'}}>All photos reviewed!</h3>
        <p className="text-muted" style={{marginBottom:'1.5rem'}}>
          Use the Strip Viewer below to make final corrections before exporting.
        </p>
        <button className="btn btn-primary" onClick={onDone}>→ Go to Export</button>
      </div>
      <StripViewer sessionId={session.id} session={session} />
    </div>
  )

  const filename = current?.rel_path?.split('/').pop() || current?.rel_path || ''
  const estimatedAge = current?.estimated_age
  const birthYear = session.birth_year
  const estimatedYear = estimatedAge != null && birthYear ? birthYear + estimatedAge : current?.estimated_year
  const confidence = Math.round((current?.match_score || 0) * 100)

  // Face box overlay (uncertain tab only)
  // bbox coords are in thumbnail space (thumb_w x thumb_h), scale to displayed image
  const faceBoxes = (tab === 'uncertain' ? faces : []).map((f, i) => {
    if (!imgDims || !f.bbox || !facesThumbW || !facesThumbH) return null
    const [x1, y1, x2, y2] = f.bbox  // thumbnail-space coordinates
    const scaleX = imgDims.dispWidth / facesThumbW
    const scaleY = imgDims.dispHeight / facesThumbH
    const isSelected = selectedFace === i
    const isAIPick = current?.matched_face_idx === i || (current?.matched_face_idx == null && i === selectedFace)
    return {
      idx: i, left: x1 * scaleX, top: y1 * scaleY,
      width: (x2 - x1) * scaleX, height: (y2 - y1) * scaleY,
      isSelected, isAIPick, age: f.age, score: f.score,
    }
  }).filter(Boolean)

  return (
    <div className="fade-in">
      <div className="flex items-center justify-between mb-2">
        <h2 style={{fontSize:'1.2rem',fontWeight:700}}>④ Review Photos</h2>
        <div className="text-muted">
          {current ? `Photo ${idx + 1} of ${queue.length}` : 'No photos'}
          {tab === 'uncertain' ? ' (uncertain)' : ' (no face)'}
        </div>
      </div>

      {/* Category tabs */}
      <div style={{display:'flex',gap:'0.5rem',marginBottom:'1.25rem'}}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setTab(t.id); setIdx(0); resetForm() }}
            style={{position:'relative'}}
          >
            {t.label}
            <span style={{
              marginLeft:'0.5rem',
              background: tab === t.id ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)',
              padding:'1px 8px', borderRadius:'10px', fontSize:'0.75rem',
            }}>
              {t.id === 'uncertain' ? uncertain.length : noFace.length}
            </span>
          </button>
        ))}
      </div>

      {!current ? (
        <div className="card" style={{textAlign:'center',padding:'2rem'}}>
          <div style={{fontSize:'2rem',marginBottom:'0.75rem'}}>✅</div>
          <p className="text-muted">{TABS.find(t => t.id === tab)?.emptyMsg}</p>
        </div>
      ) : tab === 'uncertain' ? (
        /* ── UNCERTAIN MATCH REVIEW ── */
        <>
          <p className="text-muted" style={{marginBottom:'1rem'}}>
            AI wasn't sure about these. Is this <strong>{session.subject_name}</strong>?
            {faces.length > 1 && (
              <span style={{color:'var(--accent)',fontWeight:600}}> Click a face box to select who you mean.</span>
            )}
          </p>
          <div className="review-layout">
            <div>
              <div className="review-photo mb-2" style={{position:'relative'}}>
                <img ref={imgRef} src={`/api/photo/${session.id}/${current.id}?size=900`}
                  alt={filename} onLoad={onImgLoad} style={{display:'block',width:'100%'}} />
                {faceBoxes.map(box => (
                  <div key={box.idx}
                    onClick={(e) => { e.stopPropagation(); setSelectedFace(box.idx) }}
                    title={`Face ${box.idx+1}${box.age!=null?` · ~${Math.round(box.age)}yrs`:''}${box.score!=null?` · ${Math.round(box.score*100)}%`:''}`}
                    style={{
                      position:'absolute', left:box.left, top:box.top, width:box.width, height:box.height,
                      border: box.isSelected ? '3px solid #10b981' : box.isAIPick ? '2px solid #f59e0b' : '2px solid rgba(255,255,255,0.5)',
                      borderRadius:'4px', cursor:'pointer',
                      boxShadow: box.isSelected ? '0 0 12px rgba(16,185,129,0.5)' : '0 0 6px rgba(0,0,0,0.4)',
                      transition:'all 0.2s ease', zIndex: box.isSelected ? 10 : 5,
                    }}
                  >
                    <div style={{
                      position:'absolute', top:'-22px', left:'50%', transform:'translateX(-50%)',
                      background: box.isSelected ? '#10b981' : box.isAIPick ? '#f59e0b' : 'rgba(0,0,0,0.6)',
                      color:'white', fontSize:'0.65rem', padding:'1px 6px', borderRadius:'8px', whiteSpace:'nowrap',
                      fontWeight: box.isSelected ? 700 : 400,
                    }}>
                      {box.isSelected && box.isAIPick ? '✓ AI Pick' : box.isSelected ? '✓ Selected' : box.isAIPick ? 'AI Pick' : `Face ${box.idx+1}`}
                    </div>
                  </div>
                ))}
              </div>
              {faces.length > 1 && (
                <div className="card mb-2" style={{padding:'0.75rem'}}>
                  <div style={{fontSize:'0.82rem',fontWeight:600,marginBottom:'0.5rem'}}>
                    👤 Which face is {session.subject_name}? Click to select:
                  </div>
                  <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
                    {faces.map((f, i) => (
                      <div key={i} onClick={() => setSelectedFace(i)} style={{
                        cursor:'pointer', border: selectedFace===i ? '3px solid #10b981' : '2px solid rgba(255,255,255,0.2)',
                        borderRadius:'8px', overflow:'hidden', width:'72px', height:'72px', position:'relative',
                        boxShadow: selectedFace===i ? '0 0 10px rgba(16,185,129,0.4)' : 'none',
                      }}>
                        <img src={`/api/photo/${session.id}/${current.id}?crop=1&face_idx=${i}&size=150&bbox=${f.bbox?.join(',')}`}
                          alt={`Face ${i+1}`} style={{width:'100%',height:'100%',objectFit:'cover'}} />
                        <div style={{position:'absolute',bottom:0,left:0,right:0,background:'rgba(0,0,0,0.7)',
                          color:'white',fontSize:'0.6rem',textAlign:'center',padding:'2px'}}>
                          {selectedFace===i ? '✓ Selected' : `~${Math.round(f.age??0)}yrs`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="card">
                <div style={{fontWeight:600,fontSize:'0.9rem'}}>{filename}</div>
                {estimatedAge != null && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    <span className="badge badge-purple">~{estimatedAge} yrs old</span>
                    {estimatedYear && <span className="badge badge-blue">~{estimatedYear}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="review-controls">
              <div className="card mb-2">
                <div className="card-title" style={{marginBottom:'0.75rem'}}>AI Confidence</div>
                <div className="confidence-bar-wrap">
                  <div className="confidence-label">
                    <span>Low</span>
                    <span style={{fontWeight:700,color: confidence>55?'var(--green)':confidence>40?'var(--gold)':'var(--red)'}}>{confidence}%</span>
                    <span>High</span>
                  </div>
                  <div className="confidence-bar"><div className="confidence-marker" style={{left:`${confidence}%`}} /></div>
                </div>
                {faces.length > 1 && <div className="text-muted mt-1" style={{fontSize:'0.78rem'}}>{faces.length} faces detected</div>}
                <div style={{display:'flex',gap:'0.5rem',marginTop:'0.75rem'}}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={rescanFaces}
                    disabled={rescanning}
                    style={{fontSize:'0.78rem',flex:1}}
                  >
                    {rescanning ? <><span className="spin">⟳</span> Rescanning…</> : '🔄 Rescan Faces'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => decideUncertain('no_face')}
                    disabled={saving}
                    style={{fontSize:'0.78rem',flex:1,color:'var(--gold)'}}
                    title="Detection is wrong — treat as no-face and assign date manually"
                  >
                    👻 Wrong Detection
                  </button>
                </div>
              </div>
              <DateHintCard dateYear={dateYear} setDateYear={setDateYear} dateMonth={dateMonth}
                setDateMonth={setDateMonth} approx={approx} setApprox={setApprox} />
              <div className="card mb-2">
                <div className="card-title">🎂 Age Override (optional)</div>
                <p className="text-muted" style={{fontSize:'0.8rem',marginBottom:'0.75rem'}}>
                  AI estimated <strong>~{estimatedAge ?? '?'} years old</strong>.
                </p>
                <div className="form-group">
                  <label className="form-label">Correct Age</label>
                  <input className="form-input" type="number" placeholder={`AI: ${estimatedAge ?? '?'}`}
                    min="0" max="80" value={ageOverride} onChange={e => setAgeOverride(e.target.value)} />
                </div>
              </div>
              <div style={{display:'flex',gap:'0.75rem'}}>
                <button className="btn btn-success" style={{flex:1,justifyContent:'center'}}
                  onClick={() => decideUncertain('yes')} disabled={saving}>
                  ✓ Yes — {session.subject_name}
                </button>
                <button className="btn btn-danger" style={{flex:1,justifyContent:'center'}}
                  onClick={() => decideUncertain('no')} disabled={saving}>
                  ✕ No — skip
                </button>
              </div>
              <button className="btn btn-ghost btn-sm mt-1" style={{width:'100%'}} onClick={onDone}>
                Done reviewing → Export
              </button>
            </div>
          </div>
        </>
      ) : (
        /* ── NO FACE REVIEW ── */
        <>
          <p className="text-muted" style={{marginBottom:'1rem'}}>
            No face was detected in these photos. If {session.subject_name} is in the photo (back turned, obscured, etc.),
            assign a year and it'll be placed chronologically. Otherwise, skip it.
          </p>
          <div className="review-layout">
            <div>
              <div className="review-photo mb-2">
                <img ref={imgRef} src={`/api/photo/${session.id}/${current.id}?size=900`}
                  alt={filename} onLoad={onImgLoad} style={{display:'block',width:'100%'}} />
              </div>
              <div className="card">
                <div style={{fontWeight:600,fontSize:'0.9rem'}}>{filename}</div>
                <div className="text-muted" style={{fontSize:'0.78rem',fontFamily:'monospace'}}>{current.rel_path}</div>
                <div className="flex gap-1 mt-1">
                  <span className="badge badge-red">No face detected</span>
                </div>
              </div>
            </div>
            <div className="review-controls">
              <div className="card mb-2" style={{borderColor:'var(--accent)',background:'rgba(124,58,237,0.05)'}}>
                <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.75rem'}}>
                  <div style={{fontSize:'1.5rem'}}>👻</div>
                  <div>
                    <div style={{fontWeight:600}}>No Face Detected</div>
                    <div className="text-muted" style={{fontSize:'0.82rem'}}>
                      AI couldn't find a face. Is {session.subject_name} in this photo?
                    </div>
                  </div>
                </div>
              </div>
              <DateHintCard dateYear={dateYear} setDateYear={setDateYear} dateMonth={dateMonth}
                setDateMonth={setDateMonth} approx={approx} setApprox={setApprox}
                required={true} label="When was this taken?" />
              <div style={{display:'flex',gap:'0.75rem'}}>
                <button className="btn btn-success" style={{flex:1,justifyContent:'center'}}
                  onClick={() => decideNoFace('no_face')} disabled={saving || !dateYear}
                  title={!dateYear ? 'Please enter a year first' : ''}>
                  ✓ Include — {dateYear ? `place in ${dateYear}` : 'enter year first'}
                </button>
                <button className="btn btn-danger" style={{flex:1,justifyContent:'center'}}
                  onClick={() => decideNoFace('no')} disabled={saving}>
                  ✕ Skip
                </button>
              </div>
              <button className="btn btn-ghost btn-sm mt-1" style={{width:'100%'}} onClick={onDone}>
                Done reviewing → Export
              </button>
            </div>
          </div>
        </>
      )}

      <StripViewer sessionId={session.id} session={session} centerPhotoId={current?.id} />
    </div>
  )
}

function DateHintCard({ dateYear, setDateYear, dateMonth, setDateMonth, approx, setApprox, required, label }) {
  return (
    <div className="card mb-2">
      <div className="card-title">{label || '📅 Date Hint (optional)'}</div>
      <div className="form-row-2">
        <div className="form-group">
          <label className="form-label">Year {required && <span style={{color:'var(--red)'}}>*</span>}</label>
          <input className="form-input" type="number" placeholder="e.g. 1985"
            min="1920" max="2026" value={dateYear} onChange={e => setDateYear(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Month</label>
          <select className="form-select" value={dateMonth} onChange={e => setDateMonth(e.target.value)}>
            <option value="">Unknown</option>
            {MONTHS.map((m,i) => <option key={i} value={i+1}>{m}</option>)}
          </select>
        </div>
      </div>
      <label style={{display:'flex',alignItems:'center',gap:'0.5rem',fontSize:'0.82rem',color:'var(--muted)',cursor:'pointer'}}>
        <input type="checkbox" checked={approx} onChange={e => setApprox(e.target.checked)} />
        Approximate date
      </label>
    </div>
  )
}

const MONTHS = ['January','February','March','April','May','June',
               'July','August','September','October','November','December']
