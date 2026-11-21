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

/** Opens Google's account chooser and resolves with the id token it hands back. */
export async function requestGoogleToken(clientId: string): Promise<string> {
  const id = await loadGis();
  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    id.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (resp: any) => {
        if (resp?.credential) {
          settled = true;
          resolve(resp.credential);
        }
      },
    });
    id.prompt((notice: any) => {
      if (notice?.isNotSignedUp && !settled) reject(new Error('Google sign-in was cancelled.'));
    });
  });
}
