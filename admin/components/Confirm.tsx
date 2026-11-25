'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface Ask {
  title: string;
  /** What happens to the other person, in one sentence. */
  body: string;
  /** The words on the button that goes ahead. */
  confirmLabel?: string;
  tone?: 'primary' | 'danger' | 'amber';
  /** For a control that already moved, a select, a toggle, this puts it back. */
  onNo?: () => void;
}

type Asker = (ask: Ask) => Promise<boolean>;

const ConfirmContext = createContext<Asker>(async () => true);

/**
 * Nothing in this console takes effect on the click that asks for it. A seat
 * signs a warning, a bar or a refund onto a real account, and the person on the
 * other side never sees the button, so the last click always gets a sentence
 * describing what it does, and a chance to stop.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Ask | null>(null);
  const settle = useRef<((ok: boolean) => void) | null>(null);
  const passedRef = useRef<(() => void) | null>(null);

  const answer = useCallback((ok: boolean) => {
    const done = settle.current;
    const passed = passedRef.current;
    settle.current = null;
    passedRef.current = null;
    setPending(null);
    if (!ok) passed?.();
    done?.(ok);
  }, []);

  const ask = useCallback<Asker>(next => new Promise(resolve => {
    // A second question while one is open is a bug in the caller, not a dialog
    // worth stacking: answer the first as no and show the new one.
    settle.current?.(false);
    settle.current = resolve;
    passedRef.current = next.onNo || null;
    setPending(next);
  }), []);

  useEffect(() => {
    if (!pending) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') answer(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [answer, pending]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <div className="scrim" role="alertdialog" aria-modal="true" aria-label={pending.title}>
          <div className="prompt">
            <h2>{pending.title}</h2>
            <p>{pending.body}</p>
            <div className="prompt-actions">
              <div className="prompt-right">
                <button type="button" className="btn ghost" onClick={() => answer(false)}>Cancel</button>
                <button
                  type="button" autoFocus
                  className={`btn ${pending.tone || 'primary'}`}
                  onClick={() => answer(true)}
                >
                  <span>{pending.confirmLabel || 'Go ahead'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
