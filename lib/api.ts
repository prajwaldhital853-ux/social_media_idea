'use client';

/**
 * Browser-side transport for the Django API.
 *
 * Requests go to `/api/*` on the Next origin and are proxied to Django by
 * next.config.js, so the HttpOnly auth cookies are first-party and need no CORS.
 * Unsafe calls replay the `exposing_csrf` cookie, every call carries the stable
 * device id used for trusted-device login, and a 401 refreshes once before retry.
 */

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, data: any) {
    super(data?.detail || data?.message || `Request failed (${status}).`);
    this.status = status;
    this.data = data || {};
  }

  get fieldErrors(): Record<string, string[]> {
    const { detail, message, ...rest } = this.data || {};
    return rest;
  }
}

export const API_ENABLED = process.env.NEXT_PUBLIC_API !== 'off';

const DEVICE_KEY = 'exposing-device';
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

async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = rawFetch('/api/auth/refresh/', { method: 'POST' })
      .then(res => res.ok)
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(path, { ...init, credentials: 'same-origin' });
}

async function send(path: string, init: RequestInit, retry = true): Promise<any> {
  const res = await rawFetch(path, init);
  const refreshable = retry && res.status === 401 && !path.startsWith('/api/auth/');
  if (refreshable && await refreshSession()) {
    return send(path, init, false);
  }
  let data: any = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { detail: text }; }
  }
  if (!res.ok) throw new ApiError(res.status, data);
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

  /** Multipart upload to /api/uploads/ — returns { url, kind, bytes }. */
  upload: (file: File | Blob) => {
    const form = new FormData();
    form.append('file', file, (file as File).name || 'upload');
    return send('/api/uploads/', { method: 'POST', headers: headers(), body: form });
  },

  deviceId,
};
