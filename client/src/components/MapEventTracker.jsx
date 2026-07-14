import { useEffect } from 'react';
import { useMapEvents } from 'react-leaflet';

export default function MapEventTracker({ onBoundsChange }) {
  const map = useMapEvents({
    moveend: () => {
      onBoundsChange(map.getBounds());
    },
    zoomend: () => {
      onBoundsChange(map.getBounds());
    }
  });

  // Initialize bounds on mount
  useEffect(() => {
    if (map) {
      onBoundsChange(map.getBounds());
    }
  }, [map, onBoundsChange]);

  return null;
}
