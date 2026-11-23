'use client';

/**
 * Google Identity Services, loaded on demand.
 *
 * The client id comes from /api/meta/ — if the server has no Google app configured,
 * nothing here runs and the UI never shows the button.
 */

declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
// Google can hand back nothing at all: the visitor closes the chooser, or this browser
// cannot show it. Either way the button must stop saying "checking" and say something.
const ANSWER_WAIT_MS = 8000;

function loadGis(): Promise<any> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  return new Promise((resolve, reject) => {
    const done = () => (window.google?.accounts?.id
      ? resolve(window.google.accounts.id)
      : reject(new Error('Google Identity Services loaded without the credential API.')));
    const failed = () => reject(new Error('Google Identity Services could not be loaded.'));
    const existing = document.querySelector<HTMLScriptElement>('script[data-gis]');
    if (existing) {
      existing.addEventListener('load', done, { once: true });
      existing.addEventListener('error', failed, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.dataset.gis = '1';
    script.onload = done;
    script.onerror = failed;
    document.head.appendChild(script);
  });
}

// The credential arrives in the callback registered by initialize(), which is set up
// once per client id, while every click needs its own promise. So the click leaves its
// resolver here and the standing callback picks it up.
let pending: { resolve: (token: string) => void; reject: (err: Error) => void } | null = null;
let initializedFor = '';

async function gisId(clientId: string) {
  const id = await loadGis();
  if (initializedFor !== clientId) {
    id.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      // The account chooser as a dialog in the middle of the screen, on phones too.
      // Without this flag GIS shows its own One Tap overlay, which mobile browsers
      // suppress outright — the click looked like it did nothing.
      use_fedcm_for_prompt: true,
      // Both flags, because this is a button the visitor pressed and not a page that
      // displayed itself. One Tap keeps a per-day cooldown and goes quiet after a
      // dismissal; the button path is the one Google says to use for a click.
      use_fedcm_for_button: true,
      callback: (response: any) => {
        const hand = pending;
        pending = null;
        if (!hand) return;
        if (response?.credential) hand.resolve(response.credential);
        else hand.reject(new Error('Google returned no account.'));
      },
    });
    initializedFor = clientId;
  }
  return id;
}

/** Opens Google's account chooser and resolves with the id token it hands back. */
export async function requestGoogleToken(clientId: string): Promise<string> {
  const id = await gisId(clientId);
  // A second click replaces the first attempt rather than leaving two promises that
  // both wait for one chooser.
  const stale = pending;
  pending = null;
  if (stale) stale.reject(new Error('Google sign-in was replaced by a newer attempt.'));
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const stop = () => {
      settled = true;
      clearTimeout(timer);
      pending = null;
    };
    const timer = setTimeout(() => {
      if (!settled) {
        stop();
        reject(new Error('Google refused the sign-in. This site is probably not listed under '
          + '"Authorised JavaScript origins" for that client id, or the client is still in Testing.'));
      }
    }, ANSWER_WAIT_MS);
    pending = {
      resolve: token => {
        if (settled) return;
        stop();
        resolve(token);
      },
      reject: err => {
        if (settled) return;
        stop();
        reject(err);
      },
    };
    id.prompt((notice: any) => {
      if (notice?.isNotSignedUp && !settled) {
        stop();
        reject(new Error('Google sign-in was cancelled.'));
      }
    });
  });
}
