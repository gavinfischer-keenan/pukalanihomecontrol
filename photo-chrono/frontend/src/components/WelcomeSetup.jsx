import { useState, useEffect } from 'react'

export default function WelcomeSetup({ rclone, onClose, onRefresh }) {
  const [tokenInput, setTokenInput] = useState('')
  const [savingAuth, setSavingAuth] = useState(false)
  const [mounting, setMounting] = useState(false)
  const [unmounting, setUnmounting] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [copiedUrl, setCopiedUrl] = useState(false)
  
  const [dynamicAuthUrl, setDynamicAuthUrl] = useState('')
  const [loadingAuthUrl, setLoadingAuthUrl] = useState(false)

  const fetchLiveAuthUrl = async () => {
    setLoadingAuthUrl(true)
    setError('')
    try {
      const res = await fetch('/api/rclone/auth-url')
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Failed to fetch Google Auth URL')
      setDynamicAuthUrl(d.auth_url)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingAuthUrl(false)
    }
  }

  useEffect(() => {
    if (!rclone?.has_gdrive) {
      fetchLiveAuthUrl()
    }
  }, [rclone?.has_gdrive])

  const handleSaveAuth = async (e) => {
    e.preventDefault()
    if (!tokenInput.trim()) return
    setError('')
    setSuccessMsg('')
    setSavingAuth(true)
    try {
      const res = await fetch('/api/rclone/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Authorization failed')
      setSuccessMsg('✓ Google Drive account connected successfully!')
      setTokenInput('')
      await onRefresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingAuth(false)
    }
  }

  const handleMount = async () => {
    setError('')
    setSuccessMsg('')
    setMounting(true)
    try {
      const res = await fetch('/api/rclone/mount', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Mount failed')
      setSuccessMsg('✓ Google Drive mounted at /mnt/gdrive')
      await onRefresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setMounting(false)
    }
  }

  const handleUnmount = async () => {
    setError('')
    setSuccessMsg('')
    setUnmounting(true)
    try {
      const res = await fetch('/api/rclone/unmount', { method: 'POST' })
      const d = await res.json()
      setSuccessMsg(d.mounted ? 'Drive still busy' : 'Drive unmounted.')
      await onRefresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setUnmounting(false)
    }
  }

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(true)
      setTimeout(() => setCopiedUrl(false), 2500)
    }).catch(() => {
      const el = document.getElementById('gdrive-live-auth-url-input')
      if (el) {
        el.select()
        document.execCommand('copy')
        setCopiedUrl(true)
        setTimeout(() => setCopiedUrl(false), 2500)
      }
    })
  }

  return (
    <div style={{
      position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',
      display:'flex',alignItems:'center',justifyContent:'center',
      zIndex:1000,padding:'1rem'
    }}>
      <div style={{
        background:'var(--bg2)',border:'1px solid var(--border)',
        borderRadius:'var(--radius)',width:'100%',maxWidth:720,
        maxHeight:'90vh',overflow:'auto',padding:'2rem'
      }} className="fade-in">

        <div className="flex items-center justify-between mb-2">
          <h2 style={{fontSize:'1.25rem',fontWeight:700}}>⚙ Connect Your Google Drive</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        {/* Live Status Indicators */}
        <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',margin:'1rem 0'}}>
          <StatusPill ok={rclone?.installed} label="System ready" />
          <StatusPill ok={rclone?.has_gdrive} label="Google account connected" />
          <StatusPill ok={rclone?.mounted} label="Drive mounted at /mnt/gdrive" />
        </div>

        {error && <div className="alert alert-error mb-2">⚠ {error}</div>}
        {successMsg && <div className="alert alert-success mb-2">{successMsg}</div>}

        {/* Step 1: Account Authentication */}
        <div className="card mb-2" style={{
          border: !rclone?.has_gdrive ? '2px solid var(--accent)' : '1px solid var(--border)',
          background: !rclone?.has_gdrive ? 'rgba(124,58,237,0.06)' : 'var(--bg3)'
        }}>
          <div className="card-title" style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
            <span>1️⃣</span> Sign in with Google
            {rclone?.has_gdrive && <span className="badge badge-green" style={{marginLeft:'auto'}}>✓ Connected</span>}
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:'1rem',marginTop:'0.5rem'}}>
            
            {/* Step A: Live Dynamic URL */}
            <div style={{background:'var(--bg)',padding:'0.85rem',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.4rem'}}>
                <label className="form-label" style={{fontSize:'0.82rem',fontWeight:600,margin:0}}>
                  1. Live Google Sign-in URL:
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={fetchLiveAuthUrl} disabled={loadingAuthUrl}>
                  {loadingAuthUrl ? '⟳ Refreshing…' : '⟳ Refresh Link'}
                </button>
              </div>

              {loadingAuthUrl ? (
                <div style={{padding:'0.5rem',fontSize:'0.8rem',color:'var(--muted)'}}>
                  <span className="spin">⟳</span> Generating live Google Sign-in link…
                </div>
              ) : dynamicAuthUrl ? (
                <>
                  <div style={{display:'flex',gap:'0.5rem',marginBottom:'0.6rem'}}>
                    <input
                      id="gdrive-live-auth-url-input"
                      readOnly
                      className="form-input"
                      value={dynamicAuthUrl}
                      style={{flex:1,fontSize:'0.75rem',fontFamily:'monospace',background:'var(--bg2)',color:'var(--accent2)'}}
                      onClick={e => e.target.select()}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => copyToClipboard(dynamicAuthUrl)}
                    >
                      {copiedUrl ? '✓ Copied!' : '📋 Copy URL'}
                    </button>
                  </div>

                  <div style={{fontSize:'0.78rem',color:'var(--muted)',lineHeight:1.4}}>
                    Copy this link, paste it into a new browser tab, and log into Google.
                  </div>
                </>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={fetchLiveAuthUrl}>
                  🔑 Click to Generate Google Sign-in Link
                </button>
              )}
            </div>

            {/* Step B: Form Input */}
            <form onSubmit={handleSaveAuth} style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
              <label className="form-label" style={{fontSize:'0.85rem',fontWeight:600}}>
                2. Paste Result / Address Bar URL here:
              </label>
              <div style={{display:'flex',gap:'0.5rem'}}>
                <input
                  className="form-input"
                  placeholder='Paste the 127.0.0.1 address bar URL or code here'
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  style={{flex:1,fontSize:'0.85rem',fontFamily:'monospace'}}
                />
                <button className="btn btn-success" type="submit" disabled={savingAuth || !tokenInput.trim()}>
                  {savingAuth ? <span className="spin">⟳</span> : 'Save Account'}
                </button>
              </div>

              <div style={{
                background:'rgba(245,158,11,0.1)',border:'1px solid rgba(245,158,11,0.2)',
                borderRadius:'var(--radius)',padding:'0.65rem 0.85rem',marginTop:'0.25rem',
                fontSize:'0.78rem',color:'#fcd34d',lineHeight:1.5
              }}>
                💡 <strong>Important Note:</strong> When Google finishes signing in, your browser will land on a page saying <em>"127.0.0.1 refused to connect"</em>. <strong>This is normal and expected!</strong><br />
                Simply copy the <strong>entire URL from your browser's address bar</strong> (e.g. <code>http://127.0.0.1:53682/?state=...&code=...</code>) and paste it into the box above. The app will extract your credentials automatically!
              </div>
            </form>

          </div>
        </div>

        {/* Step 2: Drive Mount */}
        <div className="card mb-2" style={{
          border: rclone?.has_gdrive && !rclone?.mounted ? '2px solid var(--green)' : '1px solid var(--border)',
          background: rclone?.has_gdrive && !rclone?.mounted ? 'rgba(16,185,129,0.06)' : 'var(--bg3)'
        }}>
          <div className="card-title" style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
            <span>2️⃣</span> Mount Google Drive (/mnt/gdrive)
            {rclone?.mounted && <span className="badge badge-green" style={{marginLeft:'auto'}}>✓ Mounted</span>}
          </div>
          <p className="text-muted" style={{fontSize:'0.82rem',marginBottom:'1rem',lineHeight:1.5}}>
            Mounts your Google Drive into the system filesystem so photos can be scanned and organized directly.
          </p>

          {!rclone?.mounted ? (
            <button
              className="btn btn-success"
              onClick={handleMount}
              disabled={mounting || !rclone?.has_gdrive}
              style={{width:'100%',justifyContent:'center',padding:'0.75rem',fontSize:'0.95rem'}}
            >
              {mounting ? <><span className="spin">⟳</span> Mounting Google Drive…</> : '🔌 Click to Mount Google Drive Now'}
            </button>
          ) : (
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'1rem'}}>
              <div className="alert alert-success" style={{flex:1,margin:0,fontSize:'0.85rem'}}>
                ✅ Drive active at <code>/mnt/gdrive</code>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handleUnmount} disabled={unmounting}>
                {unmounting ? 'Unmounting…' : 'Unmount'}
              </button>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1 mt-3" style={{justifyContent:'flex-end'}}>
          <button className="btn btn-ghost" onClick={onRefresh}>
            ⟳ Refresh Status
          </button>
          <button className="btn btn-primary" onClick={onClose} disabled={!rclone?.mounted}>
            {rclone?.mounted ? 'Done — Start Session →' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ ok, label }) {
  return (
    <span className={`badge ${ok ? 'badge-green' : 'badge-red'}`}>
      {ok ? '✓' : '✕'} {label}
    </span>
  )
}
