import React from 'react';

export default function HDRadioStatusPanel({ health, visible }) {
  if (!visible) return null;
  const counts = health?.counts || {};
  const uptime = health?.uptime ? Math.round(health.uptime / 60) : '–';

  const rows = [
    ['🚗 Traffic',  counts.traffic  ?? 0],
    ['⛽ Gas',      counts.gas      ?? 0],
    ['🌤️ Weather',  counts.weather  ?? 0],
    ['🚨 EAS',      counts.eas      ?? 0],
    ['📍 POI',      counts.poi      ?? 0],
    ['📰 News',     counts.news     ?? 0],
    ['🏆 Sports',   counts.sports   ?? 0],
    ['📁 LOT Files',counts.lots     ?? 0],
  ];

  return (
    <div style={{
      position:'absolute', bottom:'80px', right:'10px', zIndex:1000,
      background:'rgba(15,23,42,0.92)', border:'1px solid rgba(99,179,237,0.4)',
      borderRadius:'10px', padding:'12px 16px', minWidth:'180px',
      backdropFilter:'blur(8px)', color:'#e2e8f0', fontSize:'13px',
      boxShadow:'0 4px 20px rgba(0,0,0,0.6)',
    }}>
      <div style={{fontWeight:700,marginBottom:'8px',color:'#60a5fa',letterSpacing:'0.05em'}}>
        📻 HD Radio
      </div>
      {rows.map(([label, count]) => (
        <div key={label} style={{display:'flex',justifyContent:'space-between',gap:'16px',padding:'2px 0'}}>
          <span style={{color:'#94a3b8'}}>{label}</span>
          <span style={{fontWeight:count > 0 ? 700 : 400, color: count > 0 ? '#4ade80' : '#475569'}}>{count}</span>
        </div>
      ))}
      <div style={{borderTop:'1px solid rgba(255,255,255,0.1)',marginTop:'8px',paddingTop:'6px',color:'#64748b',fontSize:'11px'}}>
        Uptime {uptime}m
      </div>
    </div>
  );
}
