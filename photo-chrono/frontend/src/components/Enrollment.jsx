import { useState, useEffect, useRef, useCallback } from 'react'
import FaceConfirmModal from './FaceConfirmModal'

export default function Enrollment({ session, enrollCount: initCount, onReady }) {
  const [samples, setSamples]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [faces, setFaces]           = useState({})
  const [activePid, setActivePid]   = useState(null)
  const [enrollCount, setEnrollCount] = useState(initCount || 0)
  const [pendingFace, setPendingFace] = useState(null)
  const [msg, setMsg]               = useState('')
  const [enrolledPhotos, setEnrolledPhotos] = useState(new Set())
  const [excludedPhotos, setExcludedPhotos] = useState(new Set())

  // Single-face auto-match config — asked before enrollment
  const [configDone, setConfigDone] = useState(false)
  const [singleFaceAutoMatch, setSingleFaceAutoMatch] = useState(true)

  // Auto-enroll queue for single-face photos
  const autoQueueRef = useRef([])
  const pendingRef   = useRef(null) // track if modal is open

  const ENROLL_TARGET = 8

  useEffect(() => {
    if (configDone) loadSamples()
  }, [configDone])

  const loadSamples = async () => {
    setLoading(true)
    setEnrolledPhotos(new Set())
    setExcludedPhotos(new Set())
    setFaces({})
    setActivePid(null)
    autoQueueRef.current = []
    try {
      const mode = session.is_rerun ? 'bucketed' : 'random'
      const r = await fetch(`/api/sessions/${session.id}/samples?n=9&mode=${mode}`)
      const data = await r.json()
      setSamples(data)
      // Pre-detect faces for ALL photos in parallel
      data.forEach(p => prefetchFaces(p.id))
    } finally { setLoading(false) }
  }

  // Pop next auto-enroll candidate
  const popAutoQueue = useCallback(() => {
    if (pendingRef.current) return // modal already open
    while (autoQueueRef.current.length > 0) {
      const item = autoQueueRef.current.shift()
      // Check it hasn't been enrolled in the meantime
      if (!document.querySelector(`[data-enrolled="${item.photo_id}"]`)) {
        setPendingFace(item)
        pendingRef.current = item
        setActivePid(item.photo_id)
        return
      }
    }
  }, [])

  const prefetchFaces = async (pid) => {
    try {
      const r = await fetch(`/api/faces/${session.id}/${pid}`)
      const d = await r.json()
      setFaces(f => ({ ...f, [pid]: { faces: d.faces, w: d.thumb_w, h: d.thumb_h } }))

      // Auto-queue: if exactly 1 face + auto-match on → queue for auto-confirm
      if (singleFaceAutoMatch && d.faces && d.faces.length === 1) {
        const face = d.faces[0]
        autoQueueRef.current.push({
          photo_id: pid,
          face_idx: face.idx,
          age: face.age,
          bbox_orig: face.bbox_orig || face.bbox,
          auto: true,
        })
        // Try to pop immediately if no modal is open
        setTimeout(() => popAutoQueue(), 100)
      }
    } catch {}
  }

  const loadFaces = async (pid) => {
    if (faces[pid]) return
    await prefetchFaces(pid)
  }

  const handlePhotoClick = async (pid) => {
    if (enrolledPhotos.has(pid)) return
    setActivePid(pid)
    if (!faces[pid]) await loadFaces(pid) // Fallback if prefetch hasn't finished
  }

  const handleFaceClick = (pid, faceIdx, age, bboxOrig, e) => {
    e.stopPropagation()
    const item = { photo_id: pid, face_idx: faceIdx, age, bbox_orig: bboxOrig }
    setPendingFace(item)
    pendingRef.current = item
  }

  // Confirm enroll — then pop next auto-queue item
  const handleConfirmEnroll = async (knownYear) => {
    if (!pendingFace) return
    const { photo_id, face_idx } = pendingFace
    setMsg('')
    try {
      const body = { photo_id, face_idx }
      if (knownYear) body.known_year = knownYear
      const res = await fetch(`/api/sessions/${session.id}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail)
      setEnrollCount(d.enrolled)
      const yearNote = knownYear ? ` (📅 ${knownYear})` : ''
      const autoNote = pendingFace.auto ? ' (auto-detected solo)' : ''
      setMsg(`✓ Face enrolled! Total: ${d.enrolled} / ${ENROLL_TARGET}${yearNote}${autoNote}`)
      setPendingFace(null)
      pendingRef.current = null
      setEnrolledPhotos(prev => new Set([...prev, photo_id]))
      setActivePid(null)
      // Pop next auto-queue item after a brief pause
      setTimeout(() => popAutoQueue(), 300)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
      setPendingFace(null)
      pendingRef.current = null
      setTimeout(() => popAutoQueue(), 300)
    }
  }

  const handleExcludePhoto = async (pid, e) => {
    if (e) e.stopPropagation()
    try {
      await fetch(`/api/photos/${session.id}/${pid}/exclude`, { method: 'PUT' })
      setExcludedPhotos(prev => new Set([...prev, pid]))
      setActivePid(null)
      setMsg(`✕ Photo excluded — not ${session.subject_name || 'the subject'}`)
    } catch {}
  }

  const handleCancelEnroll = () => {
    setPendingFace(null)
    pendingRef.current = null
    // Pop next auto-queue item
    setTimeout(() => popAutoQueue(), 200)
  }

  const handleSaveConfig = async () => {
    // Save the single-face preference to the session
    try {
      await fetch(`/api/sessions/${session.id}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ single_face_auto_match: singleFaceAutoMatch }),
      })
    } catch {} // Non-critical — default is true anyway
    setConfigDone(true)
  }

  const unenrolledCount = samples.filter(s => !enrolledPhotos.has(s.id) && !excludedPhotos.has(s.id)).length
  const allEnrolled = samples.length > 0 && unenrolledCount === 0

  // ── Pre-enrollment config screen ──
  if (!configDone) {
    return (
      <div className="fade-in">
        <h2 style={{fontSize:'1.2rem',fontWeight:700,marginBottom:'0.5rem'}}>
          ② Before We Start — Quick Setup
        </h2>

        <div className="card mb-2" style={{border:'2px solid var(--accent)',padding:'1.5rem'}}>
          <div style={{fontSize:'1.5rem',marginBottom:'0.75rem'}}>👤 Solo Photo Rule</div>
          <p className="text-muted" style={{marginBottom:'1rem',fontSize:'0.88rem',lineHeight:1.7}}>
            Many scanned photos have just <strong>one person</strong> in them.
            Should we assume that person is always <strong>{session.subject_name || 'the subject'}</strong>?
          </p>
          <p className="text-muted" style={{marginBottom:'1.25rem',fontSize:'0.82rem'}}>
            This dramatically increases matches for solo portraits, school photos,
            and headshots where age/angle differences might fool the AI.
          </p>

          <div style={{display:'flex',flexDirection:'column',gap:'0.75rem'}}>
            {[
              [true, '✓ Yes — if there\'s only one face, it\'s ' + (session.subject_name || 'the subject'), 'Recommended for most family photo collections'],
              [false, '✕ No — only match by face similarity score', 'More conservative, may miss photos where age changed significantly'],
            ].map(([val, label, hint]) => (
              <label key={String(val)} style={{
                display:'flex',alignItems:'flex-start',gap:'0.75rem',cursor:'pointer',
                padding:'1rem',borderRadius:'var(--radius)',
                border:`2px solid ${singleFaceAutoMatch === val ? 'var(--accent)' : 'var(--border)'}`,
                background: singleFaceAutoMatch === val ? 'rgba(124,58,237,0.1)' : 'var(--bg3)',
                transition:'all 0.15s'
              }}>
                <input type="radio" name="single_face"
                  checked={singleFaceAutoMatch === val}
                  onChange={() => setSingleFaceAutoMatch(val)}
                  style={{accentColor:'var(--accent)',marginTop:'0.15rem'}}
                />
                <div>
                  <div style={{fontWeight:singleFaceAutoMatch === val ? 600 : 400,fontSize:'0.9rem'}}>
                    {label}
                  </div>
                  <div style={{fontSize:'0.78rem',color:'var(--muted)',marginTop:'0.2rem'}}>{hint}</div>
                </div>
              </label>
            ))}
          </div>

          <button className="btn btn-primary" onClick={handleSaveConfig}
            style={{marginTop:'1.25rem',width:'100%'}}>
            → Continue to Face Enrollment
          </button>
        </div>
      </div>
    )
  }

  // ── Main enrollment screen ──
  return (
    <div className="fade-in">
      <h2 style={{fontSize:'1.2rem',fontWeight:700,marginBottom:'0.25rem'}}>
        ② Teach the AI — Who is {session.subject_name || 'the subject'}?
      </h2>
      <p className="text-muted" style={{marginBottom:'0.75rem',lineHeight:1.6}}>
        Pick photos where you can clearly see <strong>{session.subject_name || 'the subject'}</strong> and click on their face.
        The AI needs <strong>at least 3 examples</strong> to learn what {session.subject_name || 'they'} look{session.subject_name ? 's' : ''} like at different ages.
      </p>

      {singleFaceAutoMatch && (
        <div className="alert alert-success mb-2" style={{fontSize:'0.85rem'}}>
          <strong>🎯 Don't stress about solo portraits!</strong>{' '}
          You chose "Solo photos = auto-matched" — in the next step, the AI will <strong>automatically match</strong>{' '}
          any photo where only one face is detected. Focus here on <strong>group photos</strong>{' '}
          or clear shots at different ages to teach the AI what {session.subject_name || 'the subject'} looks like.
        </div>
      )}

      {session.is_rerun && <div className="alert alert-info mb-2">🔄 RE-RUN — Anchors from prior session loaded as reference.</div>}

      {/* Confirmation modal */}
      {pendingFace && (
        <FaceConfirmModal
          sessionId={session.id}
          photoId={pendingFace.photo_id}
          faceIdx={pendingFace.face_idx}
          bbox={pendingFace.bbox_orig}
          subjectName={session.subject_name}
          age={pendingFace.age}
          birthYear={session.birth_year}
          onConfirm={handleConfirmEnroll}
          onCancel={handleCancelEnroll}
        />
      )}

      {/* Progress */}
      <div className="card mb-2">
        <div className="flex items-center gap-1 justify-between">
          <div>
            <div style={{fontWeight:600,marginBottom:'0.25rem'}}>
              Enrollment Progress: {enrollCount} / {ENROLL_TARGET}
              {session.is_rerun && enrollCount > 0 && (
                <span className="text-muted" style={{fontSize:'0.78rem',marginLeft:'0.5rem'}}>
                  (includes anchors from prior session)
                </span>
              )}
            </div>
            <div className="text-muted" style={{fontSize:'0.78rem'}}>
              Minimum 3 required · More = better · Aim for different ages ·
              {unenrolledCount > 0
                ? ` ${unenrolledCount} photos remaining in this batch`
                : ' All photos in this batch enrolled!'}
            </div>
          </div>
          <div className="enroll-faces">
            {Array.from({length: ENROLL_TARGET}).map((_,i) => (
              <div key={i} className={`face-dot ${i < enrollCount ? 'filled' : ''}`}>
                {i < enrollCount ? '✓' : i+1}
              </div>
            ))}
          </div>
        </div>
        <div className="progress-wrap mt-1">
          <div className="progress-bar" style={{width:`${Math.min(100, enrollCount/ENROLL_TARGET*100)}%`}} />
        </div>
        {msg && (
          <div className={`alert ${msg.startsWith('Error') ? 'alert-error' : 'alert-success'} mt-1`}>
            {msg}
          </div>
        )}
        <div className="flex gap-1 mt-2">
          <button className="btn btn-ghost btn-sm" onClick={loadSamples} disabled={loading}>
            {loading ? <span className="spin">⟳</span> : '↻'} Load {allEnrolled ? 'more' : 'different'} photos
          </button>
          <button className="btn btn-primary" disabled={enrollCount < 3} onClick={onReady}
            style={{marginLeft:'auto'}}>
            {enrollCount < 3
              ? `Need ${3 - enrollCount} more`
              : `→ Start Processing (${enrollCount} faces enrolled)`}
          </button>
        </div>
      </div>

      {/* Photo grid */}
      <div className="photo-grid">
        {samples.map(p => (
          <PhotoEnrollCard key={p.id}
            photoId={p.id} sessionId={session.id} relPath={p.rel_path}
            isActive={activePid === p.id} faceInfo={faces[p.id]}
            isEnrolled={enrolledPhotos.has(p.id)}
            isExcluded={excludedPhotos.has(p.id)}
            subjectName={session.subject_name}
            onClick={() => handlePhotoClick(p.id)}
            onFaceClick={(fi, age, bboxOrig, e) => handleFaceClick(p.id, fi, age, bboxOrig, e)}
            onExclude={(e) => handleExcludePhoto(p.id, e)}
          />
        ))}
      </div>

      <div className="card mt-3" style={{background:'var(--bg3)',border:'1px solid var(--border)'}}>
        <div style={{fontWeight:600,marginBottom:'0.5rem'}}>📖 How This Works</div>
        <div className="text-muted" style={{fontSize:'0.82rem',lineHeight:1.7}}>
          <strong>This step (Enrollment)</strong> teaches the AI what {session.subject_name || 'the subject'} looks like by collecting face examples.
          Click a photo → click the highlighted face box → confirm it's {session.subject_name || 'them'}.
          <br/><br/>
          <strong>Next step (Processing)</strong> will scan <em>every</em> photo automatically:
          <ul style={{margin:'0.5rem 0 0 1.25rem',padding:0}}>
            {singleFaceAutoMatch && <li>📷 Solo portraits (1 face only) → <strong>auto-matched</strong> as {session.subject_name || 'the subject'}</li>}
            <li>🔍 Multi-face photos → AI compares faces against your enrollments to find {session.subject_name || 'them'}</li>
            <li>❓ Uncertain matches → you'll review them manually in step 4</li>
          </ul>
          <br/>
          <strong>Tip:</strong> Enroll faces from group photos and clear headshots at different ages.
          {singleFaceAutoMatch && <> Solo portraits will be handled automatically — no need to enroll those.</>}
        </div>
      </div>
    </div>
  )
}

