import { useState, useEffect } from 'react'

export default function FolderBrowser({ value, onChange, label = "Select Folder" }) {
  const [open, setOpen] = useState(false)
  const [currentPath, setCurrentPath] = useState('/mnt/gdrive')
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const browse = async (path) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error((await res.json()).detail || 'Browse failed')
      const data = await res.json()
      setListing(data)
      setCurrentPath(data.path)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) browse(currentPath)
  }, [open])

  const selectFolder = (path) => {
    onChange(path)
    setOpen(false)
  }

  // Navigate into a subfolder AND auto-update the input
  const navigateInto = (path) => {
    onChange(path)   // Update the form value immediately as user navigates
    browse(path)
  }

  const goUp = (parentPath) => {
    onChange(parentPath)
    browse(parentPath)
  }

  return (
    <div>
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          className="form-input"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="/mnt/gdrive/Your Photos"
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(!open)}
          style={{ whiteSpace: 'nowrap', minWidth: '90px' }}>
          {open ? '✕ Close' : '📂 Browse'}
        </button>
      </div>

      {open && (
        <div style={{
          marginTop: '0.5rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg)',
          maxHeight: '320px',
          overflow: 'auto',
        }}>
          {/* Header with path + stats */}
          <div style={{
            padding: '0.5rem 0.75rem',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg2)',
            fontSize: '0.78rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              {listing?.parent && (
                <button type="button" className="btn btn-ghost btn-sm"
                  style={{ padding: '0.15rem 0.4rem', fontSize: '0.78rem' }}
                  onClick={() => goUp(listing.parent)}>
                  ⬆ Up
                </button>
              )}
              <span style={{ color: 'var(--text)', fontWeight: 600, fontFamily: 'monospace' }}>
                {currentPath}
              </span>
            </div>
            {listing && listing.image_count > 0 && (
              <div style={{ marginTop: '0.35rem', color: '#10b981', fontWeight: 600, fontSize: '0.82rem' }}>
                📷 {listing.image_count} photos in this folder
              </div>
            )}
          </div>

          {loading && (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)' }}>
              <span className="spin">⟳</span> Reading folder from Google Drive…
            </div>
          )}

          {error && (
            <div style={{ padding: '0.5rem 0.75rem', color: '#f87171', fontSize: '0.82rem' }}>
              ⚠ {error}
            </div>
          )}

          {!loading && listing && (
            <>
              {/* Confirm selection button — always visible if there are images */}
              {listing.image_count > 0 && (
                <button type="button"
                  onClick={() => selectFolder(currentPath)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    background: 'rgba(16,185,129,0.15)',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    color: '#10b981',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}>
                  ✓ Select "{currentPath.split('/').pop()}" — {listing.image_count} photos
                </button>
              )}

              {/* Folder list */}
              {listing.folders.length > 0 && (
                <div style={{ 
                  padding: listing.image_count > 0 ? '0.25rem 0' : '0',
                  borderTop: listing.image_count > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none' 
                }}>
                  {listing.image_count > 0 && listing.folders.length > 0 && (
                    <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Or drill into a subfolder:
                    </div>
                  )}
                  {listing.folders.map(f => (
                    <button type="button" key={f.path}
                      onClick={() => navigateInto(f.path)}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        color: 'var(--text)',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span style={{ fontSize: '1.1rem' }}>📁</span>
                      <span style={{ flex: 1 }}>{f.name}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                        {f.image_count > 0 && `${f.image_count} photos`}
                        {f.image_count > 0 && f.subfolder_count > 0 && ' · '}
                        {f.subfolder_count > 0 && `${f.subfolder_count} folders`}
                      </span>
                      <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>→</span>
                    </button>
                  ))}
                </div>
              )}

              {listing.folders.length === 0 && listing.image_count === 0 && (
                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.82rem' }}>
                  This folder is empty.
                </div>
              )}

              {/* If no images but has subfolders, show a hint */}
              {listing.image_count === 0 && listing.folders.length > 0 && (
                <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: 'var(--muted)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
                  Navigate into a folder that contains photos to select it.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
