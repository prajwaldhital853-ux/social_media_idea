import { Database } from './types';
import { KEY } from './utils';
import { seed, defaultSettings } from './seed';

export function load(): Database | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && d.users && d.posts && d.follows && d.settings && d.settings.features) return d;
    }
  } catch (e) {
    console.error('Failed to load from localStorage:', e);
  }
  return null;
}

export function save(db: Database): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const copy = JSON.parse(JSON.stringify(db, (k, v) => {
      return (k === 'src' && typeof v === 'string' && v.indexOf('blob:') === 0) ? undefined : v;
    }));
    copy.posts.forEach((p: any) => {
      p.media = (p.media || []).filter((m: any) => m.src || m.gen || m.blobId);
    });
    localStorage.setItem(KEY, JSON.stringify(copy));
    return true;
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
    return false;
  }
}

export function getDb(): Database {
  const d = load();
  if (!d || d.seedVersion !== 3) return seed();
  return d;
}

/**
 * The cache an API-backed session starts from: shaped like a full database so
 * every synchronous reader keeps working until /api/sync/ fills it in.
 */
export function emptyDb(): Database {
  return {
    users: [],
    posts: [],
    comments: [],
    follows: [],
    reactions: [],
    saves: [],
    listingSaves: [],
    notifications: [],
    messages: [],
    listings: [],
    coinRequests: [],
    ledger: [],
    promotions: [],
    reports: [],
    audit: [],
    settings: defaultSettings(),
    meId: null,
    // The stored language is applied after mount, never here: this object is also
    // what the server renders, and reading localStorage would mismatch the markup.
    lang: 'en',
  };
}
