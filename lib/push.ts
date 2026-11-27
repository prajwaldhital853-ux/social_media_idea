import { api, API_ENABLED, ApiError } from './api';

/**
 * Web Push: the browser's own wake-up call.
 *
 * The member's browser holds an address at its push service and a key pair of
 * its own; we hand the address to the server, the server seals a card for that
 * browser alone, and the service worker draws it whether the tab is in the
 * background, closed, or the site was never reopened. Nothing here is Exposing's
 * own protocol — this is the standard Push API, so it works in Chrome, Edge and
 * Firefox, and in Safari once the site is added to the Home Screen.
 *
 * The permission belongs to the browser and the server only holds the address,
 * so every function here reads the browser first and never assumes that what
 * the switch shows is what the operating system will allow.
 */

const SW_PATH = '/sw.js';
const SUBSCRIBE = '/api/notifications/push/subscribe/';
const UNSUBSCRIBE = '/api/notifications/push/unsubscribe/';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported';

/** What this browser is physically able to do, before anybody is asked. */
export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

/** VAPID public keys travel as base64url, which is not what `atob` speaks. */
function asKey(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  // Over an explicit ArrayBuffer: `pushManager` refuses a source that could be
  // a shared buffer, and a bare `Uint8Array` is typed as if it might be one.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function worker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(SW_PATH);
}

function keysOf(sub: PushSubscription) {
  const keys = sub.toJSON().keys || {};
  return { p256dh: keys.p256dh || '', auth: keys.auth || '' };
}

/**
 * Which key the browser's address was filed under.
 *
 * The subscription carries the server's public key as DER, whose last 65 bytes
 * are the raw point we handed it — base64url'd the same way `pushkeys` prints.
 */
function filedKey(sub: PushSubscription): string {
  const der = sub.options.applicationServerKey;
  if (!der) return '';
  let bin = '';
  const raw = new Uint8Array(der).slice(-65);
  for (let i = 0; i < raw.length; i += 1) bin += String.fromCharCode(raw[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Whether the switch should read as on.
 *
 * Read from the browser rather than the server: a member who revokes the right
 * in the address bar has turned push off whatever our database says, and a
 * switch that stays lit after that is a switch that lies.
 */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  try {
    return (await (await worker()).pushManager.getSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/**
 * Ask, subscribe, hand the address over.
 *
 * The prompt is only ever raised from a click: a page that asks on arrival gets
 * dismissed by reflex, and a dismissal sticks for a while.
 */
export async function enablePush(): Promise<{ ok: boolean; detail?: string }> {
  if (!pushSupported()) return { ok: false, detail: 'This browser cannot receive notifications.' };
  if (!API_ENABLED) return { ok: false, detail: 'Push needs the server.' };
  if (Notification.permission === 'denied') {
    return { ok: false, detail: 'Notifications are blocked for this site. Allow them in the address bar.' };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, detail: 'Notifications were not allowed.' };

  const config = await api.get<{ enabled: boolean; public_key: string }>('/api/notifications/push/config/');
  if (!config.enabled || !config.public_key) {
    return { ok: false, detail: 'Push is not switched on at Exposing yet.' };
  }
  const reg = await worker();
  const held = await reg.pushManager.getSubscription();
  // An address filed under a key we no longer hold is a dead one — the push
  // service shrugs at every card sealed for the new half. Throw it and re-take.
  const keeps = held !== null && filedKey(held) === config.public_key;
  if (held && !keeps) await held.unsubscribe();
  const sub = keeps
    ? held!
    : await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: asKey(config.public_key),
    });
  const keys = keysOf(sub);
  await api.post(SUBSCRIBE, { endpoint: sub.endpoint, keys });
  return { ok: true };
}

/** Silence this browser, here and at the server, in whichever order they work. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const sub = await (await worker()).pushManager.getSubscription();
    if (!sub) return;
    try {
      await api.post(UNSUBSCRIBE, { endpoint: sub.endpoint });
    } catch { /* the address is dropped below regardless; the server prunes it later */ }
    await sub.unsubscribe();
  } catch { /* nothing to undo */ }
}

/**
 * Re-file this browser under whoever is signed in now.
 *
 * A subscription outlives a session, and the address is the only handle there
 * is. Without this call the member who signs in on the family laptop in March
 * is still being told what the member who signed out of it in February reads.
 */
export async function syncPush(): Promise<void> {
  if (!API_ENABLED || !pushSupported() || Notification.permission !== 'granted') return;
  try {
    const sub = await (await worker()).pushManager.getSubscription();
    if (!sub) return;
    const keys = keysOf(sub);
    if (!keys.p256dh || !keys.auth) return;
    await api.post(SUBSCRIBE, { endpoint: sub.endpoint, keys });
  } catch (err) {
    // A seat that cannot file its own browser keeps the bell, which is the
    // whole product; push is the extra.
    if (!(err instanceof ApiError)) throw err;
  }
}
