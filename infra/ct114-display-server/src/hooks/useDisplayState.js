import { useState, useEffect, useCallback } from 'react';

export function useDisplayState() {
  const [state, setState] = useState(null);
  const [config, setConfig] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [connected, setConnected] = useState(false);
  const [alert, setAlert] = useState({ level: 'Clear', message: '', timestamp: Date.now() });

  // Fetch initial state via REST
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const [stateRes, configRes, camerasRes] = await Promise.all([
          fetch('/api/state').then(r => r.json()),
          fetch('/api/config').then(r => r.json()),
          fetch('/api/cameras').then(r => r.json())
        ]);
        setState(stateRes);
        setConfig(configRes);
        setCameras(camerasRes);
      } catch (err) {
        console.error('Failed to fetch initial data', err);
      }
    };
    fetchInitialData();
  }, []);

  // WebSocket connection
  useEffect(() => {
    let ws;
    let reconnectTimer;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state_update') {
            setState(msg.state);
          } else if (msg.type === 'config') {
            setConfig(msg.config);
          } else if (msg.type === 'alert_update') {
            setAlert(msg.alert);
          } else if (msg.type === 'reload' || msg.type === 'hard_reload') {
            // Force hard page reload to pick up new JS/CSS bundles
            console.log('[WS] Reload requested — refreshing page');
            window.location.reload(true);
          }
        } catch (e) {
          console.error('Failed to parse WS message', e);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting...');
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error', err);
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  const updateState = useCallback(async (newStatePartial) => {
    try {
      const mergedState = { ...state, ...newStatePartial };
      // Optimistic update
      setState(mergedState);
      
      await fetch('/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedState)
      });
    } catch (err) {
      console.error('Failed to update state', err);
    }
  }, [state]);

  return { state, config, cameras, connected, alert, updateState };
}
