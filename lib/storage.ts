import { Database } from './types';
import { KEY } from './utils';
import { seed } from './seed';

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
  const d = load() || seed();
  if (!d.seedVersion) {
    const fresh = seed();
    const existing = new Set(d.comments.map(c => c.id));
    const added = fresh.comments.filter(c => c.parentId && !existing.has(c.id));
    const addedIds = new Set(added.map(c => c.id));
    d.comments = [...d.comments, ...added];
    d.reactions = [...d.reactions, ...fresh.reactions.filter(r => addedIds.has(r.targetId) && !d.reactions.some(x => x.id === r.id))];
    d.seedVersion = 2;
  }
  return d;
}
