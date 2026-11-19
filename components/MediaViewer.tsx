'use client';

import { useState, useEffect, useRef } from 'react';
import { Media } from '@/lib/types';
import { IC } from '@/lib/icons';

interface MediaViewerProps {
  media: Media[];
  initialIndex: number;
  onClose: () => void;
}

export default function MediaViewer({ media, initialIndex, onClose }: MediaViewerProps) {
  const [currentIndex, setCurrentIndex] = useState(Math.max(0, Math.min(initialIndex, media.length - 1)));
  const [isVideo, setIsVideo] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const current = media[currentIndex];
    setIsVideo(current?.type === 'video');
  }, [currentIndex, media]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') goToPrevious();
      if (e.key === 'ArrowRight') goToNext();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, media.length, currentIndex]);

  const goToNext = () => {
    setCurrentIndex((i) => (i + 1) % media.length);
  };

  const goToPrevious = () => {
    setCurrentIndex((i) => (i - 1 + media.length) % media.length);
  };

  const current = media[currentIndex];
  if (!current) return null;

  const isLastImage = currentIndex === media.length - 1;
  const isFirstImage = currentIndex === 0;

  return (
    <div className="media-modal" onClick={onClose}>
      <div className="media-modal-content" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video
            ref={videoRef}
            src={current.src}
            controls
            autoPlay
            playsInline
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        ) : (
          <img
            src={current.src || current.gen}
            alt={`Image ${currentIndex + 1}`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
        )}

        {media.length > 1 && (
          <>
            <div className="media-modal-nav">
              <button
                onClick={goToPrevious}
                disabled={isFirstImage}
                aria-label="Previous media"
                title="Previous (← arrow)"
              >
                {IC.back}
              </button>
              <button
                onClick={goToNext}
                disabled={isLastImage}
                aria-label="Next media"
                title="Next (→ arrow)"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 19l7-7-7-7" />
                </svg>
              </button>
            </div>
            <div className="media-modal-counter">
              {currentIndex + 1} / {media.length}
            </div>
          </>
        )}

        <button
          className="media-modal-close"
          onClick={onClose}
          aria-label="Close viewer"
          title="Close (Esc)"
        >
          {IC.x}
        </button>
      </div>
    </div>
  );
}
