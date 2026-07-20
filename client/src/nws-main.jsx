import React from 'react';
import ReactDOM from 'react-dom/client';
import NWSApp from './components/NWSApp';
import 'leaflet/dist/leaflet.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NWSApp />
  </React.StrictMode>
);
