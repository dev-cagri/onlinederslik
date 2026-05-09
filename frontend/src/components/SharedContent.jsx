import { useEffect, useRef, useState } from 'react';
import { clearShare } from '../lib/api.js';
import { Icon } from './icons.jsx';

const DEFAULT_VIEWPORT = { zoom: 1, panX: 0, panY: 0 };
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 5;

function clampZoom(z) { return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)); }

export function SharedContent({ share, viewport, isHost, hostToken, roomId, onViewportChange }) {
  const isImage = share.type?.startsWith('image/');
  const isPdf = share.type === 'application/pdf';
  const v = viewport || DEFAULT_VIEWPORT;

  const dragRef = useRef(null);
  const pinchRef = useRef(null);
  const canvasRef = useRef(null);
  const [isDragging, setDragging] = useState(false);

  async function handleClear() {
    if (!confirm('Paylaşımı durdurmak istediğinize emin misiniz?')) return;
    try { await clearShare(roomId, hostToken); } catch { /* yoksay */ }
  }

  function applyChange(next) {
    if (!isHost || !onViewportChange) return;
    onViewportChange({
      zoom: clampZoom(next.zoom ?? v.zoom),
      panX: next.panX ?? v.panX,
      panY: next.panY ?? v.panY,
    });
  }

  function zoomBy(delta) { applyChange({ zoom: v.zoom + delta }); }
  function reset() { applyChange({ zoom: 1, panX: 0, panY: 0 }); }

  // Pointer (mouse + touch) event'leri ile drag-to-pan ve pinch-to-zoom
  function onPointerDown(e) {
    if (!isHost) return;
    const target = canvasRef.current;
    if (!target) return;
    target.setPointerCapture?.(e.pointerId);

    const points = pinchRef.current?.points || new Map();
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (points.size === 2) {
      const [p1, p2] = Array.from(points.values());
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      pinchRef.current = { points, startDist: dist, startZoom: v.zoom };
      dragRef.current = null;
    } else {
      pinchRef.current = { points };
      dragRef.current = { x: e.clientX, y: e.clientY, startX: v.panX, startY: v.panY };
      setDragging(true);
    }
  }

  function onPointerMove(e) {
    if (!isHost) return;
    const points = pinchRef.current?.points;
    if (!points) return;
    if (!points.has(e.pointerId)) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (points.size === 2 && pinchRef.current.startDist) {
      const [p1, p2] = Array.from(points.values());
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const factor = dist / pinchRef.current.startDist;
      applyChange({ zoom: pinchRef.current.startZoom * factor });
      return;
    }

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      applyChange({
        panX: dragRef.current.startX + dx,
        panY: dragRef.current.startY + dy,
      });
    }
  }

  function onPointerUp(e) {
    const points = pinchRef.current?.points;
    if (points) points.delete(e.pointerId);
    if (!points || points.size < 2) {
      pinchRef.current = points ? { points } : null;
    }
    if (!points || points.size === 0) {
      dragRef.current = null;
      setDragging(false);
    }
  }

  // Wheel ile zoom (desktop)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !isHost) return;
    function onWheel(e) {
      if (!isImage) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.0015;
      applyChange({ zoom: v.zoom + delta * v.zoom });
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isHost, isImage, v.zoom]);

  const transform =
    isImage
      ? `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`
      : 'none';

  return (
    <div className="shared-content">
      <div
        ref={canvasRef}
        className={`shared-canvas ${isHost ? 'host-controllable' : ''} ${isDragging ? 'dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {isImage && (
          <img
            src={share.url}
            alt={share.name}
            style={{ transform, transformOrigin: 'center center' }}
            draggable={false}
          />
        )}
        {isPdf && <iframe src={share.url} title={share.name} />}
        {!isImage && !isPdf && (
          <div className="share-fallback">
            <a href={share.url} download={share.name} target="_blank" rel="noreferrer">
              {share.name} — indir
            </a>
          </div>
        )}
      </div>

      <div className="share-toolbar">
        {isImage && (
          <span className="share-zoom">
            {isHost && (
              <button onClick={() => zoomBy(-0.25)} title="Uzaklaştır">
                <Icon.ZoomOut width="14" height="14" />
              </button>
            )}
            <span className="share-zoom-percent">{Math.round(v.zoom * 100)}%</span>
            {isHost && (
              <>
                <button onClick={() => zoomBy(0.25)} title="Yakınlaştır">
                  <Icon.ZoomIn width="14" height="14" />
                </button>
                <button onClick={reset} title="Sıfırla">
                  <Icon.Reset width="14" height="14" />
                </button>
              </>
            )}
          </span>
        )}

        {isHost && hostToken && (
          <button className="share-stop" onClick={handleClear}>
            <Icon.X width="12" height="12" /> Durdur
          </button>
        )}
      </div>

      {isHost && isImage && (
        <div className="share-host-hint">
          Sürükle: kaydır · 2 parmak / fare tekerleği: yakınlaştır
        </div>
      )}
    </div>
  );
}
