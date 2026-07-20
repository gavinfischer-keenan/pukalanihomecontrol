import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './PDFMaker.css';

// Sortable Item Component
function SortableItem({ page, index, isSelected, onClick }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: page.file_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const typeColors = {
    image: 'var(--accent-blue)',
    text: 'var(--accent-green)',
    '3d': 'var(--accent-purple)',
    pdf: 'var(--accent-red)',
    word: 'var(--accent-orange)',
  };

  const borderColor = typeColors[page.source_type] || 'var(--border)';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`sortable-item ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="drag-handle" {...attributes} {...listeners}>
        ⋮⋮
      </div>
      <div className="item-content" style={{ borderLeftColor: borderColor }}>
        <span className="item-name">{page.display_name}</span>
        {page.warnings && page.warnings.length > 0 && <span className="warning-icon">⚠️</span>}
      </div>
    </div>
  );
}

export default function PDFMaker() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(localStorage.getItem('pdfmaker_session') || '');
  const [pages, setPages] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pageNums, setPageNums] = useState(false);
  const [optimize, setOptimize] = useState(false);
  const fileInputRef = useRef(null);
  const previewDebounceRef = useRef(null);

  const pageNumSettings = {
    position: 'bottom-center',
    alignment: 'center',
    font: 'Helvetica',
    font_size: 10,
    style: 'Page {n} of {t}',
    color: '#000000'
  };

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (!sessionId) {
      const newId = crypto.randomUUID();
      setSessionId(newId);
      localStorage.setItem('pdfmaker_session', newId);
    }
  }, [sessionId]);

  const fetchPreview = useCallback(async (page, pSettings) => {
    if (!page || !sessionId) return;
    setPreviewLoading(true);
    try {
      const res = await fetch('/api/pdfmaker/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          page: page,
          zoom: 1.5,
          page_number_settings: pageNums ? pSettings : null
        })
      });
      if (!res.ok) throw new Error('Preview failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (err) {
      console.error(err);
      setStatus('Preview error');
    } finally {
      setPreviewLoading(false);
    }
  }, [sessionId, pageNums]);

  // Debounced preview
  useEffect(() => {
    if (selectedIdx >= 0 && pages[selectedIdx]) {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = setTimeout(() => {
        fetchPreview(pages[selectedIdx], pageNumSettings);
      }, 300);
    } else {
      setPreviewUrl(null);
    }
    return () => clearTimeout(previewDebounceRef.current);
  }, [pages, selectedIdx, fetchPreview]); 

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (active.id !== over.id) {
      setPages((items) => {
        const oldIndex = items.findIndex(i => i.file_id === active.id);
        const newIndex = items.findIndex(i => i.file_id === over.id);
        const newPages = arrayMove(items, oldIndex, newIndex);
        
        // Update selectedIdx if needed
        if (selectedIdx === oldIndex) {
          setSelectedIdx(newIndex);
        } else if (selectedIdx > oldIndex && selectedIdx <= newIndex) {
          setSelectedIdx(selectedIdx - 1);
        } else if (selectedIdx < oldIndex && selectedIdx >= newIndex) {
          setSelectedIdx(selectedIdx + 1);
        }
        
        return newPages;
      });
    }
  };

  const handleFiles = async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    
    setLoading(true);
    setStatus('Uploading...');
    const formData = new FormData();
    formData.append('session_id', sessionId);
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    try {
      const res = await fetch('/api/pdfmaker/import', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Import failed');
      const data = await res.json();
      setPages(prev => [...prev, ...data.pages]);
      setStatus('Files added');
    } catch (err) {
      setStatus('Error adding files');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateSelectedPage = (updates) => {
    if (selectedIdx < 0) return;
    const newPages = [...pages];
    newPages[selectedIdx] = { ...newPages[selectedIdx], ...updates };
    setPages(newPages);
  };

  const updateAllPages = (updates) => {
    setPages(pages.map(p => ({ ...p, ...updates })));
  };

  const handleBuild = async () => {
    if (pages.length === 0) return;
    setLoading(true);
    setStatus('Building PDF...');
    try {
      const res = await fetch('/api/pdfmaker/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          pages: pages,
          page_number_settings: pageNums ? pageNumSettings : null,
          jpeg_quality: optimize ? 75 : 95
        })
      });
      if (!res.ok) throw new Error('Build failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'merged_document.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('PDF Built!');
    } catch (err) {
      setStatus('Error building PDF');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      await fetch(`/api/pdfmaker/session/${sessionId}`, { method: 'DELETE' });
    } catch (e) {
      // Ignore reset errors
    }
    localStorage.removeItem('pdfmaker_session');
    setSessionId('');
    setPages([]);
    setSelectedIdx(-1);
    setPreviewUrl(null);
    setStatus('');
    setLoading(false);
  };

  const selectedPage = selectedIdx >= 0 ? pages[selectedIdx] : null;

  return (
    <div className="pdfmaker-container">
      <div className="pm-header">
        <button className="back-btn" onClick={() => navigate('/tools')}>
          &larr; Tools
        </button>
        <h1>PDF Maker</h1>
        <div className="header-status">{status}</div>
      </div>
      
      <div className="pm-toolbar">
        <button className="tb-btn primary" onClick={() => fileInputRef.current?.click()}>
          + Add Files
        </button>
        <button className="tb-btn danger" onClick={handleReset}>
          Reset Session
        </button>
        <input 
          type="file" 
          multiple 
          accept=".jpg,.jpeg,.png,.gif,.bmp,.tiff,.tif,.webp,.txt,.doc,.docx,.pdf,.gltf,.glb,.obj,.stl,.fbx"
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFiles} 
        />
      </div>

      <div className="pm-main">
        <div className="file-list-panel">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={pages.map(p => p.file_id)} strategy={verticalListSortingStrategy}>
              {pages.map((page, idx) => (
                <SortableItem 
                  key={page.file_id} 
                  page={page} 
                  isSelected={idx === selectedIdx}
                  onClick={() => setSelectedIdx(idx)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {pages.length === 0 && <div className="empty-list">No pages added</div>}
        </div>

        <div className="preview-panel">
          {previewLoading && <div className="spinner-overlay"><div className="spinner"></div></div>}
          {previewUrl ? (
            <img src={previewUrl} alt="Preview" className="preview-image" />
          ) : (
            <div className="preview-placeholder">Select a page to preview</div>
          )}
        </div>

        <div className="editor-panel">
          {selectedPage ? (
            <div className="editor-content">
              <h3 className="editor-title">Page {selectedIdx + 1} of {pages.length}</h3>
              <p className="page-filename">{selectedPage.display_name}</p>
              
              <div className="editor-group">
                <label>Page Orientation</label>
                <div className="toggle-group">
                  <button 
                    className={!selectedPage.page_landscape ? 'active' : ''} 
                    onClick={() => updateSelectedPage({ page_landscape: false })}
                  >Portrait</button>
                  <button 
                    className={selectedPage.page_landscape ? 'active' : ''} 
                    onClick={() => updateSelectedPage({ page_landscape: true })}
                  >Landscape</button>
                </div>
              </div>

              {(selectedPage.source_type === 'image' || selectedPage.source_type === '3d') && (
                <div className="editor-group">
                  <label>Image Rotation</label>
                  <div className="grid-2x2">
                    {[0, 90, 180, 270].map(deg => (
                      <button 
                        key={deg}
                        className={selectedPage.image_rotation === deg ? 'active' : ''}
                        onClick={() => updateSelectedPage({ image_rotation: deg })}
                      >
                        {deg}°
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="editor-group">
                <label>Bulk Actions</label>
                <button className="bulk-btn" onClick={() => updateAllPages({ page_landscape: false })}>All Portrait</button>
                <button className="bulk-btn" onClick={() => updateAllPages({ page_landscape: true })}>All Landscape</button>
                <button className="bulk-btn" onClick={() => {
                  setPages(pages.map(p => ({ ...p, image_rotation: ((p.image_rotation || 0) + 90) % 360 })));
                }}>Rotate All CW</button>
              </div>

              <div className="editor-group mt-auto">
                <button 
                  className="delete-btn"
                  onClick={() => {
                    const newPages = pages.filter((_, i) => i !== selectedIdx);
                    setPages(newPages);
                    setSelectedIdx(prev => prev >= newPages.length ? newPages.length - 1 : prev);
                  }}
                >
                  Delete Page
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-editor">No page selected</div>
          )}
        </div>
      </div>

      <div className="pm-savebar">
        <div className="save-options">
          <label className="toggle-label">
            <div className={`pill-toggle ${pageNums ? 'on' : 'off'}`} onClick={() => setPageNums(!pageNums)}>
              <div className="knob"></div>
            </div>
            Page Numbers
          </label>
          <label className="toggle-label">
            <input type="checkbox" checked={optimize} onChange={e => setOptimize(e.target.checked)} />
            ⚡ Optimize
          </label>
        </div>
        <button className="build-btn" onClick={handleBuild} disabled={loading || pages.length === 0}>
          {loading ? 'Processing...' : '💾 Download PDF'}
        </button>
      </div>
    </div>
  );
}
