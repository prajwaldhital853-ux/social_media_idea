'use client';

import AutoVideo from './AutoVideo';

interface PostVideoProps {
  src: string;
  duration?: number;
  onOpen?: () => void;
  preview?: boolean;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PostVideo({ src, duration, onOpen, preview = false }: PostVideoProps) {
  if (preview) {
    return (
      <div className="post-video preview" onClick={e => { e.stopPropagation(); onOpen?.(); }}>
        <video src={src} muted playsInline preload="metadata" />
        <button type="button" className="video-play" aria-label="Open video">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5L8 5.5z" />
          </svg>
        </button>
        <div className="video-hud">
          <span className="video-duration">{formatTime(duration || 0)}</span>
        </div>
      </div>
    );
  }
  return <AutoVideo src={src} dur={duration} observe loop cover={false} onOpen={onOpen} />;
}