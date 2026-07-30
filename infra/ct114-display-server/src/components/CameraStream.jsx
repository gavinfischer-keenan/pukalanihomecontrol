import React, { useState, useEffect, useRef } from 'react';

const CameraStream = React.memo(({ frigateName }) => {
  const [ts, setTs] = useState(Date.now());
  const [useStream, setUseStream] = useState(false);
  const streamChecked = useRef(false);

  // Always start with snapshot polling — it's guaranteed to work
  useEffect(() => {
    const interval = setInterval(() => setTs(Date.now()), 2000);
    return () => clearInterval(interval);
  }, []);

  // Check once if go2rtc MJPEG stream is available, upgrade if so
  useEffect(() => {
    if (streamChecked.current) return;
    streamChecked.current = true;

    const img = new Image();
    const timeout = setTimeout(() => {
      img.src = ''; // Cancel
    }, 5000);

    img.onload = () => {
      clearTimeout(timeout);
      setUseStream(true);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      // Stay on snapshots
    };
    img.src = `/proxy/go2rtc/api/frame.jpeg?src=${frigateName}`;
  }, [frigateName]);

  if (!frigateName) return null;

  // MJPEG stream mode (smooth video)
  if (useStream) {
    return (
      <img
        src={`/proxy/go2rtc/api/stream.mjpeg?src=${frigateName}`}
        className="full-bleed-frame"
        style={{ objectFit: 'contain', background: '#000' }}
        onError={() => setUseStream(false)} // Fall back if stream drops
        alt={frigateName}
      />
    );
  }

  // Snapshot polling mode (reliable fallback)
  return (
    <img
      src={`/proxy/frigate/api/${frigateName}/latest.jpg?h=720&_t=${ts}`}
      className="full-bleed-frame"
      style={{ objectFit: 'contain', background: '#000' }}
      alt={frigateName}
    />
  );
});

export default CameraStream;
