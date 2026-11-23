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

// Google registers one callback for the whole page, while each button drawn wants the
// handlers that belong to it — so the live pair sits here and the callback reads it.
let deliver: { token: (token: string) => void; error: (message: string) => void } =
  { token: () => {}, error: () => {} };
let initializedFor = '';

/** Draws Google's own sign-in button, which starts the chooser on every press.
 *
 * The alternative — a button of ours that calls prompt() — goes through One Tap, and One
 * Tap stops showing itself for about a day once a visitor dismisses it: the spinner
 * starts, nothing arrives, and the console stays clean. The button flow carries no such
 * cooldown, and this is the shape Google's branding rules ask for anyway.
 */
export async function renderGoogleButton(
  box: HTMLElement,
  clientId: string,
  handlers: { token: (token: string) => void; error: (message: string) => void },
): Promise<void> {
  const id = await loadGis();
  if (initializedFor !== clientId) {
    id.initialize({
      client_id: clientId,
      auto_select: false,
      // The account chooser as a dialog in the middle of the screen, on phones too.
      use_fedcm_for_button: true,
      callback: (response: any) => {
        if (response?.credential) deliver.token(response.credential);
        else deliver.error('Google returned no account.');
      },
    });
    initializedFor = clientId;
  }
  deliver = handlers;
  id.renderButton(box, {
    theme: 'outline',
    shape: 'pill',
    size: 'large',
    text: 'continue_with',
    width: Math.round(Math.min(360, Math.max(200, box.clientWidth || 320))),
  });
}
