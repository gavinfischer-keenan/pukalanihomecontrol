/**
 * viewRegistry.js — Single source of truth for view ID → React component mapping.
 * Used by DisplayView, CycleView, and RemoteController.
 * Adding a new view = add one import + one entry here.
 */
import React from 'react';
import CameraGrid from './components/CameraGrid';
import VesselView from './components/VesselView';
import WeatherView from './components/WeatherView';

const HouseStatusPlaceholder = () => (
  <div className="placeholder-view">🏠 House Status — Coming Soon</div>
);

const viewComponentMap = {
  cams: CameraGrid,
  vessels: VesselView,
  weather: WeatherView,
  house_status: HouseStatusPlaceholder,
};

export default viewComponentMap;
