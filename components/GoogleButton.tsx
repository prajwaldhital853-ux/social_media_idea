'use client';

import { useEffect, useRef, useState } from 'react';
import { renderGoogleButton } from '@/lib/google';

/**
 * Google's own sign-in button, drawn into the page.
 *
 * A button of ours has to go through One Tap, and One Tap stops showing itself for a
 * day once a visitor dismisses it: the spinner starts, nothing arrives, and the console
 * stays clean. Google's button starts the chooser on every press, and it is the shape
 * their branding rules ask for anyway. The caller's own button takes over if the script
 * cannot be reached at all, so the demo path and a blocked network still have a way in.
 */
export default function GoogleButton({ clientId, onToken, onError, fallback }: {
  clientId: string;
  onToken: (token: string) => void;
  onError: (message: string) => void;
  fallback: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // The handlers change on every render, but Google's callback is registered once, so
  // it reads the live pair rather than the one that happened to exist when it was drawn.
  const live = useRef({ onToken, onError });
  live.current = { onToken, onError };

  useEffect(() => {
    if (failed || !box.current) return;
    let alive = true;
    renderGoogleButton(box.current, clientId, {
      token: token => { if (alive) live.current.onToken(token); },
      error: message => {
        if (!alive) return;
        setFailed(true);
        live.current.onError(message);
      },
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [clientId, failed]);

  if (failed) return <>{fallback}</>;
  return <div className="gbtn" ref={box} />;
}
