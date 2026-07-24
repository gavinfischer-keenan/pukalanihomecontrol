import { useState, useEffect, useRef } from 'react'

export default function Processing({ session, onDone, onRefreshSession }) {
  const [started, setStarted]   = useState(session.status === 'processing')
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState('')
  const [stats, setStats]       = useState({ processed:0, matched:0, uncertain:0, pct:0 })
  const [log, setLog]           = useState([])
  const [startErr, setStartErr] = useState('')
  const [warmup, setWarmup]     = useState(false)
  const [warmupMsg, setWarmupMsg] = useState('')
  const [startTime, setStartTime] = useState(null)
  const [eta, setEta]           = useState(null)
  const logRef = useRef(null)
  const esRef  = useRef(null)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  // If already processing (page reload or status updated), reconnect to SSE
  useEffect(() => {
    if (session.status === 'processing') {
      setStarted(true)
      startSSE()
    }
    return () => esRef.current?.close()
  }, [session.status])

  const handleStart = async () => {
    setStartErr('')
    setWarmup(true)
    try {
      const res = await fetch(`/api/sessions/${session.id}/start`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || JSON.stringify(d))
      setStarted(true)
      setStartTime(Date.now())
      startSSE()
      // Also tell the parent to refresh session state so status='processing'
      if (onRefreshSession) onRefreshSession()
    } catch (err) {
      setStartErr(err.message)
      setWarmup(false)
    }
  }

  const startSSE = () => {
    const es = new EventSource(`/api/sessions/${session.id}/progress`)
    esRef.current = es
    setStarted(true)
    if (!startTime) setStartTime(Date.now())

    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'warmup') {
        setWarmup(true)
        setWarmupMsg(msg.msg)
      }
      if (msg.type === 'progress') {
        setWarmup(false)  // First result = warm-up done
        setStats({ processed: msg.processed, total: msg.total, pct: msg.pct,
                   matched: 0, uncertain: 0 })

        // Calculate ETA
        if (startTime && msg.processed > 2) {
          const elapsed = (Date.now() - startTime) / 1000
          const rate = msg.processed / elapsed  // photos per second
          const remaining = msg.total - msg.processed
          const etaSecs = remaining / rate
          if (etaSecs < 3600) {
            const mins = Math.floor(etaSecs / 60)
            const secs = Math.floor(etaSecs % 60)
            setEta(mins > 0 ? `~${mins}m ${secs}s remaining` : `~${secs}s remaining`)
          }
        }

        const icon = msg.match_status === 'matched' ? (msg.auto ? '★' : '✓') :
                     msg.match_status === 'uncertain' ? '?' : '·'
        const faces = msg.faces > 1 ? ` [${msg.faces} faces]` : msg.faces === 1 ? ' [solo]' : ''
        const autoTag = msg.auto ? ' (auto: single face)' : ''
        setLog(l => [...l.slice(-199), { type: msg.match_status, text:
          `[${msg.pct.toFixed(1)}%] ${icon} ${msg.file}${msg.age > 0 ? ` (age ~${msg.age})` : ''}${faces}${autoTag}` }])
      }
      if (msg.type === 'done') {
        setDone(true)
        setEta(null)
        es.close()
        onDone()
      }
      if (msg.type === 'error') {
        setError(msg.msg)
        setWarmup(false)
        es.close()
      }
    }
    es.onerror = () => {
      if (!done) setError('Connection lost. Refresh to check status.')
      es.close()
    }
  }

  const getWarmupMessage = () => {
    if (!warmup) return null
    const secs = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
    if (secs < 3) return 'Starting up…'
    if (secs < 8) return 'Loading AI face recognition model into memory — first time takes ~10 seconds…'
    if (secs < 15) return 'AI model loading — building face embeddings and reference vectors…'
    if (secs < 25) return 'Almost ready — initializing face comparison engine…'
    return 'Still loading — this is normal for the first run after a restart…'
  }

  // Update warmup message periodically
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (warmup) {
      const t = setInterval(() => setTick(n => n + 1), 2000)
      return () => clearInterval(t)
    }
  }, [warmup])

  return (
    <div className="fade-in">
      <h2 style={{fontSize:'1.2rem',fontWeight:700,marginBottom:'0.25rem'}}>③ Processing Photos</h2>
      <p className="text-muted" style={{marginBottom:'1.5rem'}}>
        The AI will scan every photo and find {session.subject_name || 'the subject'}.
        This runs in the background — you can leave this page open and come back.
        Large collections (1000+ photos) may take 10–30 minutes.
      </p>

      {!started && session.status !== 'processing' && (
        <div className="card mb-2" style={{textAlign:'center',padding:'2rem'}}>
          <div style={{fontSize:'3rem',marginBottom:'1rem'}}>🔍</div>
          <p style={{color:'var(--muted)',marginBottom:'1.5rem'}}>
            Ready to scan <strong>{session.total_photos?.toLocaleString()}</strong> photos.
            Click Start when ready — this will use all available CPU.
          </p>
          {startErr && <div className="alert alert-error mb-2">⚠ {startErr}</div>}
          <button className="btn btn-primary" onClick={handleStart}>
            ▶ Start Processing
          </button>
        </div>
      )}

      {(started || session.status === 'processing') && (
        <>
          <div className="stats-strip">
            <StatCard val={stats.total || session.total_photos || '—'} label="Total Photos" color="blue" />
            <StatCard val={stats.processed || session.processed_photos || 0} label="Scanned" color="gold" />
            <StatCard val={session.matched_photos || '—'} label="Matched" color="green" />
            <StatCard val={session.uncertain_photos || '—'} label="Needs Review" color="purple" />
          </div>

          <div className="card mb-2">
            <div className="flex items-center justify-between mb-2">
              <div style={{fontWeight:600}}>
                {done ? '✅ Complete!' :
                 warmup ? <><span className="spin">⟳</span> Warming up AI engine…</> :
                 <><span className="spin">⟳</span> Scanning…</>}
              </div>
              <div style={{display:'flex', gap:'1rem', alignItems:'center'}}>
                {eta && !done && (
                  <span style={{fontSize:'0.78rem',color:'var(--accent2)'}}>{eta}</span>
                )}
                <span className="text-muted">{(stats.pct || 0).toFixed(1)}%</span>
              </div>
            </div>
            <div className="progress-wrap">
              <div className="progress-bar" style={{width: `${stats.pct || 0}%`}} />
            </div>
            <div className="text-muted mt-1" style={{fontSize:'0.78rem'}}>
              {stats.processed?.toLocaleString() || 0} of {stats.total?.toLocaleString() || '?'} photos processed
            </div>
          </div>

          {/* Warm-up info card */}
          {warmup && (
            <div className="card mb-2" style={{borderColor:'var(--accent)',background:'rgba(124,58,237,0.05)'}}>
              <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
                <div style={{fontSize:'1.5rem'}}>🧠</div>
                <div>
                  <div style={{fontWeight:600,marginBottom:'0.25rem'}}>AI Engine Warming Up</div>
                  <div className="text-muted" style={{fontSize:'0.82rem'}}>
                    {warmupMsg || getWarmupMessage()}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="card mb-2">
            <div className="card-title">📋 Processing Log</div>
            <div className="log-feed" ref={logRef}>
              {log.length === 0 && warmup && (
                <div className="log-line info">Loading AI model — first photo coming soon…</div>
              )}
              {log.length === 0 && !warmup && started && (
                <div className="log-line info">Waiting for first results…</div>
              )}
              {log.map((l, i) => (
                <div key={i} className={`log-line ${l.type || ''}`}>{l.text}</div>
              ))}
              {done && <div className="log-line info">✅ Processing complete. Moving to review phase…</div>}
            </div>
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          {done && (
            <div className="alert alert-success">
              ✅ Processing complete! Found {session.matched_photos} definite matches and {session.uncertain_photos} that need your review.
              <button className="btn btn-success btn-sm" style={{marginLeft:'auto'}} onClick={onDone}>
                → Go to Review
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ val, label, color }) {
  const colors = { blue:'#3b82f6', gold:'#f59e0b', green:'#10b981', purple:'#a855f7' }
  return (
    <div className="stat-card">
      <div className="stat-val" style={{color: colors[color]}}>{typeof val === 'number' ? val.toLocaleString() : val}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
