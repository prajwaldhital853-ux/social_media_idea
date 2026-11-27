import { api, API_ENABLED } from './api';

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
const CONFIG = '/api/notifications/push/config/';
// The ask is remembered for the browsing session, not forever: a desktop Chrome
// that dismissed the bubble once still gets asked the next time the browser is
// started, which is what a site that wants alerts awake means. Chrome itself
// stops showing a bubble to a site that knocks too often, so this cannot nag.
const ASKED = 'exposing.push.asked';
// A switch the member turned off by hand is remembered for the session, so the
// arrival ask does not quietly undo it — and so the next start of the browser is
// default-on again, which is what the site wants. The permanent answer is the
// operating system's: block the site there and the switch reads blocked.
const MUTED = 'exposing.push.muted';

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
 * Chrome answers a permission call from a page nobody is looking at with a
 * refusal the member never saw, so the arrival ask waits for the tab to come
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
 * that is briefly unreachable, has to come back as an answer the switch can
 * show. A click whose promise rejects leaves the switch frozen mid-click, which
 * reads to the member as a control that does nothing.
 */
export async function enablePush(): Promise<{ ok: boolean; detail?: string }> {
  if (!pushSupported()) return { ok: false, detail: 'This browser cannot receive notifications.' };
  if (!API_ENABLED) return { ok: false, detail: 'Push needs the server.' };
  if (Notification.permission === 'denied') {
    return { ok: false, detail: 'Notifications are blocked for this site. Allow them in the address bar.' };
  }
  try {
    if (Notification.permission !== 'granted') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { ok: false, detail: 'Notifications were not allowed.' };
    }
    const config = await api.get<{ enabled: boolean; public_key: string }>(CONFIG);
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
    await api.post(SUBSCRIBE, { endpoint: sub.endpoint, keys: keysOf(sub) });
    forget(window.sessionStorage, MUTED);
    return { ok: true };
  } catch {
    return { ok: false, detail: 'This browser would not take the address. Try again.' };
  }
}

/**
 * Turn alerts on as soon as the site is open.
 *
 * The member's ask is that Exposing want the right up front instead of leaving
 * it to be found in Settings. What keeps that from turning into nagging: a
 * browser that already holds the right is re-filed rather than re-asked, a
 * hidden tab is left alone until it comes forward, and a tab that has been
 * asked in this session is not asked a second time.
 */
export async function autoPush(): Promise<PushState> {
  if (!pushSupported() || !API_ENABLED) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted') {
    // The right is already held — including by a member who allowed it from the
    // address bar without ever finding the switch, which is the case the old
    // switch used to get wrong. Take the address under the key held now and
    // point it at whoever is signed in, which is also what repairs an address
    // left behind by a key that has since changed.
    if (read(window.sessionStorage, MUTED)) return 'off';
    return (await enablePush()).ok ? 'on' : 'off';
  }
  // Nothing answered yet, so ask. Once per session is enough for one visit;
  // Chrome stops drawing the bubble for a site that is told no repeatedly, so
  // the next browser start is the honest place to try again.
  if (read(window.sessionStorage, ASKED)) return 'off';
  await untilVisible();
  remember(window.sessionStorage, ASKED);
  return (await enablePush()).ok ? 'on' : 'off';
}

/**
 * Tell the worker which account this tab holds.
 *
 * One browser is one worker, and a worker that cannot tell whose tab is in
 * front of it swallows a card meant for the member who is away because somebody
 * else's tab happens to be visible.
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
    }).catch(() => { /* no worker yet: nothing is filed either */ });
  } catch { /* nothing to tell */ }
}

/** Remember that this tab turned alerts off by hand, so arrival leaves it be. */
export function mutePush(): void {
  remember(window.sessionStorage, MUTED);
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
