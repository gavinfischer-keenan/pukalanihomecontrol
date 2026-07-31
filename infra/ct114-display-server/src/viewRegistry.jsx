/**
 * viewRegistry.jsx — Single source of truth for view ID → React component mapping.
 * Used by DisplayView, CycleView, and RemoteController.
 * Adding a new view: add one import + one entry in viewComponentMap. That's it.
 */
import React from 'react';
import CameraGrid from './components/CameraGrid';
import VesselView from './components/VesselView';
import WeatherView from './components/WeatherView';
import CurrentWeatherView from './components/CurrentWeatherView';

// Black screen — default for any unset/new display slot
const BlackScreen = () => (
  <div style={{ width: '100%', height: '100%', background: '#000' }} aria-label="Black screen" />
);

const HouseStatusPlaceholder = () => (
  <div className="placeholder-view">🏠 House Status — Coming Soon</div>
);

const viewComponentMap = {
  black:           BlackScreen,
  cams:            CameraGrid,
  vessels:         VesselView,
  weather:         WeatherView,
  current_weather: CurrentWeatherView,
  house_status:    HouseStatusPlaceholder,
};

export default viewComponentMap;
