'use client';

import { useEffect, useRef, useState } from 'react';

interface PostVideoProps {
  src: string;
  duration?: number;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PostVideo({ src, duration }: PostVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(duration || 0);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => setCurrent(el.currentTime);
    const onMeta = () => setTotal(el.duration || duration || 0);
    const onEnd = () => setPlaying(false);
    const onPause = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('ended', onEnd);
    el.addEventListener('pause', onPause);
    el.addEventListener('play', onPlay);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('ended', onEnd);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('play', onPlay);
    };
  }, [duration, src]);

  const togglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
    } else {
      el.pause();
    }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className="post-video" onClick={e => e.stopPropagation()}>
      <video
        ref={videoRef}
        src={src}
        playsInline
        muted={muted}
        preload="metadata"
        onClick={togglePlay}
      />
      {!playing && (
        <button type="button" className="video-play" onClick={togglePlay} aria-label="Play video">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5L8 5.5z" />
          </svg>
        </button>
      )}
      <div className="video-hud">
        <span className="video-duration">
          {formatTime(playing ? current : total || duration || 0)}
          {playing && total ? ` / ${formatTime(total)}` : ''}
        </span>
        <button type="button" className="video-mute" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M4 9v6h4l5 4V5L8 9H4zm12.5 3l2.1-2.1 1.4 1.4L18 13.4l2 2-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2 2-2-2.1-2.1 1.4-1.4 2.1 2.1z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03z" />
            </svg>
          )}
        </button>
      </div>
      <div className="video-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
