'use client';

/**
 * Browser-side transport for the Django API.
 *
 * Requests go to `/api/*` on the Next origin and are proxied to Django by
 * next.config.js, so the HttpOnly auth cookies are first-party and need no CORS.
 * Unsafe calls replay the `exposing_csrf` cookie, every call carries the stable
 * device id used for trusted-device login, and a 401 refreshes once before retry.
 *
 * Every call also has a deadline, and one that gets no answer at all waits out a
 * sleeping server before it fails with a sentence — a spinner that never ends is
 * the worst error this app can produce, because it looks like the app is thinking.
 */

export class ApiError extends Error {
  status: number;
  data: any;
  /** The server's own handle for this call. Quoting it turns a log search from a
   *  guess into a lookup, so screens that show an error can show this too. */
  requestId = '';

  constructor(status: number, data: any) {
    super(data?.detail || data?.message || `Request failed (${status}).`);
    this.status = status;
    this.data = data || {};
  }

  get fieldErrors(): Record<string, string[]> {
    const { detail, message, offline, request_id, ...rest } = this.data || {};
    return rest;
  }
}

export const API_ENABLED = process.env.NEXT_PUBLIC_API !== 'off';

const DEVICE_KEY = 'exposing-device';

/**
 * A proxy timeout, a crashed worker or Django's own error page all answer with
 * HTML rather than JSON, and that markup would otherwise be pasted straight
 * into a form error line. Say what the user can act on, keep the body out.
 */
function readBody(text: string, ok: boolean, status: number): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    if (ok) return { detail: 'The server sent back something unreadable.' };
    if (status >= 500) return { detail: 'The server could not finish that request. Try again in a moment.' };
    if (status === 429) return { detail: 'Too many requests. Wait a moment and try again.' };
    if (status === 404) return { detail: 'The server has no answer at that address.' };
    return { detail: `Request failed (${status}).` };
  }
}
const CSRF_COOKIE = 'exposing_csrf';
const DEVICE_COOKIE = 'exposing_device';

function deviceCookie(): string {
  if (typeof document === 'undefined') return '';
  const pair = document.cookie.split('; ').find(c => c.startsWith(`${DEVICE_COOKIE}=`));
  return pair ? decodeURIComponent(pair.slice(DEVICE_COOKIE.length + 1)) : '';
}

/**
 * The id this browser is known by at the login door.
 *
 * localStorage answers fastest and outlives a sign-out, but WebKit throws away a
 * week of quiet tabs — the id inside them included — and the door then reads a
 * returning owner as a stranger arriving from nowhere. The server mirrors the id into
 * a first-party cookie with the seat's own lifetime, so the string survives the
 * storage it was minted in. Nothing here is allowed to fail a sign-in: storage can be
 * full, unreadable, or switched off, and a thrown exception would kill the call that
 * only needed a header.
 */
function deviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = '';
  try { id = localStorage.getItem(DEVICE_KEY) || ''; } catch { /* storage unreadable */ }
  if (!id) id = deviceCookie();
  if (!id) id = globalThis.crypto?.randomUUID?.() || `d${Date.now()}${Math.random().toString(36).slice(2)}`;
  try { localStorage.setItem(DEVICE_KEY, id); } catch { /* refused; the cookie still carries it */ }
  return id;
}

function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const pair = document.cookie.split('; ').find(c => c.startsWith(`${CSRF_COOKIE}=`));
  return pair ? decodeURIComponent(pair.slice(CSRF_COOKIE.length + 1)) : '';
}

type Query = Record<string, string | number | boolean | null | undefined>;

function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** What the server said about this session when we asked it to be extended. */
type RefreshOutcome = 'ok' | 'rejected' | 'unreachable';

let refreshing: Promise<RefreshOutcome> | null = null;

/** How long one call may take before the screen says so out loud. */
const TIMEOUT_MS = 12000;
/** A cold free-tier instance takes about this long to answer its first request. */
const WAKE_MS = 45000;
const PING_MS = 5000;
const POLL_MS = 2000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signing in again after a stall that was really a sleeping server costs a second
 * session row at worst, which beats refusing a password the user typed correctly.
 * Code entry is deliberately absent: its replay would present a spent one-time
 * code, and a comment replayed twice is a comment the author has to go delete.
 */
const REPLAYABLE_PATHS = new Set(['/api/auth/login/', '/api/auth/logout/', '/api/auth/refresh/']);

