import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './Shrinker.css';

export default function Shrinker() {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [level, setLevel] = useState('standard');
  const [status, setStatus] = useState('');
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef(null);

  const levels = [
    { id: 'light', emoji: '🟢', title: 'Light', desc: 'Non-destructive — lossless compression only', color: 'var(--accent-green)' },
    { id: 'standard', emoji: '🟡', title: 'Standard', desc: '150 DPI · JPEG 75% — good balance', color: 'var(--accent-orange)' },
    { id: 'aggressive', emoji: '🟠', title: 'Aggressive', desc: '96 DPI · JPEG 50% — maximum compression', color: 'var(--accent-red)' },
    { id: 'grayscale', emoji: '⬜', title: 'Grayscale', desc: '120 DPI · B&W — converts to grayscale', color: '#e6edf3' },
  ];

  const onDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };
  
  const handleCompress = async () => {
    if (!file) {
      setIsError(true);
      setStatus('Please select a PDF file first.');
      return;
    }
    
    setLoading(true);
    setStatus('Compressing...');
    setIsError(false);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('level', level);
    
    try {
      const res = await fetch('/api/shrinker/compress', {
        method: 'POST',
        body: formData,
      });
      
      if (!res.ok) {
        throw new Error('Compression failed on the server.');
      }
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name.replace('.pdf', `_compressed_${level}.pdf`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      
      setStatus('Compression successful! Download started.');
    } catch (err) {
      setIsError(true);
      setStatus(err.message || 'An error occurred.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="shrinker-container">
      <div className="shrinker-header">
        <button className="back-btn" onClick={() => navigate('/tools')}>
          &larr; Back to Tools
        </button>
        <h1>PDF Shrinker</h1>
      </div>
      
      <div className="shrinker-content">
        <div 
          className={`drop-zone ${isDragging ? 'drag-active' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          {file ? (
            <div className="file-info">📄 {file.name}</div>
          ) : (
            <div className="drop-prompt">Drag & Drop a PDF here or click to browse</div>
          )}
        </div>
        <input 
          type="file" 
          accept=".pdf" 
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files[0])}
        />
        
        <div className="levels-grid">
          {levels.map(l => (
            <div 
              key={l.id}
              className={`level-card ${level === l.id ? 'active' : ''}`}
              onClick={() => setLevel(l.id)}
              style={{ '--level-color': l.color }}
            >
              <div className="level-emoji">{l.emoji}</div>
              <h3>{l.title}</h3>
              <p>{l.desc}</p>
            </div>
          ))}
        </div>
        
        <button 
          className="compress-btn" 
          onClick={handleCompress}
          disabled={loading || !file}
        >
          {loading ? 'Compressing...' : 'Compress & Download'}
        </button>
        
        {status && (
          <div className={`status-text ${isError ? 'error' : 'success'}`}>
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
