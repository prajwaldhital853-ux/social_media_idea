import { GateCode } from './types';

export class ApiError extends Error {
  code: GateCode | string;
  status: number;
  data: Record<string, any>;

  constructor(message: string, code: string, status: number, data: Record<string, any>) {
    super(message);
    this.code = code;
    this.status = status;
    this.data = data;
  }
}

/**
 * The double-submit token the API's security middleware expects on writes.
 *
 * `exposing_csrf` is deliberately readable — it is not a credential, only a
 * proof that this page and the cookie came from the same origin. Sending it on
 * every write, whether or not a session exists yet, is what lets a staff member
 * who is already browsing the site sign in to the console without a 403.
 */
function csrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/(?:^|;\s*)exposing_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method || 'GET';
  const init: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() }),
    },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);

  const response = await fetch(`/api/${path.replace(/^\/+/, '')}`, init);
  const text = await response.text();
  const data = text ? safeParse(text) : {};

  if (!response.ok) {
    throw new ApiError(
      String(data.detail || `The request failed (${response.status}).`),
      String(data.code || 'error'),
      response.status,
      data,
    );
  }
  return data as T;
}

function safeParse(text: string): Record<string, any> {
  try {
    return JSON.parse(text);
  } catch {
    // An HTML error page from the proxy is still an answer the UI has to show.
    return { detail: text.slice(0, 200) };
  }
}