const wakeListeners = new Set<(waking: boolean) => void>();
let wakeUp: Promise<boolean> | null = null;
let lastWakeFail = 0;
/** After one failed wait, later calls fail fast for this long instead of each burning the full wait again. */
const WAKE_RETRY_MS = 30000;

/**
 * Watch for "the API is asleep" so a screen can say it instead of spinning.
 * Returns the unsubscribe.
 */
export function onWakeChange(listener: (waking: boolean) => void): () => void {
  wakeListeners.add(listener);
  return () => { wakeListeners.delete(listener); };
}

function ping(): Promise<boolean> {
  const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(PING_MS) : undefined;
  // /api/ping/ and not /api/health/: this runs every two seconds for up to a
  // minute while a cold instance starts, and the deep probe reads the database,
  // the cache and the disk on every one of those polls.
  return fetch('/api/ping/', { credentials: 'same-origin', signal })
    .then(res => res.ok)
    .catch(() => false);
}

/**
 * Wait out a cold start, with every screen told why the button still reads
 * "Checking…". One poll runs at a time however many calls are waiting on it.
 * A wait that just failed buys nothing from a second one half a minute later:
 * those calls fail at once so a tap doesn't cost 45 seconds of pinging a
 * server that already said no.
 */
function wake(): Promise<boolean> {
  if (!wakeUp) {
    if (Date.now() - lastWakeFail < WAKE_RETRY_MS) return Promise.resolve(false);
    wakeUp = (async () => {
      wakeListeners.forEach(fn => fn(true));
      const deadline = Date.now() + WAKE_MS;
      try {
        while (Date.now() < deadline) {
          if (await ping()) return true;
          await new Promise(resolve => setTimeout(resolve, POLL_MS));
        }
        lastWakeFail = Date.now();
        return false;
      } finally {
        wakeListeners.forEach(fn => fn(false));
        wakeUp = null;
      }
    })();
  }
  return wakeUp;
}

/** Django answers every failure with JSON, so anything else is a proxy talking. */
async function classifyRefresh(res: Response): Promise<RefreshOutcome> {
  if (res.ok) return 'ok';
  const text = await res.text();
  // A 429 is "ask again in a moment", never "this session is over", and the ceiling
  // it counts is the address this connection came from — which a mobile carrier or
  // a relay hands to a thousand browsers at once. Reading one as a refusal threw the
  // 401 onward and ended a seat that was still good.
  if (res.status === 429 || res.status >= 500 || !text.trimStart().startsWith('{')) return 'unreachable';
  return 'rejected';
}

/**
 * Ask for a new pair of cookies, and keep the three answers distinct. A refresh
 * that was never answered says nothing about whether this session is still
 * valid, and pretending otherwise is what logged people out of a good session
 * every time the server took a nap.
 */
function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshing) {
    refreshing = attempt('/api/auth/refresh/', { method: 'POST' }, TIMEOUT_MS)
      .then(classifyRefresh)
      .catch(() => 'unreachable' as const)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/**
 * fetch with a deadline. A hung request is what left people staring at
 * "Checking…" until they closed the tab: without an abort there is no failure to
 * report, and a spinner has no way to end.
 */
async function attempt(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return await fetch(path, { ...init, credentials: 'same-origin', signal: controller.signal });
  } catch (err) {
    if (err instanceof Error) (err as Error & { timedOut?: boolean }).timedOut = timedOut;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The two ways a call can end with nothing to show for it. */
function offline(timedOut: boolean): ApiError {
  return new ApiError(0, {
    offline: true,
    detail: timedOut
      ? 'The server is taking too long to answer. Check your connection and try again.'
      : 'The server is not answering right now. Wait a few seconds and try again.',
  });
}

/**
 * A replay after a refresh has to carry what the browser holds now. The headers a
 * call left with were built before the sign-in dance handed out a CSRF cookie, so
 * sending them again is a 403 that never stops arriving — and only the two auth
 * headers change under a refresh. Content-Type and the body ride along untouched.
 */
function reauthorized(init: RequestInit): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...headers() } };
}

/**
 * Send, and make sure the wait has an ending.
 *
 * A 5xx whose body is not JSON was not written by this API — Django answers every
 * failure with JSON — so it is the proxy talking for a server that was not there,
 * which is exactly what a sleeping instance looks like from a browser.
 */