function PhotoEnrollCard({ photoId, sessionId, relPath, isActive, faceInfo, isEnrolled, isExcluded, subjectName, onClick, onFaceClick, onExclude }) {
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef(null)
  const filename = relPath?.split('/').pop() || relPath
  const isDone = isEnrolled || isExcluded

  return (
    <div className={`photo-card ${isActive ? 'selected' : ''}`}
      onClick={isDone ? undefined : onClick}
      style={{
        opacity: isDone ? 0.4 : 1,
        pointerEvents: isDone ? 'none' : 'auto',
        position: 'relative',
      }}>
      {/* Enrolled badge */}
      {isEnrolled && (
        <div style={{
          position:'absolute', top:8, right:8, zIndex:10,
          background:'rgba(16,185,129,0.9)', color:'#fff',
          borderRadius:'50%', width:28, height:28,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:'0.9rem', fontWeight:700
        }}>✓</div>
      )}
      {/* Excluded badge */}
      {isExcluded && (
        <div style={{
          position:'absolute', top:8, right:8, zIndex:10,
          background:'rgba(239,68,68,0.9)', color:'#fff',
          borderRadius:'50%', width:28, height:28,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:'0.9rem', fontWeight:700
        }}>✕</div>
      )}
      <div className="photo-img-wrap">
        <img ref={imgRef}
          src={`/api/photo/${sessionId}/${photoId}?size=400`}
          alt={filename}
          onLoad={() => setLoaded(true)}
          style={{opacity: loaded ? 1 : 0, transition:'opacity 0.3s'}}
        />
        {isActive && faceInfo?.faces?.map(face => {
          const [x1,y1,x2,y2] = face.bbox
          const imgEl = imgRef.current
          const dispW = imgEl?.clientWidth || 200
          const dispH = imgEl?.clientHeight || 200
          const scaleX = dispW / (faceInfo.w || 800)
          const scaleY = dispH / (faceInfo.h || 600)
          return (
            <div key={face.idx} className="face-box"
              onClick={(e) => onFaceClick(face.idx, face.age, face.bbox_orig || face.bbox, e)}
              style={{
                left: x1*scaleX, top: y1*scaleY,
                width: (x2-x1)*scaleX, height: (y2-y1)*scaleY,
              }}>
              {face.age > 0 && <div className="face-label">~{face.age}yr</div>}
            </div>
          )
        })}
        {!loaded && (
          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
            <span className="spin" style={{fontSize:'1.5rem',opacity:0.3}}>⟳</span>
          </div>
        )}
        {isActive && !faceInfo && loaded && (
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.5)',
            display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:'0.8rem'}}>
            <span className="spin">⟳</span> Detecting faces…
          </div>
        )}
        {isActive && faceInfo?.faces?.length === 0 && (
          <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.5)',
            display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:'0.8rem'}}>
            No faces detected
          </div>
        )}
      </div>
      <div className="photo-meta">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'0.25rem'}}>
          <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{filename}</div>
          {!isDone && loaded && (
            <button
              onClick={onExclude}
              title={`Not ${subjectName || 'the subject'}`}
              style={{
                background:'transparent', border:'1px solid rgba(239,68,68,0.4)',
                color:'#f87171', borderRadius:4, padding:'1px 6px',
                fontSize:'0.65rem', cursor:'pointer', whiteSpace:'nowrap',
                transition:'all 0.15s', fontFamily:'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.15)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              ✕ Not {subjectName || 'them'}
            </button>
          )}
        </div>
        {isExcluded
          ? <div style={{color:'var(--red)'}}>✕ Excluded</div>
          : isEnrolled
            ? <div style={{color:'var(--green)'}}>✓ Enrolled</div>
            : faceInfo
              ? <div>{faceInfo.faces?.length || 0} face(s) · click to enroll</div>
              : <div className="text-muted"><span className="spin">⟳</span> Detecting faces…</div>
        }
      </div>
    </div>
  )
}
