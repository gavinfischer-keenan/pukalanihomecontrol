import { useState } from 'react';

export default function BridgeConnect({ onConnect }) {
  const [url, setUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [status, setStatus] = useState(null);

  const handleConnect = async () => {
    if (!url.trim()) return;
    let target = url.trim();
    if (!target.startsWith('http')) {
      target = `http://${target}`;
    }
    
    setConnecting(true);
    setStatus(null);
    try {
      const res = await fetch(target);
      if (!res.ok) throw new Error('Failed to connect');
      const data = await res.json();
      
      setStatus({ type: 'success', data });
      onConnect({ 
        url: target, 
        photoCount: data.photo_count || data.count || 0, 
        folderName: data.folder_name || data.folder || 'Photos' 
      });
    } catch (err) {
      setStatus({ type: 'error', message: 'Could not connect to bridge' });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">🌉 Local Bridge Connection</div>
      <div className="step">
        <div className="step-num">1</div>
        <div className="step-content">
          <h4>Download the Bridge</h4>
          <p>The bridge is a small app that lets Photo Chronologizer read photos directly from your computer.</p>
          <a href="#" className="btn btn-ghost btn-sm mt-1">Download Bridge</a>
        </div>
      </div>
      <div className="step">
        <div className="step-num">2</div>
        <div className="step-content">
          <h4>Run the Bridge</h4>
          <p>Run the downloaded app in the folder containing your photos. It will show a URL (like 192.168.1.8:9777).</p>
        </div>
      </div>
      <div className="step">
        <div className="step-num">3</div>
        <div className="step-content">
          <h4>Connect</h4>
          <div className="flex gap-1 mt-1">
            <input 
              className="form-input" 
              placeholder="e.g. 192.168.1.8:9777" 
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleConnect} disabled={connecting || !url.trim()}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
          {status?.type === 'error' && <div className="alert alert-error mt-2">{status.message}</div>}
          {status?.type === 'success' && (
            <div className="alert alert-success mt-2">
              Connected to <strong>{status.data.folder_name || status.data.folder || 'Photos'}</strong> 
              <span className="badge badge-green ml-2">{status.data.photo_count || status.data.count || 0} photos</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
