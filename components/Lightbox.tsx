'use client';

import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';

/**
 * Full-screen view of one picture, used for a profile photo and a cover.
 * The scrim closes it and the browser back button unwinds it like a page.
 */
export default function Lightbox({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  const { t } = useApp();
  useBackClose(true, onClose);

  return createPortal(
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={caption}>
      <button type="button" className="icon-btn lightbox-close" aria-label={t('close')} onClick={onClose}>{IC.x}</button>
      <figure className="lightbox-figure" onClick={e => e.stopPropagation()}>
        <img className="lightbox-img" src={src} alt={caption} />
        <figcaption>{caption}</figcaption>
      </figure>
    </div>,
    document.body,
  );
}
