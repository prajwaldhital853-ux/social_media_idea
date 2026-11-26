'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';

export default function Toast() {
  const { toast, hideToast, confirmBox, hideConfirm, t } = useApp();
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!toast && !confirmBox) { setShow(false); return; }
    const frame = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(frame);
  }, [toast, confirmBox]);

  if (!mounted) return null;
  // Portalled to the body: a transformed ancestor would otherwise capture the
  // fixed bar and pin the question inside a post instead of over the viewport.
  return createPortal(
    <>
      {toast && (
        <div className={`toast ${show ? 'show' : ''}`} role="status">
          <span>{toast}</span>
          <button type="button" className="toast-x" aria-label={t('close')} onClick={hideToast}>×</button>
        </div>
      )}
      {confirmBox && (
        <div className={`toast toast-confirm ${show ? 'show' : ''}`} role="alertdialog" aria-label={confirmBox.text}>
          <span>{confirmBox.text}</span>
          <span className="toast-actions">
            <button type="button" className="toast-btn" onClick={hideConfirm}>{t('cancel')}</button>
            <button
              type="button"
              className="toast-btn solid"
              onClick={() => {
                // The answer runs after the bar is gone, so a slow delete cannot
                // leave a dead question on screen while the reader moves on.
                const run = confirmBox.onYes;
                hideConfirm();
                run();
              }}
            >{t('confirmYes')}</button>
          </span>
        </div>
      )}
    </>,
    document.body,
  );
}
