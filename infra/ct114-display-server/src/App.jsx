import { useEffect, useState } from 'react';
import './App.css';
import { useDisplayState } from './hooks/useDisplayState';
import DisplayView from './components/DisplayView';
import RemoteController from './components/RemoteController';

function App() {
  const [route, setRoute] = useState(window.location.hash || '#remote');
  const { state, config, cameras, connected, updateState } = useDisplayState();

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(window.location.hash || '#remote');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <div className="app-container">
      <div className={`connection-status ${connected ? 'status-connected' : 'status-disconnected'}`} title={connected ? 'Connected' : 'Disconnected'}></div>
      
      {route === '#maintv' && (
        <DisplayView 
          displayId="mainTv" 
          state={state} 
          config={config} 
        />
      )}
      
      {route === '#corner' && (
        <DisplayView 
          displayId="corner" 
          state={state} 
          config={config} 
        />
      )}
      
      {route === '#remote' && (
        <RemoteController 
          state={state} 
          config={config} 
          cameras={cameras} 
          updateState={updateState} 
        />
      )}
      
      {route === '' && (
        <RemoteController 
          state={state} 
          config={config} 
          cameras={cameras} 
          updateState={updateState} 
        />
      )}
    </div>
  );
}

export default App;