async function send(path: string, init: RequestInit, refresh = true, replay = true): Promise<any> {
  let res: Response | null = null;
  let timedOut = false;
  try {
    res = await attempt(path, init, TIMEOUT_MS);
  } catch (err) {
    timedOut = !!(err as (Error & { timedOut?: boolean }))?.timedOut;
  }

  let data: any = null;
  let fromApi = false;
  if (res) {
    const text = await res.text();
    fromApi = !!text && text.trim().startsWith('{');
    if (text) data = readBody(text, res.ok, res.status);
  }
  const unanswered = res === null || (res.status >= 500 && !fromApi);
  if (unanswered && replay) {
    // A call that ran to its own timeout may already have been carried out, so a
    // write is replayed only when the proxy answered for a server that never saw it.
    const method = (init.method || 'GET').toUpperCase();
    const replayable = res !== null || !timedOut || SAFE_METHODS.has(method) || REPLAYABLE_PATHS.has(path.split('?')[0]);
    if (!replayable || !(await wake())) throw offline(timedOut);
    return send(path, init, refresh, false);
  }
  if (!res) throw offline(timedOut);

  // /api/auth/me/ is the one auth call that must refresh: it is how a reload
  // finds out who is signed in, and refusing to extend the session there is what
  // left a perfectly live seat reading as a signed-out page for 15 minutes.
  const refreshable = refresh && res.status === 401 && (!path.startsWith('/api/auth/') || path === '/api/auth/me/');
  if (refreshable) {
    const outcome = await refreshSession();
    if (outcome === 'ok') return send(path, reauthorized(init), false, replay);
    // Nobody answered, so nobody said this session is over: report the network
    // and leave the signed-in state alone rather than throwing the 401 onward.
    if (outcome === 'unreachable') throw offline(false);
  }
  if (!res.ok) {
    const error = new ApiError(res.status, data);
    error.requestId = res.headers.get('x-request-id') || (data?.request_id ?? '');
    throw error;
  }
  return data;
}

function headers(extra?: Record<string, string>, safe = false): Record<string, string> {
  const id = deviceId();
  const out: Record<string, string> = { ...(extra || {}) };
  if (id) out['X-Device-Id'] = id;
  if (!safe && csrfToken()) out['X-CSRF-Token'] = csrfToken();
  return out;
}

export interface Page<T> {
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export const api = {
  get: <T = any>(path: string, query?: Query) =>
    send(withQuery(path, query), { method: 'GET', headers: headers(undefined, true) }),

  post: <T = any>(path: string, body?: any) =>
    send(path, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    }),

  patch: <T = any>(path: string, body?: any) =>
    send(path, {
      method: 'PATCH',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body ?? {}),
    }),

  del: <T = any>(path: string, body?: any) =>
    send(path, {
      method: 'DELETE',
      headers: body === undefined ? headers() : headers({ 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  /**
   * Multipart upload to /api/uploads/ — returns { url, kind, bytes }.
   *
   * XHR rather than fetch: fetch reports no upload progress at all, and a clip
   * of several megabytes deserves a bar that moves with the bytes actually sent.
   * The timeout is minutes because a real clip on a real phone network takes
   * minutes — it is only there so a stall ends with a sentence, not a spinner.
   */
  upload: (file: File | Blob, onProgress?: (sent: number, total: number) => void): Promise<any> =>
    new Promise((resolve, reject) => {
      const go = (retry: boolean) => {
        const form = new FormData();
        form.append('file', file, (file as File).name || 'upload');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/uploads/', true);
        xhr.withCredentials = true;
        xhr.timeout = UPLOAD_TIMEOUT_MS;
        Object.entries(headers()).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        xhr.upload.onprogress = e => {
          if (onProgress && e.lengthComputable) onProgress(e.loaded, e.total);
        };
        const fail = (status: number, data: any) => {
          const error = new ApiError(status, data);
          error.requestId = xhr.getResponseHeader('x-request-id') || '';
          reject(error);
        };
        xhr.onload = () => {
          const data = readBody(xhr.responseText || '', xhr.status < 400, xhr.status);
          if (xhr.status >= 400) {
            if (retry && xhr.status === 401) {
              void refreshSession().then(outcome => (outcome === 'ok' ? go(false) : fail(xhr.status, data)));
              return;
            }
            fail(xhr.status, data);
            return;
          }
          resolve(data);
        };
        xhr.onerror = () => fail(0, { detail: 'The upload could not reach the server.' });
        xhr.ontimeout = () => fail(0, { detail: 'The upload timed out. Try again on a better connection.' });
        xhr.onabort = () => fail(0, { detail: 'Upload cancelled.' });
        xhr.send(form);
      };
      go(true);
    }),

  deviceId,
};
