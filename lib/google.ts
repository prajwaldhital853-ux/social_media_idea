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
 *
 * `hint` belongs to initialize(), not renderButton(): it tells Google which account to
 * preselect. The button itself stays generic, because Google's personalized label names
 * the browser profile rather than the Exposing seat and cannot be overridden.
 */
export async function renderGoogleButton(
  box: HTMLElement,
  clientId: string,
  handlers: { token: (token: string) => void; error: (message: string) => void },
  hint: string | null,
): Promise<void> {
  if (hint === null) return;
  const id = await loadGis();
  if (initializedFor !== clientId) {
    id.initialize({
      client_id: clientId,
      auto_select: false,
      ...(hint ? { login_hint: hint } : {}),
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
    text: 'signin_with',
    width: Math.round(Math.min(360, Math.max(200, box.clientWidth || 320))),
  });
}

const HINT_KEY = 'exposing-google-account';

/** The address and name inside a Google credential, read here rather than asked for.
 *
 * The token is signed by Google and is already on the page, so a form can be filled
 * from the account that was actually chosen before the server has answered anything —
 * and it stays filled even when that answer is an error.
 */
export function credentialAccount(token: string): { email: string; name: string } {
  try {
    const body = (token || '').split('.')[1];
    if (!body) return { email: '', name: '' };
    const json = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { email?: string; name?: string };
    return { email: (json.email || '').toLowerCase(), name: json.name || '' };
  } catch {
    // A token this browser cannot read is simply a token this browser cannot prefill.
    return { email: '', name: '' };
  }
}

export function googleAccountHint(): string {
  try {
    return localStorage.getItem(HINT_KEY) || '';
  } catch {
    return '';
  }
}

/** Remembers the account that was just used, so the next button names it. */
export function rememberGoogleAccount(email: string): string {
  const value = (email || '').toLowerCase();
  try {
    if (value) localStorage.setItem(HINT_KEY, value);
    else localStorage.removeItem(HINT_KEY);
  } catch { /* a private window that refuses storage keeps working without the hint */ }
  return value;
}
