'use client';

import { useEffect, useRef, useState } from 'react';
import { credentialAccount, googleAccountHint, rememberGoogleAccount, renderGoogleButton } from '@/lib/google';
import { IC } from '@/lib/icons';

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
  const [hint, setHint] = useState<string | null>(null);
  // The handlers change on every render, but Google's callback is registered once, so
  // it reads the live pair rather than the one that happened to exist when it was drawn.
  const live = useRef({ onToken, onError });
  live.current = { onToken, onError };

  useEffect(() => {
    setHint(googleAccountHint());
  }, []);

  const hintReady = hint !== null;
  useEffect(() => {
    if (failed || hint === null || !box.current) return;
    let alive = true;
    renderGoogleButton(box.current, clientId, {
      token: token => {
        if (!alive) return;
        // The chip follows the credential Google really returned, never the profile
        // the browser happens to be using outside Exposing.
        const picked = credentialAccount(token).email;
        if (picked && picked !== hint) {
          rememberGoogleAccount(picked);
          setHint(picked);
        }
        live.current.onToken(token);
      },
      error: message => {
        if (!alive) return;
        setFailed(true);
        live.current.onError(message);
      },
    }, hint).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [clientId, failed, hintReady]);

  if (failed) return <>{fallback}</>;
  return <>
    {hint ? (
      <div className="gbtn-account" title="Last Exposing account">
        {IC.g}
        <span>{hint}</span>
      </div>
    ) : null}
    <div className="gbtn" ref={box} />
  </>;
}
