const fs = require('fs');

const serverFile = '/opt/display-server/server.js';
let serverCode = fs.readFileSync(serverFile, 'utf8');

if (!serverCode.includes('pollHAAlerts')) {
  const haLogic = `
// ── HA Alerts ──
let currentAlert = { level: 'Clear', message: '', timestamp: Date.now() };
let HA_TOKEN = '';
try {
  HA_TOKEN = require('fs').readFileSync('/opt/display-server/.ha_token', 'utf-8').trim();
} catch (e) {
  console.error('[HA] No .ha_token found', e.message);
}

async function pollHAAlerts() {
  if (!HA_TOKEN) return;
  try {
    const [levelRes, msgRes] = await Promise.all([
      fetch('http://192.168.1.19:8123/api/states/input_select.alert_level', { headers: { Authorization: \`Bearer \${HA_TOKEN}\` } }),
      fetch('http://192.168.1.19:8123/api/states/input_text.alert_message', { headers: { Authorization: \`Bearer \${HA_TOKEN}\` } })
    ]);
    const levelData = await levelRes.json();
    const msgData = await msgRes.json();

    const newLevel = levelData.state;
    const newMsg = msgData.state;
    
    if (newLevel !== currentAlert.level || newMsg !== currentAlert.message) {
      currentAlert = { level: newLevel, message: newMsg, timestamp: Date.now() };
      broadcastAlert();
    }
  } catch (err) {
    console.error('[HA] Error polling alerts:', err.message);
  }
}

function broadcastAlert() {
  const msg = JSON.stringify({ type: 'alert_update', alert: currentAlert });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

setInterval(pollHAAlerts, 10000);
pollHAAlerts();

app.get('/api/alerts', (req, res) => {
  res.json(currentAlert);
});

// ── SPA fallback ──`;
  serverCode = serverCode.replace('// ── SPA fallback ──', haLogic);
  
  const wsConnectHook = `ws.send(JSON.stringify({ type: 'config', config }));\n\n  // Send current alert immediately\n  ws.send(JSON.stringify({ type: 'alert_update', alert: currentAlert }));`;
  serverCode = serverCode.replace("ws.send(JSON.stringify({ type: 'config', config }));", wsConnectHook);

  fs.writeFileSync(serverFile, serverCode);
}

const hookFile = '/opt/display-server/src/hooks/useDisplayState.js';
let hookCode = fs.readFileSync(hookFile, 'utf8');
if (!hookCode.includes('alert')) {
  hookCode = hookCode.replace('const [connected, setConnected] = useState(false);', 'const [connected, setConnected] = useState(false);\n  const [alert, setAlert] = useState({ level: \'Clear\', message: \'\', timestamp: Date.now() });');
  hookCode = hookCode.replace("else if (msg.type === 'config') {\n            setConfig(msg.config);\n          }", "else if (msg.type === 'config') {\n            setConfig(msg.config);\n          } else if (msg.type === 'alert_update') {\n            setAlert(msg.alert);\n          }");
  hookCode = hookCode.replace('return { state, config, cameras, connected, updateState };', 'return { state, config, cameras, connected, alert, updateState };');
  fs.writeFileSync(hookFile, hookCode);
}

const displayFile = '/opt/display-server/src/components/DisplayView.jsx';
let displayCode = fs.readFileSync(displayFile, 'utf8');
if (!displayCode.includes('AlertOverlay')) {
  displayCode = displayCode.replace("import WeatherView from './WeatherView';", "import WeatherView from './WeatherView';\nimport AlertOverlay from './AlertOverlay';");
  displayCode = displayCode.replace("const DisplayView = React.memo(({ displayId, state, config }) => {", "const DisplayView = React.memo(({ displayId, state, config, alert }) => {");
  displayCode = displayCode.replace("<div className={`view-container layout-\${layoutMode}`}>", "<div className={`view-container layout-\${layoutMode}`}>\n      <AlertOverlay alert={alert} />");
  fs.writeFileSync(displayFile, displayCode);
}

const alertFile = '/opt/display-server/src/components/AlertOverlay.jsx';
const alertCode = `import React, { useState, useEffect } from 'react';

const AlertOverlay = ({ alert }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!alert || alert.level === 'Clear') {
      setVisible(false);
      return;
    }
    
    setVisible(true);

    if (alert.level === 'Soon') {
      const timer = setTimeout(() => setVisible(false), 30 * 60 * 1000);
      return () => clearTimeout(timer);
    } else if (alert.level === 'Information') {
      const timer = setTimeout(() => setVisible(false), 10 * 60 * 1000);
      return () => clearTimeout(timer);
    }
  }, [alert]);

  if (!visible || !alert || alert.level === 'Clear') return null;

  let style = {};
  let icon = '⚠️';
  
  if (alert.level === 'SEVERE') {
    style = { backgroundColor: '#ff0000', color: 'white', animation: 'pulse 2s infinite' };
    icon = '🚨';
  } else if (alert.level === 'Soon') {
    style = { backgroundColor: '#ff9900', color: '#333' };
    icon = '⏳';
  } else if (alert.level === 'Information') {
    style = { backgroundColor: '#0066ff', color: 'white' };
    icon = 'ℹ️';
  }

  const date = new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '80px',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 20px',
      boxSizing: 'border-box',
      fontWeight: 'bold',
      fontSize: '24px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
      ...style
    }}>
      <style>{\`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0.7); }
          70% { box-shadow: 0 0 0 20px rgba(255, 0, 0, 0); }
          100% { box-shadow: 0 0 0 0 rgba(255, 0, 0, 0); }
        }
      \`}</style>
      <span style={{ marginRight: '15px', fontSize: '32px' }}>{icon}</span>
      <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alert.message}</span>
      <span style={{ fontSize: '18px', opacity: 0.8 }}>{date}</span>
    </div>
  );
};

export default AlertOverlay;
`;
fs.writeFileSync(alertFile, alertCode);
console.log("Patched successfully");
