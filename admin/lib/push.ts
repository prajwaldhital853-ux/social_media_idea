import { api } from './api';

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
// The ask is remembered for the browsing session, not forever: a desktop Chrome
// that dismissed the bubble once is still asked the next time the browser is
// started. Chrome stops drawing a bubble for a site that is told no repeatedly,
// so this cannot turn into nagging.
const ASKED = 'exposing.console.asked';
// A switch the seat turned off by hand is remembered the same way, so arrival
// does not quietly undo it — and so the next start of the browser is default-on
// again. The permanent answer is the operating system's.
const MUTED = 'exposing.console.muted';

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported';

/** The flags live in storage a private window can refuse to give. */
function read(store: Storage, key: string): boolean {
  try {
    return store.getItem(key) === '1';
  } catch {
    return false;
  }
}

function remember(store: Storage, key: string): void {
  try {
    store.setItem(key, '1');
  } catch { /* nothing kept, so the next load simply asks again */ }
}

function forget(store: Storage, key: string): void {
  try {
    store.removeItem(key);
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

/**
 * Whether the switch should read as on — read from the browser, then confirmed
 * by the server: one browser files one address for every seat living in it, so
 * an address the browser can see may belong to whoever signed in last. A switch
 * lit over an address that points elsewhere is a switch that lies twice.
 */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const held = await (await worker()).pushManager.getSubscription();
    if (!held) return 'off';
    const config = await api<{ filed: boolean }>(
      `${CONFIG}?endpoint=${encodeURIComponent(held.endpoint)}`,
    );
    return config.filed ? 'on' : 'off';
  } catch (err) {
    console.warn('[push] could not read the switch:', err);
    return 'off';
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
    forget(window.sessionStorage, MUTED);
    return { ok: true };
  } catch (err) {
    // A swallowed failure is why "the switch is lit but nothing arrives" could
    // never be diagnosed: a refused subscribe left no trace anywhere.
    console.warn('[push] could not file this browser:', err);
    const refused = err instanceof DOMException && err.name === 'NotAllowedError';
    return {
      ok: false,
      detail: refused
        ? 'The browser or Windows refused it. Check the site permission in the address bar and the notification switch Windows holds for this browser.'
        : 'This browser would not take the address. Try again.',
    };
  }
}

/**
 * Turn alerts on as soon as the console is open.
 *
 * A seat that already holds the right is re-filed and never re-asked, a seat
 * that was asked in this session is not asked again, and a browser whose switch
 * was turned off by hand stays off.
 */
export async function autoPush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted') {
    // Held already, including by a seat that allowed it from the address bar
    // without touching this console. Taking the address rather than merely
    // re-filing the old one is what repairs an address filed under a key that
    // has since changed.
    if (read(window.sessionStorage, MUTED)) return 'off';
    return (await enablePush()).ok ? 'on' : 'off';
  }
  if (read(window.sessionStorage, ASKED)) return 'off';
  await untilVisible();
  remember(window.sessionStorage, ASKED);
  return (await enablePush()).ok ? 'on' : 'off';
}

/**
 * Tell the worker which seat this tab holds.
 *
 * One browser runs one worker for every seat signed in on it, and a worker that
 * is not told whose card it is drawing swallows a notice meant for the seat that
 * is away because another seat's tab happens to be visible.
 */
export function announceSeat(username: string): void {
  if (!pushSupported() || !username) return;
  try {
    navigator.serviceWorker.getRegistration().then((reg) => {
      // A worker that is still starting takes the message too and keeps it
      // through activation, which is the common case right after the address is
      // taken for the first time.
      const target = reg && (reg.active || reg.waiting || reg.installing);
      if (target) target.postMessage({ user: username });
    }).catch(() => { /* no worker yet, so nothing is filed either */ });
  } catch { /* nothing to tell */ }
}

/** Remember that this browser was switched off by hand, so arrival leaves it be. */
export function mutePush(): void {
  remember(window.localStorage, MUTED);
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
