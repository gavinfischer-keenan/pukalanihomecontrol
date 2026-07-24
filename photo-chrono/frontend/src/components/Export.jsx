import { useState, useEffect, useRef } from 'react'
import StripViewer from './StripViewer.jsx'

export default function Export({ session, onDone }) {
  const [bias, setBias]         = useState(0)
  const [preview, setPreview]   = useState(null)
  const [exporting, setExporting] = useState(false)
  const [done, setDone]         = useState(false)
  const [progress, setProgress] = useState({ copied:0, total:0, pct:0 })
  const [log, setLog]           = useState([])
  const [error, setError]       = useState('')
  const esRef  = useRef(null)
  const logRef = useRef(null)

  useEffect(() => { loadPreview(0) }, [])
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])
  useEffect(() => { return () => esRef.current?.close() }, [])

  const loadPreview = async (b) => {
    try {
      const r = await fetch(`/api/sessions/${session.id}/export/preview?age_bias=${b}`)
      const d = await r.json()
      setPreview(d)
    } catch {}
  }

  const handleBiasChange = (v) => { setBias(v); loadPreview(v) }

  const handleExport = async () => {
    setError('')
    setExporting(true)
    setLog([])
    setProgress({ copied:0, total: preview?.count || 0, pct:0 })
    try {
      const res = await fetch(`/api/sessions/${session.id}/export`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ age_bias: bias }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Export failed')
      const es = new EventSource(`/api/sessions/${session.id}/progress`)
      esRef.current = es
      es.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.type === 'export_progress') {
          setProgress({ copied: msg.copied, total: msg.total, pct: msg.pct })
          setLog(l => [...l.slice(-99), `✓ ${msg.file}`])
        }
        if (msg.type === 'export_error') setLog(l => [...l.slice(-99), `✕ ${msg.file}: ${msg.msg}`])
        if (msg.type === 'done') {
          setDone(true); setExporting(false); es.close(); onDone()
        }
      }
      es.onerror = () => { es.close(); if (!done) setError('Connection lost during export.') }
    } catch (err) { setError(err.message); setExporting(false) }
  }

  const totalMatched = preview?.count || session.matched_photos || 0
  const lockedCount  = preview?.preview?.filter(p => p.date_locked).length || 0

  return (
    <div className="fade-in">
      <h2 style={{fontSize:'1.2rem',fontWeight:700,marginBottom:'0.25rem'}}>⑤ Export & Rename</h2>
      <p className="text-muted" style={{marginBottom:'1.5rem'}}>
        Use the Strip Viewer below to make any final date/age corrections before exporting.
        Files will be copied (not moved) to: <code style={{color:'#a5d6ff'}}>{session.output_path}</code>
      </p>

      <div className="stats-strip mb-2">
        <div className="stat-card">
          <div className="stat-val" style={{color:'var(--green)'}}>{totalMatched.toLocaleString()}</div>
          <div className="stat-label">Photos to Export</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{color:'var(--gold)'}}>{lockedCount}</div>
          <div className="stat-label">🔒 Date-locked by You</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{color:'var(--blue)'}}>{bias > 0 ? `+${bias}` : bias}</div>
          <div className="stat-label">Age Bias</div>
        </div>
        <div className="stat-card">
          <div className="stat-val" style={{color:'var(--accent2)'}}>
            {session.birth_year}–{session.birth_year + 65}
          </div>
          <div className="stat-label">Est. Year Range</div>
        </div>
      </div>

      {/* Bias slider */}
      <div className="card mb-2">
        <div className="card-title">🎚 Global Age Bias</div>
        <p className="text-muted" style={{fontSize:'0.82rem',marginBottom:'1rem'}}>
          Applies to AI-estimated ages only. Date-locked photos ({lockedCount}) are unaffected.
        </p>
        <div className="slider-wrap">
          <input type="range" className="age-slider" min="-10" max="10" step="1"
            value={bias} onChange={e => handleBiasChange(parseInt(e.target.value))} />
          <div className="slider-labels">
            <span>−10 yr</span>
            <span style={{fontWeight:700,color:'var(--accent2)'}}>{bias > 0 ? `+${bias}` : bias} years</span>
            <span>+10 yr</span>
          </div>
        </div>
      </div>

      {/* Filename preview */}
      <div className="card mb-2">
        <div className="card-title">
          📋 Filename Preview
          <span className="badge badge-muted" style={{marginLeft:'auto'}}>{preview?.count || '—'} files</span>
        </div>
        <p className="text-muted" style={{fontSize:'0.78rem',marginBottom:'0.75rem'}}>
          Format: <code style={{color:'#a5d6ff'}}>age_year_originalname.ext</code> · Alphabetical = chronological
        </p>
        <div className="export-list">
          {preview?.preview?.length === 0 && (
            <div style={{padding:'1rem',textAlign:'center',color:'var(--muted)'}}>No matched photos yet</div>
          )}
          {preview?.preview?.map(p => (
            <div key={p.id} className="export-row">
              <div className="export-age">{p.age != null ? `${p.age}yr` : '?'}</div>
              <div className="export-orig" title={p.original}>
                {p.original?.split('/').pop()}
                {p.date_locked && <span className="badge badge-gold" style={{marginLeft:'0.3rem',fontSize:'0.6rem'}}>🔒</span>}
              </div>
              <div className="export-new" title={p.output}>{p.output}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Export action */}
      {!exporting && !done && (
        <div className="card mb-2">
          <div className="card-title">🚀 Ready to Export</div>
          <div className="alert alert-warning mb-2">
            ⚠ Copies {totalMatched} photos to <code>{session.output_path}</code>.
            If output is on Google Drive this uploads over the network.
          </div>
          {error && <div className="alert alert-error mb-2">{error}</div>}
          <button className="btn btn-success" onClick={handleExport}>
            📤 Export {totalMatched.toLocaleString()} Photos
          </button>
        </div>
      )}

      {exporting && (
        <div className="card mb-2">
          <div className="flex items-center justify-between mb-2">
            <span style={{fontWeight:600}}><span className="spin">⟳</span> Exporting…</span>
            <span className="text-muted">{progress.pct.toFixed(1)}%</span>
          </div>
          <div className="progress-wrap mb-2">
            <div className="progress-bar" style={{width:`${progress.pct}%`}} />
          </div>
          <div className="log-feed" ref={logRef}>
            {log.map((l,i) => <div key={i} className="log-line match">{l}</div>)}
          </div>
        </div>
      )}

      {done && (
        <div className="alert alert-success">
          🎉 Done! {progress.copied} photos exported to <code>{session.output_path}</code>.
          Files sort alphabetically = chronological order in any file browser or playlist.
        </div>
      )}

      {/* Strip Viewer — collapsed by default, full corrections here */}
      <StripViewer
        sessionId={session.id}
        session={session}
        centerPhotoId={preview?.preview?.[0]?.id}
        onValidated={() => loadPreview(bias)}
      />
    </div>
  )
}
