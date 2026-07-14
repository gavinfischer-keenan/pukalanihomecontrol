import { useState, useRef } from 'react';

export default function useDraggable(id, initialPosition, baseZIndex = 1200) {
  const [pos, setPos] = useState(() => {
    const saved = localStorage.getItem(`drag_pos_${id}`);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return initialPosition;
  });

  const [isDragging, setIsDragging] = useState(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = (e) => {
    // Left click only
    if (e.button !== undefined && e.button !== 0) return;
    
    // Ignore if clicking on interactive elements
    const tag = e.target.tagName;
    if (['BUTTON', 'INPUT', 'LABEL', 'A', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (e.target.closest('button') || e.target.closest('input')) return;

    setIsDragging(true);
    offset.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y
    };
    e.target.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    setPos({
      x: e.clientX - offset.current.x,
      y: e.clientY - offset.current.y
    });
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.target.releasePointerCapture(e.pointerId);
    localStorage.setItem(`drag_pos_${id}`, JSON.stringify(pos));
  };

  return {
    style: {
      position: 'absolute',
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      cursor: isDragging ? 'grabbing' : 'grab',
      touchAction: 'none',
      zIndex: isDragging ? 1500 : baseZIndex
    },
    onPointerDown,
    onPointerMove,
    onPointerUp
  };
}
