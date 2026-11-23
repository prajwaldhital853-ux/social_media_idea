'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';

type Props = {
  /** Object URL of the file the user just picked. */
  src: string;
  /** Name the cropped JPEG is stored under. */
  name: string;
  /** Width / height of the frame the picture is going into. */
  ratio: number;
  /** Circular preview, for a profile picture. */
  round?: boolean;
  /** Longest edge of the exported image, in pixels. */
  max: number;
  onCancel: () => void;
  onCrop: (file: File) => void;
};

const MAX_ZOOM = 4;
const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)));

export default function ImageCropper({ src, name, ratio, round, max, onCancel, onCrop }: Props) {
  const { t } = useApp();
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const touch = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const drag = useRef({ x: 0, y: 0, pan: { x: 0, y: 0 } });

  useBackClose(true, onCancel);

  // The frame holds the target aspect at any viewport, so what the user frames is
  // what gets exported — measuring it in JS beats fighting max-width/max-height in CSS.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const r = stage.getBoundingClientRect();
      let w = r.width;
      let h = w / ratio;
      if (h > r.height) {
        h = r.height;
        w = h * ratio;
      }
      setSize({ w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [ratio]);

  const base = nat.w && size.w ? Math.max(size.w / nat.w, size.h / nat.h) : 1;
  const scale = base * zoom;
  const dispW = nat.w * scale;
  const dispH = nat.h * scale;
  const limit = { x: Math.max(0, (dispW - size.w) / 2), y: Math.max(0, (dispH - size.h) / 2) };
  const px = clamp(pan.x, -limit.x, limit.x);
  const py = clamp(pan.y, -limit.y, limit.y);
  const left = (size.w - dispW) / 2 + px;
  const top = (size.h - dispH) / 2 + py;

  const setZoomTo = (next: number) => {
    const z = clamp(next, 1, MAX_ZOOM);
    if (z === zoom) return;
    // Keep whatever sits under the centre of the frame there while zooming.
    const k = z / zoom;
    setPan({ x: clamp(px * k, -limit.x * k, limit.x * k), y: clamp(py * k, -limit.y * k, limit.y * k) });
    setZoom(z);
  };

  // Wheel has to be non-passive or the page behind the sheet scrolls instead of the
  // picture zooming, which React's onWheel cannot prevent.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomer = useRef(setZoomTo);
  zoomer.current = setZoomTo;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomer.current(zoomRef.current * (e.deltaY > 0 ? 0.92 : 1.08));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  const spread = () => {
    const pts = Array.from(touch.current.values());
    return pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    touch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touch.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, pan: { x: px, y: py } };
    else pinch.current = spread();
    setFailed('');
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!touch.current.has(e.pointerId)) return;
    touch.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touch.current.size >= 2) {
      const d = spread();
      if (pinch.current > 0 && d > 0) {
        setZoomTo(zoom * (d / pinch.current));
        pinch.current = d;
      }
      return;
    }
    setPan({
      x: clamp(drag.current.pan.x + e.clientX - drag.current.x, -limit.x, limit.x),
      y: clamp(drag.current.pan.y + e.clientY - drag.current.y, -limit.y, limit.y),
    });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    touch.current.delete(e.pointerId);
    pinch.current = 0;
    if (touch.current.size === 1) {
      const only = Array.from(touch.current.values())[0];
      drag.current = { x: only.x, y: only.y, pan: { x: px, y: py } };
    }
  };

  const apply = () => {
    const img = imgRef.current;
    if (!img || !nat.w || !size.w) return;
    setBusy(true);
    setFailed('');
    const sx = clamp(-left / scale, 0, Math.max(0, nat.w - 1));
    const sy = clamp(-top / scale, 0, Math.max(0, nat.h - 1));
    const sw = Math.min(size.w / scale, nat.w - sx);
    const sh = Math.min(size.h / scale, nat.h - sy);
    const fit = Math.min(1, max / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * fit));
    canvas.height = Math.max(1, Math.round(sh * fit));
    const ctx = canvas.getContext('2d');
    const bail = () => {
      setFailed('This photo could not be cropped. Try another one.');
      setBusy(false);
    };
    if (!ctx) return bail();
    // Flat white under a transparent PNG, the way the frame shows it.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) return bail();
      onCrop(new File([blob], name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  return createPortal(
    <div className="modal-overlay cropper-overlay" onClick={onCancel}>
      <div className="modal-content image-cropper" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('cropTitle')}>
        <div className="modal-header">
          <b>{t('cropTitle')}</b>
          <button type="button" className="modal-close" onClick={onCancel} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="crop-stage" ref={stageRef}>
          <div
            className={`crop-frame${round ? ' round' : ''}`}
            style={{ width: size.w || undefined, height: size.h || undefined }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <img
              ref={imgRef}
              src={src}
              alt=""
              draggable={false}
              onLoad={e => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              style={{ width: dispW || undefined, height: dispH || undefined, transform: `translate3d(${left}px, ${top}px, 0)` }}
            />
            {round && <span className="crop-guide" aria-hidden="true" />}
          </div>
        </div>
        <p className="crop-hint">{t('cropHint')}</p>
        <div className="crop-zoom" role="group" aria-label={t('cropZoom')}>
          <button type="button" className="zoom-btn" aria-label={t('cropZoomOut')} disabled={zoom <= 1} onClick={() => setZoomTo(zoom / 1.3)}>−</button>
          <span className="zoom-level">{Math.round(zoom * 100)}%</span>
          <button type="button" className="zoom-btn" aria-label={t('cropZoomIn')} disabled={zoom >= MAX_ZOOM} onClick={() => setZoomTo(zoom * 1.3)}>+</button>
        </div>
        {failed && <p className="form-error" role="alert">{failed}</p>}
        <div className="crop-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={busy}>{t('cancel')}</button>
          <button type="button" className="promote-submit crop-apply" onClick={apply} disabled={busy || !nat.w}>
            {busy ? '…' : t('cropApply')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
