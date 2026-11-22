'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface AutoVideoProps {
  src: string;
  dur?: number;
  active?: boolean;
  observe?: boolean;
  loop?: boolean;
  seek?: boolean;
  cover?: boolean;
  preload?: 'metadata' | 'auto' | 'none';
  onOpen?: () => void;
  /** Playback speed. Absent means 1x, and a change lands on the running clip. */
  rate?: number;
  /** A hold on the surface, used for the reel menu. Suppresses the play toggle. */
  onLongPress?: () => void;
  /** True while the decoder has run dry, so the page can cover it with a skeleton. */
  onBuffering?: (waiting: boolean) => void;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const PLAY_SVG = <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5L8 5.5z" /></svg>;
const PAUSE_SVG = <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" /></svg>;
const SOUND_SVG = <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>;
const MUTED_SVG = <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3l2.1-2.1 1.4 1.4L18 13.4l2 2-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2-2.1-2.1 1.4-1.4 2.1 2.1z" /></svg>;

export default function AutoVideo({ src, dur, active = true, observe = false, loop = false, seek = false, cover = false, preload = 'metadata', onOpen, rate, onLongPress, onBuffering }: AutoVideoProps) {
  const video = useRef<HTMLVideoElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(dur || 0);
  const [inView, setInView] = useState(!observe);
  const [flash, setFlash] = useState<'play' | 'pause' | null>(null);
  const [badge, setBadge] = useState<{ dir: 'left' | 'right'; id: number } | null>(null);
  const [needGesture, setNeedGesture] = useState(false);
  const mutedRef = useRef(false);
  const userPaused = useRef(false);
  const wantPlay = useRef(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<{ t: number; zone: 'left' | 'right' } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const attemptPlay = useCallback(() => {
    const el = video.current;
    if (!el) return;
    el.muted = mutedRef.current;
    void el.play().catch((err: unknown) => {
      const name = (err as DOMException | undefined)?.name;
      // A play() interrupted by pause() or a src swap must not trip the muted fallback.
      if (name === 'AbortError' || name === 'NotSupportedError') return;
      if (!mutedRef.current) {
        mutedRef.current = true;
        el.muted = true;
        setMuted(true);
        setNeedGesture(true);
        void el.play().catch(() => setPlaying(false));
      } else {
        setPlaying(false);
      }
    });
  }, []);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    wantPlay.current = active && inView && !userPaused.current;
    if (wantPlay.current) attemptPlay();
    else el.pause();
  }, [active, inView, src, attemptPlay]);

  useEffect(() => {
    if (!needGesture) return;
    const unmute = () => {
      setNeedGesture(false);
      mutedRef.current = false;
      setMuted(false);
      const el = video.current;
      if (el) { el.muted = false; void el.play().catch(() => {}); }
    };
    window.addEventListener('pointerdown', unmute, { once: true });
    window.addEventListener('keydown', unmute, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unmute);
      window.removeEventListener('keydown', unmute);
    };
  }, [needGesture]);

  useEffect(() => {
    if (!observe) return;
    const el = wrap.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      entries => setInView(entries[0].isIntersecting && entries[0].intersectionRatio >= 0.55),
      { threshold: [0, 0.55, 1] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [observe]);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setTotal(el.duration || dur || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => setPlaying(false);
    const onReady = () => { if (wantPlay.current && el.paused) attemptPlay(); };
    const onWaiting = () => onBuffering?.(true);
    const onResumed = () => onBuffering?.(false);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('loadeddata', onReady);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnd);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onResumed);
    el.addEventListener('canplay', onResumed);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('loadeddata', onReady);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onResumed);
      el.removeEventListener('canplay', onResumed);
    };
  }, [src, dur, attemptPlay, onBuffering]);

  // A rate chosen on one reel is the shelf's rate, so it has to land on a clip
  // that is already running rather than only on the next one to start.
  useEffect(() => {
    const el = video.current;
    if (el) el.playbackRate = rate || 1;
  }, [rate, src]);

  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  const showFlash = (kind: 'play' | 'pause') => {
    setFlash(kind);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 620);
  };

  const togglePlay = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      userPaused.current = false;
      wantPlay.current = true;
      attemptPlay();
      showFlash('play');
    } else {
      userPaused.current = true;
      wantPlay.current = false;
      el.pause();
      showFlash('pause');
    }
  };

  const doSeek = (zone: 'left' | 'right') => {
    const el = video.current;
    if (!el) return;
    const span = el.duration || total || 0;
    el.currentTime = Math.max(0, Math.min(span, el.currentTime + (zone === 'left' ? -10 : 10)));
    setCurrent(el.currentTime);
    setBadge({ dir: zone, id: Date.now() });
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(() => setBadge(null), 760);
  };

  const onTap = (e: React.MouseEvent) => {
    // A hold opened the menu; the click that follows it is not a play toggle.
    if (held.current) return;
    if (onOpen) { onOpen(); return; }
    if (!seek) { togglePlay(); return; }
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect) return;
    const zone: 'left' | 'right' = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();
    if (lastTap.current && now - lastTap.current.t < 320 && lastTap.current.zone === zone) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = null;
      doSeek(zone);
    } else {
      lastTap.current = { t: now, zone };
      if (tapTimer.current) clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => { lastTap.current = null; togglePlay(); }, 280);
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = video.current;
    if (!el) return;
    mutedRef.current = !mutedRef.current;
    el.muted = mutedRef.current;
    setMuted(mutedRef.current);
    setNeedGesture(false);
  };

  const scrub = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = video.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (!el || !rect.width) return;
    const span = el.duration || total || 0;
    el.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span;
    setCurrent(el.currentTime);
  };

  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div
      className={`auto-video ${cover ? 'cover' : ''}`}
      ref={wrap}
      onClick={onTap}
      onPointerDown={e => {
        held.current = false;
        if (holdTimer.current) clearTimeout(holdTimer.current);
        if (e.button !== 0 || !onLongPress) return;
        const origin = { x: e.clientX, y: e.clientY };
        holdTimer.current = setTimeout(() => { held.current = true; onLongPress(); }, 500);
        const drag = (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > 12) {
            if (holdTimer.current) clearTimeout(holdTimer.current);
            holdTimer.current = null;
            window.removeEventListener('pointermove', drag);
          }
        };
        window.addEventListener('pointermove', drag);
        window.addEventListener('pointerup', () => window.removeEventListener('pointermove', drag), { once: true });
      }}
      onPointerUp={() => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; }}
      onPointerCancel={() => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; }}
    >
      <video ref={video} src={src} playsInline loop={loop} preload={preload} muted={muted} />
      {flash && <span className={`av-flash ${flash}`} aria-hidden="true">{flash === 'play' ? PLAY_SVG : PAUSE_SVG}</span>}
      {badge && (
        <span className={`av-seek ${badge.dir}`} key={badge.id} aria-hidden="true">
          {badge.dir === 'left'
            ? <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M11 12l8.5-6v12L11 12zm-7 0l8.5-6v12L4 12z" /></svg>
            : <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M4 6l8.5 6L4 18V6zm9.5 6L22 6v12l-8.5-6z" /></svg>}
          <b>10s</b>
        </span>
      )}
      {!playing && (
        <button type="button" className="video-play" aria-label="Play video" onClick={e => { e.stopPropagation(); if (onOpen) onOpen(); else togglePlay(); }}>
          {PLAY_SVG}
        </button>
      )}
      <div className="video-hud" onClick={e => e.stopPropagation()}>
        <span className="video-duration">{formatTime(current)} / {formatTime(total)}</span>
        <button type="button" className="video-mute" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
          {muted ? MUTED_SVG : SOUND_SVG}
        </button>
      </div>
      <div className="video-progress" onClick={scrub} aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}