import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Landing.css';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing-container">
      <div className="landing-header">
        <a href="http://192.168.1.108" className="back-button">
          &larr; Back to Dashboard
        </a>
        <div className="title-group">
          <h1>🏠 Pukalani Utilities</h1>
          <p className="subtitle">Home automation helper tools</p>
        </div>
      </div>
      
      <div className="cards-grid">
        <div className="tool-card blue-card" onClick={() => navigate('/tools/pdfmaker')}>
          <div className="card-emoji">📄</div>
          <h2>PDF Maker</h2>
          <p>Merge images, text, and other documents into a single optimized PDF.</p>
        </div>

        <div className="tool-card green-card" onClick={() => navigate('/tools/shrinker')}>
          <div className="card-emoji">📉</div>
          <h2>PDF Shrinker</h2>
          <p>Compress your large PDF files to save space without losing too much quality.</p>
        </div>
      </div>
    </div>
  );
}
