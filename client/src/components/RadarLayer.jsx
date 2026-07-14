import { useState, useEffect } from 'react';
import { TileLayer } from 'react-leaflet';

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';

// RainViewer color scheme — 6 = NOAA-style base reflectivity coloring
const COLOR_SCHEME = 6;
const SMOOTH = 1;
const SNOW_VIEW = 0;
const TILE_SIZE = 256;

export default function RadarLayer({ visible, opacity = 0.55 }) {
  const [frames,   setFrames]   = useState([]);
  const [frameIdx, setFrameIdx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [host, setHost] = useState('');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    const fetchFrames = async () => {
      try {
        const r = await fetch(RAINVIEWER_API);
        const data = await r.json();
        const radarFrames = [
          ...(data.radar?.past    || []),
          ...(data.radar?.nowcast || []),
        ];
        if (!cancelled && radarFrames.length > 0) {
          setHost(data.host || 'https://tilecache.rainviewer.com');
          setFrames(radarFrames);
          setFrameIdx(radarFrames.length - 1);
        }
      } catch (e) {
        console.warn('Radar fetch error:', e);
      }
    };

    fetchFrames();
    const t = setInterval(fetchFrames, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [visible]);

  // Animate through frames
  useEffect(() => {
    if (!animating || frames.length < 2) return;
    const t = setInterval(() => setFrameIdx(i => (i + 1) % frames.length), 600);
    return () => clearInterval(t);
  }, [animating, frames.length]);

  if (!visible || frames.length === 0 || !host) return null;

  const frame = frames[frameIdx];
  // RainViewer v2: /<host>/v2/radar/<path>/<size>/<z>/<x>/<y>/<colorScheme>/<options>.png
  // maxNativeZoom=8 with tileSize=256 means at zoom 9+ it stretches the z=8 tiles (no "Not Supported")
  const url = `${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_${SNOW_VIEW}.png`;

  return (
    <TileLayer
      key={frame.path}
      url={url}
      opacity={opacity}
      zIndex={500}
      attribution='<a href="https://www.rainviewer.com">RainViewer</a>'
      tileSize={TILE_SIZE}
      maxNativeZoom={6}
      minNativeZoom={0}
      minZoom={0}
      maxZoom={17}
      detectRetina={false}
    />
  );
}

// Exported control bar for use outside the map
export function RadarControls({ visible, frames, frameIdx, setFrameIdx, animating, setAnimating }) {
  if (!visible || frames.length === 0) return null;

  const frame = frames[frameIdx];
  const time  = frame ? new Date(frame.time * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Pacific/Honolulu'
  }) : '';

  return (
    <div className="radar-controls glass">
      <span className="radar-ctrl-label">🌧️ RADAR</span>
      <span className="radar-time">{time} HST</span>
      <input
        type="range"
        min={0}
        max={Math.max(frames.length - 1, 0)}
        value={frameIdx}
        onChange={e => { setAnimating(false); setFrameIdx(Number(e.target.value)); }}
        className="radar-scrub"
      />
      <button
        className={`radar-play-btn ${animating ? 'active' : ''}`}
        onClick={() => setAnimating(a => !a)}
        title={animating ? 'Pause' : 'Play loop'}
      >
        {animating ? '⏸' : '▶'}
      </button>
    </div>
  );
}
