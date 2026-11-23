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
  return send<T>(path, init);
}

/**
 * Multipart writes — the payment QR is an image, and a JSON body cannot carry one.
 * The browser sets the content type itself, so only the CSRF proof is added.
 */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  return send<T>(path, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
    body: form,
  });
}

/** What the browser was actually handed, read back out of the file's own headers. */
export interface SavedFile {
  filename: string;
  rows: number;
  truncated: boolean;
  detail: string;
  bytes: number;
  /** The header line, so a seat sees the columns before an accountant does. */
  head: string;
}

/**
 * Build a CSV and give it to the browser as a file.
 *
 * The door answers as the file itself (`?raw=1`), so the name, the row count and the
 * truncation warning are read out of the response headers the server set rather than
 * repeated from what the screen already knew. A download that cannot be described
 * afterwards is a download nobody can prove they handed over.
 */
export async function saveFile(path: string, body: Record<string, unknown> = {}): Promise<SavedFile> {
  const response = await fetch(`/api/${path.replace(/^\/+/, '')}?raw=1`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      // Both media types, not just the file. This door answers as the CSV only when
      // `?raw=1` is on the URL and as JSON every other time, and DRF negotiates the
      // Accept header *before* the view runs: a request that offers only `text/csv`
      // is refused with a 406 of its own, which swallows the file, the row counts,
      // and every plain sentence the door would have said about a bad date.
      Accept: 'text/csv, application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = `The file could not be built (${response.status}).`;
    let code = 'error';
    try {
      const data = JSON.parse(text);
      detail = String(data.detail || detail);
      code = String(data.code || code);
    } catch {
      detail = text.slice(0, 200) || detail;
    }
    throw new ApiError(detail, code, response.status, {});
  }
  const named = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '');
  const filename = named ? named[1] : 'export.csv';
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on a delay: a URL freed in the same tick as the click has taken the
  // file away from the browser before it finished saving it.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return {
    filename,
    rows: Number(response.headers.get('X-Export-Rows') || 0),
    truncated: response.headers.get('X-Export-Truncated') === '1',
    detail: response.headers.get('X-Export-Detail') || '',
    bytes: text.length,
    head: text.split('\n')[0] || '',
  };
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
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
