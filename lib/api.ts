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

function deviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `d${Date.now()}${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(DEVICE_KEY, id);
  }
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

let refreshing: Promise<boolean> | null = null;

/** How long one call may take before the screen says so out loud. */
const TIMEOUT_MS = 12000;
/** A cold free-tier instance takes about this long to answer its first request. */
const WAKE_MS = 45000;
const PING_MS = 5000;
const POLL_MS = 2000;
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const wakeListeners = new Set<(waking: boolean) => void>();
let wakeUp: Promise<boolean> | null = null;

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
  return fetch('/api/health/', { credentials: 'same-origin', signal })
    .then(res => res.ok)
    .catch(() => false);
}

/**
 * Wait out a cold start, with every screen told why the button still reads
 * "Checking…". One poll runs at a time however many calls are waiting on it.
 */
function wake(): Promise<boolean> {
  if (!wakeUp) {
    wakeUp = (async () => {
      wakeListeners.forEach(fn => fn(true));
      const deadline = Date.now() + WAKE_MS;
      try {
        while (Date.now() < deadline) {
          if (await ping()) return true;
          await new Promise(resolve => setTimeout(resolve, POLL_MS));
        }
        return false;
      } finally {
        wakeListeners.forEach(fn => fn(false));
        wakeUp = null;
      }
    })();
  }
  return wakeUp;
}

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = attempt('/api/auth/refresh/', { method: 'POST' }, TIMEOUT_MS)
      .then(res => res.ok)
      .catch(() => false)
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
    const replayable = res !== null || !timedOut || SAFE_METHODS.has((init.method || 'GET').toUpperCase());
    if (!replayable || !(await wake())) throw offline(timedOut);
    return send(path, init, refresh, false);
  }
  if (!res) throw offline(timedOut);

  const refreshable = refresh && res.status === 401 && !path.startsWith('/api/auth/');
  if (refreshable && await refreshSession()) {
    return send(path, init, false, replay);
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
              void refreshSession().then(ok => (ok ? go(false) : fail(xhr.status, data)));
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
