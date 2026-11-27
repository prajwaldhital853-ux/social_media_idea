import { api, ApiError } from './api';

/**
 * Web Push for a staff seat.
 *
 * The console is its own origin, so it holds its own browser address at the
 * push service and its own worker — a seat that switched alerts on at the
 * member site is not thereby switched on here, and the server keeps the two
 * addresses apart the same way it keeps the two trays apart.
 *
 * The permission belongs to the browser and the server only holds the address,
 * so every function here reads the browser first and never assumes that what
 * the screen shows is what the operating system will allow.
 */

const SW_PATH = '/sw.js';
// Under `admin/`, not `notifications/`: a seat that holds a job is read as
// nobody at every member door, so the console files its browser at its own.
const CONFIG = 'admin/push/config/';
const SUBSCRIBE = 'admin/push/subscribe/';
const UNSUBSCRIBE = 'admin/push/unsubscribe/';
// The ask is remembered per browser: Chrome shows its prompt a couple of times
// and then refuses the origin outright for a console that keeps knocking.
const ASKED = 'exposing.console.asked';
// And so is a switch the seat turned off by hand, which arrival must not undo.
const MUTED = 'exposing.console.muted';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported';

/** The two flags live in storage that a private window can refuse to give. */
function read(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function remember(key: string): void {
  try {
    window.localStorage.setItem(key, '1');
  } catch { /* nothing kept, so the next load simply asks again */ }
}

function forget(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch { /* nothing kept in the first place */ }
}

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

/** Whether the switch should read as on, read from the browser rather than the server. */
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

async function hasAddress(): Promise<boolean> {
  try {
    return !!(await (await worker()).pushManager.getSubscription());
  } catch {
    return false;
  }
}

/**
 * Chrome answers a permission call from a page nobody is looking at with a
 * refusal the seat never saw, so the arrival ask waits for the tab to come
 * forward rather than burning the shot the origin gets.
 */
function untilVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise(resolve => {
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', wake);
      resolve();
    };
    document.addEventListener('visibilitychange', wake);
  });
}

/**
 * Ask, subscribe, hand the address over.
 *
 * Nothing here throws: a browser that will not register its worker, or a server
 * that is briefly unreachable, has to come back as an answer the screen can
 * show. A click whose promise rejects leaves the button switched off forever,
 * which reads to a seat as a control that does nothing.
 */
export async function enablePush(): Promise<{ ok: boolean; detail?: string }> {
  if (!pushSupported()) return { ok: false, detail: 'This browser cannot receive notifications.' };
  if (Notification.permission === 'denied') {
    return { ok: false, detail: 'Notifications are blocked for this site. Allow them in the address bar.' };
  }
  try {
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { ok: false, detail: 'Notifications were not allowed.' };
    }
    const config = await api<{ enabled: boolean; public_key: string }>(CONFIG);
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
    await api(SUBSCRIBE, { method: 'POST', body: { endpoint: sub.endpoint, keys: keysOf(sub) } });
    forget(MUTED);
    return { ok: true };
  } catch {
    return { ok: false, detail: 'This browser would not take the address. Try again.' };
  }
}

/**
 * Turn alerts on as soon as the console is open.
 *
 * A seat that already holds the right is re-filed and never re-asked, a seat
 * that was asked once is not asked again, and a browser whose switch was turned
 * off by hand stays off.
 */
export async function autoPush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted') {
    if (read(MUTED)) return 'off';
    await syncPush();
    if (await hasAddress()) return 'on';
    return (await enablePush()).ok ? 'on' : 'off';
  }
  if (read(ASKED)) return 'off';
  await untilVisible();
  remember(ASKED);
  return (await enablePush()).ok ? 'on' : 'off';
}

/** Remember that this browser was switched off by hand, so arrival leaves it be. */
export function mutePush(): void {
  remember(MUTED);
}

/** Silence this browser, here and at the server, in whichever order they work. */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const sub = await (await worker()).pushManager.getSubscription();
    if (!sub) return;
    try {
      await api(UNSUBSCRIBE, { method: 'POST', body: { endpoint: sub.endpoint } });
    } catch { /* the address is dropped below regardless; the server prunes it later */ }
    await sub.unsubscribe();
  } catch { /* nothing to undo */ }
}

/**
 * Re-file this browser under whoever is signed in now.
 *
 * A subscription outlives a session. Without this, the console that a second
 * staff member opens on the same machine would keep waking the person who left.
 */
export async function syncPush(): Promise<void> {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  try {
    const sub = await (await worker()).pushManager.getSubscription();
    if (!sub) return;
    const keys = keysOf(sub);
    if (!keys.p256dh || !keys.auth) return;
    await api(SUBSCRIBE, { method: 'POST', body: { endpoint: sub.endpoint, keys } });
  } catch (err) {
    // A seat that cannot file its own browser keeps the tray, which is the
    // whole product; push is the extra.
    if (!(err instanceof ApiError)) throw err;
  }
}
