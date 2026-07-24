import { useState, useEffect, useCallback } from 'react'
import WelcomeSetup  from './components/WelcomeSetup.jsx'
import SessionSetup  from './components/SessionSetup.jsx'
import Enrollment    from './components/Enrollment.jsx'
import Processing    from './components/Processing.jsx'
import Review        from './components/Review.jsx'
import Export        from './components/Export.jsx'

const PHASES = [
  { id: 'setup',      label: '① Setup' },
  { id: 'enrolling',  label: '② Enrollment' },
  { id: 'processing', label: '③ Processing' },
  { id: 'reviewing',  label: '④ Review' },
  { id: 'exporting',  label: '⑤ Export' },
  { id: 'done',       label: '⑤ Export' },
]

export default function App() {
  const [rclone, setRclone]   = useState(null)
  const [showGuide, setShowGuide] = useState(false)
  const [sessions, setSessions]   = useState([])
  const [session, setSession]     = useState(null)   // active session object
  const [phase, setPhase]         = useState('home') // home | setup | <session status>

  // ── Load rclone status on mount ──────────────────────────────────────
  useEffect(() => {
    fetch('/api/rclone/status')
      .then(r => r.json())
      .then(d => {
        setRclone(d)
        if (!d.installed || !d.mounted) setShowGuide(true)
      })
      .catch(() => setRclone({ installed: false, mounted: false }))

    fetch('/api/sessions')
      .then(r => r.json())
      .then(setSessions)
      .catch(() => {})
  }, [])

  // Live-poll sessions while on home page (every 5s if any session is processing)
  useEffect(() => {
    if (phase !== 'home') return
    const hasActive = sessions.some(s => s.status === 'processing')
    const interval = hasActive ? 5000 : 30000  // 5s during processing, 30s idle
    const t = setInterval(() => {
      fetch('/api/sessions').then(r => r.json()).then(setSessions).catch(() => {})
    }, interval)
    return () => clearInterval(t)
  }, [phase, sessions])

  // ── Session helpers ──────────────────────────────────────────────────
  const refreshSession = useCallback((sid) => {
    if (!sid) return
    fetch(`/api/sessions/${sid}`)
      .then(r => r.json())
      .then(s => {
        setSession(s)
        setPhase(s.status)
      })
  }, [])

  const onSessionCreated = (s) => {
    setSession(s)
    setSessions(prev => [s, ...prev])
    setPhase('enrolling')
  }

  const openSession = (s) => {
    setSession(s)
    setPhase(s.status === 'done' ? 'exporting' : s.status)
  }

  const deleteSession = async (sid, e) => {
    e.stopPropagation()
    if (!confirm('Delete this session and all its data? This cannot be undone.')) return
    try {
      const res = await fetch(`/api/sessions/${sid}`, { method: 'DELETE' })
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sid))
        if (session?.id === sid) {
          setSession(null)
          setPhase('home')
        }
      }
    } catch {}
  }

  // ── Render ───────────────────────────────────────────────────────────
  const phaseLabel = PHASES.find(p => p.id === phase)?.label || ''

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>📷 Photo Chronologizer</h1>
          <div className="tagline">Pukalani Utilities · CT114</div>
        </div>
        <div className="header-spacer" />

        {session && (
          <div className="nav-pills">
            {PHASES.filter((p,i,a) => a.findIndex(x=>x.id===p.id)===i).map(p => (
              <button key={p.id}
                className={`nav-pill ${phase === p.id ? 'active' : ''}`}
                onClick={() => setPhase(p.id)}
                disabled={!session}
              >{p.label}</button>
            ))}
          </div>
        )}

        <div style={{display:'flex',gap:'0.5rem'}}>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSession(null); setPhase('home'); }}>
            All Sessions
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowGuide(true)}>
            ⚙ rclone Setup
          </button>
        </div>
      </header>

      {showGuide && (
        <WelcomeSetup
          rclone={rclone}
          onClose={() => setShowGuide(false)}
          onRefresh={() => fetch('/api/rclone/status').then(r=>r.json()).then(setRclone)}
        />
      )}

      <main className="main-content fade-in">

        {/* ── Home: session list ── */}
        {phase === 'home' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 style={{fontSize:'1.3rem',fontWeight:700}}>Sessions</h2>
              <button className="btn btn-primary" onClick={() => setPhase('setup')}>
                + New Session
              </button>
            </div>

            {!rclone?.mounted && (
              <div className="alert alert-warning">
                ⚠ Google Drive is not mounted. Photos can only be read from a locally accessible path.
                <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={() => setShowGuide(true)}>
                  Open Setup Guide →
                </button>
              </div>
            )}

            {sessions.length === 0 ? (
              <div className="card" style={{textAlign:'center',padding:'3rem'}}>
                <div style={{fontSize:'3rem',marginBottom:'1rem'}}>📸</div>
                <p style={{color:'var(--muted)',marginBottom:'1.5rem'}}>No sessions yet. Create one to get started.</p>
                <button className="btn btn-primary" onClick={() => setPhase('setup')}>+ New Session</button>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:'0.75rem'}}>
                {sessions.map(s => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onOpen={() => openSession(s)}
                    onDelete={(e) => deleteSession(s.id, e)}
                    onStartProcessing={(e) => {
                      e.stopPropagation()
                      // Fire-and-forget: server becomes CPU-bound during processing
                      // so we optimistically update the UI immediately
                      const ctrl = new AbortController()
                      setTimeout(() => ctrl.abort(), 3000) // 3s timeout
                      fetch(`/api/sessions/${s.id}/start`, { method: 'POST', signal: ctrl.signal })
                        .catch(() => {}) // ignore timeout/errors — server is busy processing
                      // Optimistically show processing state
                      setSessions(prev => prev.map(x =>
                        x.id === s.id ? {...x, status: 'processing'} : x
                      ))
                    }}
                    onContinue={(e) => { e.stopPropagation(); openSession(s) }}
                    onRestart={async (e) => {
                      e.stopPropagation()
                      if (!confirm(`Restart processing for "${s.name}"? This will re-scan all photos.`)) return
                      try {
                        // Reset to enrolling status, clear processed counts
                        await fetch(`/api/sessions/${s.id}/config`, {
                          method: 'PUT',
                          headers: {'Content-Type':'application/json'},
                          body: JSON.stringify({ single_face_auto_match: true })
                        })
                        openSession({...s, status: 'enrolling'})
                      } catch {}
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Session Setup ── */}
        {phase === 'setup' && (
          <SessionSetup
            rclone={rclone}
            onCreated={onSessionCreated}
            onBack={() => setPhase('home')}
          />
        )}

        {/* ── Enrollment ── */}
        {phase === 'enrolling' && session && (
          <Enrollment
            session={session}
            onReady={() => {
              setPhase('processing')
              // Refresh session data WITHOUT resetting phase
              fetch(`/api/sessions/${session.id}`)
                .then(r => r.json())
                .then(s => setSession(s))
            }}
          />
        )}

        {/* ── Processing ── */}
        {phase === 'processing' && session && (
          <Processing
            session={session}
            onDone={() => refreshSession(session.id)}
            onRefreshSession={() => refreshSession(session.id)}
          />
        )}

        {/* ── Review ── */}
        {phase === 'reviewing' && session && (
          <Review
            session={session}
            onDone={() => {
              setPhase('exporting')
              refreshSession(session.id)
            }}
          />
        )}

        {/* ── Export ── */}
        {(phase === 'exporting' || phase === 'done') && session && (
          <Export
            session={session}
            onDone={() => refreshSession(session.id)}
          />
        )}

      </main>
    </div>
  )
}

function statusColor(s) {
  return { setup:'blue', enrolling:'purple', processing:'gold', reviewing:'gold', exporting:'blue', done:'green' }[s] || 'muted'
}

function statusEmoji(s) {
  return { setup:'⚙️', enrolling:'👤', processing:'🔄', reviewing:'🔍', exporting:'📦', done:'✅' }[s] || '❓'
}

function statusLabel(s) {
  return { setup:'Setup', enrolling:'Enrolling Faces', processing:'Processing...', reviewing:'Needs Review', exporting:'Exporting', done:'Complete' }[s] || s
}

function SessionCard({ session: s, onOpen, onDelete, onStartProcessing, onContinue, onRestart }) {
  const pct = s.total_photos > 0 ? Math.round((s.processed_photos / s.total_photos) * 100) : 0
  const isProcessing = s.status === 'processing'
  const isDone = s.status === 'done'
  const isEnrolling = s.status === 'enrolling'
  const isReviewing = s.status === 'reviewing'

  return (
    <div className="card" style={{cursor:'pointer',position:'relative',overflow:'hidden'}} onClick={onOpen}>
      {/* Progress bar background for processing sessions */}
      {isProcessing && (
        <div style={{
          position:'absolute', top:0, left:0, bottom:0,
          width: `${pct}%`,
          background:'linear-gradient(90deg, rgba(245,158,11,0.08), rgba(245,158,11,0.04))',
          transition:'width 0.5s ease',
          zIndex:0,
        }} />
      )}

      <div style={{position:'relative', zIndex:1}}>
        {/* Row 1: Name + Status */}
        <div className="flex items-center justify-between">
          <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
            <span style={{fontSize:'1.2rem'}}>{statusEmoji(s.status)}</span>
            <div>
              <div style={{fontWeight:600,fontSize:'1.05rem'}}>{s.name}</div>
              <div className="text-muted" style={{fontSize:'0.8rem'}}>
                {s.subject_name || '—'} · Born {s.birth_year} · {s.total_photos} photos
              </div>
            </div>
          </div>
          <div className="flex gap-1" style={{alignItems:'center'}}>
            <span className={`badge badge-${statusColor(s.status)}`}>
              {statusLabel(s.status)}
            </span>
          </div>
        </div>

        {/* Row 2: Progress stats (if processing or beyond) */}
        {(s.processed_photos > 0 || isProcessing) && (
          <div style={{marginTop:'0.75rem'}}>
            <div style={{display:'flex', gap:'1.5rem', fontSize:'0.82rem', marginBottom:'0.4rem'}}>
              <span style={{color:'var(--blue)'}}>📊 {s.processed_photos}/{s.total_photos} scanned</span>
              <span style={{color:'var(--green)'}}>✅ {s.matched_photos} matched</span>
              {s.uncertain_photos > 0 && (
                <span style={{color:'var(--gold)'}}>❓ {s.uncertain_photos} uncertain</span>
              )}
              {isProcessing && (
                <span style={{color:'var(--accent2)',fontWeight:600}}>{pct}%</span>
              )}
            </div>
            {isProcessing && (
              <div className="progress-wrap" style={{height:'4px'}}>
                <div className="progress-bar" style={{width:`${pct}%`, transition:'width 0.5s ease'}} />
              </div>
            )}
          </div>
        )}

        {/* Row 3: Action buttons */}
        <div style={{marginTop:'0.75rem', display:'flex', gap:'0.5rem', alignItems:'center'}}>
          {/* Continue — always available */}
          <button
            className="btn btn-primary btn-sm"
            onClick={onContinue}
            style={{fontSize:'0.82rem',padding:'0.35rem 0.75rem'}}
          >
            {isProcessing ? '📊 View Progress' :
             isEnrolling ? '👤 Continue Enrollment' :
             isReviewing ? '🔍 Continue Review' :
             isDone ? '📦 View Export' :
             '→ Continue'}
          </button>

          {/* Start Processing — only when enrolling (ready to go) */}
          {isEnrolling && (
            <button
              className="btn btn-sm"
              onClick={onStartProcessing}
              style={{
                fontSize:'0.82rem', padding:'0.35rem 0.75rem',
                background:'rgba(16,185,129,0.15)', color:'#10b981',
                border:'1px solid rgba(16,185,129,0.3)',
                borderRadius:'var(--radius)',
              }}
            >
              ▶ Start Processing
            </button>
          )}

          {/* Restart — when processing or beyond */}
          {(isProcessing || isReviewing || isDone) && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={onRestart}
              style={{fontSize:'0.78rem',color:'var(--muted)'}}
            >
              ↻ Restart
            </button>
          )}

          <div style={{flex:1}} />

          {/* Source path */}
          <span style={{fontSize:'0.72rem',color:'var(--muted)',fontFamily:'monospace',maxWidth:'300px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {s.source_path}
          </span>

          {/* Delete */}
          <button
            className="btn btn-ghost btn-sm"
            onClick={onDelete}
            title="Delete this session"
            style={{
              color:'#f87171', padding:'0.25rem 0.5rem',
              fontSize:'0.75rem',
              border:'1px solid rgba(248,113,113,0.3)',
              borderRadius:'var(--radius)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.15)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            🗑
          </button>
        </div>
      </div>
    </div>
  )
}
