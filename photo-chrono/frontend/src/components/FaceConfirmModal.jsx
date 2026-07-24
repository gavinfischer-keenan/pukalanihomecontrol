import { useState } from 'react'

/**
 * FaceConfirmModal — shown after clicking a face bounding box.
 * Displays a padded crop of the selected face and asks:
 * "Is this [subject name]?" with Confirm or Cancel buttons.
 * Optionally lets user enter a known year for this photo.
 * Nothing is enrolled until the user explicitly confirms.
 */
export default function FaceConfirmModal({ sessionId, photoId, faceIdx, bbox, subjectName, age, birthYear, onConfirm, onCancel }) {
  const [loaded, setLoaded] = useState(false)
  const [knownYear, setKnownYear] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  // Use bbox directly if available — skips re-detection on the server
  const bboxParam = bbox ? `&bbox=${bbox.join(',')}` : ''
  const src = `/api/photo/${sessionId}/${photoId}?crop=1&face_idx=${faceIdx}&size=480${bboxParam}`

  const handleConfirm = () => {
    if (enrolling) return
    setEnrolling(true)
    const year = knownYear ? parseInt(knownYear) : null
    onConfirm(year)
  }

  const estimatedAge = knownYear && birthYear ? parseInt(knownYear) - birthYear : null

  return (
    <div style={{
      position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:2000, padding:'1rem'
    }} onClick={enrolling ? undefined : onCancel}>
      <div style={{
        background:'var(--bg2)', border:'1px solid var(--border)',
        borderRadius:'var(--radius)', width:360, overflow:'hidden',
        boxShadow:'0 20px 60px rgba(0,0,0,0.5)'
      }} className="fade-in" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
          padding:'1rem 1.25rem'
        }}>
          <div style={{fontWeight:700, fontSize:'0.95rem'}}>Confirm Enrollment</div>
          <div style={{fontSize:'0.8rem', opacity:0.85, marginTop:'0.15rem'}}>
            Is this <strong>{subjectName || 'the subject'}</strong>?
          </div>
        </div>

        {/* Face crop */}
        <div style={{
          background:'var(--bg)', display:'flex', alignItems:'center',
          justifyContent:'center', minHeight:200, position:'relative'
        }}>
          {!loaded && (
            <div style={{position:'absolute', color:'var(--muted)', fontSize:'0.85rem'}}>
              <span className="spin">⟳</span> Loading face crop…
            </div>
          )}
          <img
            src={src}
            alt="Face crop"
            onLoad={() => setLoaded(true)}
            style={{
              maxWidth:'100%', maxHeight:280,
              display: loaded ? 'block' : 'none',
              borderRadius:4
            }}
          />
        </div>

        {/* Age estimate */}
        {age > 0 && (
          <div style={{
            textAlign:'center', padding:'0.5rem 0.75rem',
            background:'var(--bg3)', fontSize:'0.82rem', color:'var(--muted)'
          }}>
            AI estimates approximately <strong style={{color:'var(--accent2)'}}>~{age} years old</strong> in this photo
          </div>
        )}

        {/* Known year input */}
        <div style={{
          padding:'0.75rem 1.25rem',
          borderTop:'1px solid var(--border)',
          background:'var(--bg)',
        }}>
          <label style={{
            display:'block', fontSize:'0.78rem', color:'var(--muted)',
            marginBottom:'0.35rem', fontWeight:500
          }}>
            📅 Do you know when this photo was taken? <span style={{opacity:0.6}}>(optional)</span>
          </label>
          <div style={{display:'flex', gap:'0.5rem', alignItems:'center'}}>
            <input
              type="number"
              className="form-input"
              placeholder="e.g. 1985"
              min="1920" max="2026"
              value={knownYear}
              onChange={e => setKnownYear(e.target.value)}
              style={{width:'100px', fontSize:'0.9rem', textAlign:'center'}}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm() }}
              disabled={enrolling}
            />
            {estimatedAge !== null && estimatedAge >= 0 && (
              <span style={{fontSize:'0.78rem', color:'var(--accent2)'}}>
                → age {estimatedAge} in this photo
              </span>
            )}
            {!knownYear && (
              <span style={{fontSize:'0.75rem', color:'var(--muted)', fontStyle:'italic'}}>
                Helps calibrate age estimation
              </span>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div style={{display:'flex', gap:'0', borderTop:'1px solid var(--border)'}}>
          <button
            onClick={onCancel}
            disabled={enrolling}
            style={{
              flex:1, padding:'1rem', background:'transparent', border:'none',
              borderRight:'1px solid var(--border)', color: enrolling ? 'var(--border)' : 'var(--muted)',
              fontSize:'0.9rem', cursor: enrolling ? 'not-allowed' : 'pointer', fontFamily:'inherit',
              transition:'all 0.15s'
            }}
            onMouseEnter={e => { if (!enrolling) e.target.style.background = 'var(--bg3)' }}
            onMouseLeave={e => e.target.style.background = 'transparent'}
          >
            ✕ Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={enrolling}
            style={{
              flex:1, padding:'1rem', background: enrolling ? 'rgba(16,185,129,0.15)' : 'transparent',
              border:'none', color:'var(--green)', fontSize:'0.9rem', fontWeight:600,
              cursor: enrolling ? 'wait' : 'pointer', fontFamily:'inherit', transition:'all 0.15s'
            }}
            onMouseEnter={e => { if (!enrolling) e.target.style.background = 'rgba(16,185,129,0.1)' }}
            onMouseLeave={e => { if (!enrolling) e.target.style.background = 'transparent' }}
          >
            {enrolling
              ? <><span className="spin">⟳</span> Enrolling…</>
              : '✓ Yes, enroll'}
          </button>
        </div>
      </div>
    </div>
  )
}
