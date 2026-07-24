import { useEffect, useRef, useState } from 'react';

export default function Filmstrip({ sessionId, photos, onPhotoClick }) {
  const scrollRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!scrollRef.current) return;
      if (e.key === 'ArrowLeft') {
        scrollRef.current.scrollBy({ left: -110, behavior: 'smooth' });
      } else if (e.key === 'ArrowRight') {
        scrollRef.current.scrollBy({ left: 110, behavior: 'smooth' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleScroll = () => {
    if (!scrollRef.current || !photos || photos.length === 0) return;
    const el = scrollRef.current;
    const scrollLeft = el.scrollLeft;
    // ~108px per item (100px + 8px gap)
    const index = Math.min(photos.length - 1, Math.floor((scrollLeft + 54) / 108));
    setActiveIndex(Math.max(0, index));
  };

  const activePhoto = photos && photos.length > 0 ? photos[activeIndex] : null;
  const activeYear = activePhoto ? (activePhoto.match_status === 'confirmed' ? `=${activePhoto.estimated_year}` : `~${activePhoto.estimated_year}`) : '';

  if (!photos || photos.length === 0) {
    return <div className="filmstrip-wrap text-muted text-center">No photos available.</div>;
  }

  return (
    <div className="filmstrip-wrap">
      <div className="filmstrip-indicator">
        {activePhoto && `Photo ${activeIndex + 1} of ${photos.length} · ${activeYear}`}
      </div>
      <div className="filmstrip-track" ref={scrollRef} onScroll={handleScroll}>
        {photos.map((p, idx) => {
          const yearLabel = p.match_status === 'confirmed' ? `=${p.estimated_year}` : `~${p.estimated_year}`;
          const statusClass = p.match_status === 'confirmed' ? 'confirmed' : (p.match_status === 'uncertain' || !p.match_status) ? 'uncertain' : '';
          return (
            <div key={p.id} className={`filmstrip-card ${statusClass}`} onClick={() => onPhotoClick && onPhotoClick(p)}>
              <div className="filmstrip-img">
                <img src={`/api/photo/${sessionId}/${p.id}?size=120`} alt="" loading="lazy" />
              </div>
              <div className="filmstrip-labels">
                <div className="fs-age">~{p.estimated_age}</div>
                <div className="fs-year">{yearLabel}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
