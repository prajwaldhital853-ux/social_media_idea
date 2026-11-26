import { Database, User } from './types';

/**
 * The client cache that components render from.
 *
 * `merge` applies a server fragment onto the cache: entities are upserted by id,
 * edges (follows, reactions) by their natural key, and the save lists are
 * replaced because the server sends the whole set. Nothing here knows about
 * HTTP — it only keeps the view-model consistent when a page arrives, possibly
 * for a second or third time with different counters.
 */

export type Fragment = Partial<Pick<
  Database,
  | 'users' | 'posts' | 'comments' | 'listings' | 'reactions' | 'promotions'
  | 'notifications' | 'messages' | 'follows' | 'reports' | 'audit' | 'ledger'
  | 'coinRequests' | 'saves' | 'listingSaves'
>> & {
  /** The account row this seat just wrote, blanks and all. */
  saved?: User[];
};

function byId<T extends { id: string }>(existing: T[], incoming: T[], keep?: (a: T, b: T) => T): T[] {
  const index = new Map(existing.map(row => [row.id, row] as [string, T]));
  for (const row of incoming) {
    const current = index.get(row.id) as any;
    index.set(row.id, (current && keep ? keep(current, row) : row) as any);
  }
  return Array.from(index.values());
}

/**
 * A thin person card (feed author, follower row) must not wipe the richer
 * record the session already holds — only non-empty fields carry over.
 */
function keepProfile(current: User, incoming: User): User {
  const merged: any = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === '' || value === null || value === undefined) continue;
    if (key === 'coins' && !value) continue;
    merged[key] = value;
  }
  return merged as User;
}

function upsertBy<T extends Record<string, any>>(existing: T[], incoming: T[], keys: string[]): T[] {
  const keyOf = (row: T) => keys.map(k => String(row[k] ?? '')).join('|');
  const index = new Map(existing.map(row => [keyOf(row), row] as [string, T]));
  for (const row of incoming) index.set(keyOf(row), row);
  return Array.from(index.values());
}

export function merge(db: Database, frag: Fragment): Database {
  const next: Database = { ...db };
  if (frag.users) next.users = byId(db.users, frag.users, keepProfile) as User[];
  // A row the seat just wrote is taken as it came back, empty values included.
  // `keepProfile` is there so a thin card cannot erase a richer record, but the
  // answer to a PATCH is not a card that forgot a field — a cleared cover and a
  // blank bio are the whole point of the write, and skipping them left the old
  // picture on the screen no matter what the server had just agreed to.
  if (frag.saved) next.users = byId(next.users, frag.saved) as User[];
  if (frag.posts) next.posts = byId(db.posts, frag.posts);
  if (frag.comments) next.comments = byId(db.comments, frag.comments);
  if (frag.listings) next.listings = byId(db.listings, frag.listings);
  if (frag.promotions) next.promotions = byId(db.promotions, frag.promotions);
  if (frag.notifications) next.notifications = byId(db.notifications, frag.notifications);
  if (frag.messages) next.messages = byId(db.messages, frag.messages);
  if (frag.reports) next.reports = byId(db.reports, frag.reports);
  if (frag.audit) next.audit = byId(db.audit, frag.audit);
  if (frag.coinRequests) next.coinRequests = byId(db.coinRequests, frag.coinRequests);
  if (frag.reactions) next.reactions = upsertBy(db.reactions, frag.reactions, ['targetType', 'targetId', 'uid']);
  if (frag.follows) next.follows = upsertBy(db.follows, frag.follows, ['follower', 'following']);
  if (frag.saves) next.saves = frag.saves;
  if (frag.listingSaves) next.listingSaves = frag.listingSaves;
  // Upserted, not replaced: the ledger arrives one keyset page at a time, and
  // page two must not drop the rows page one already showed.
  if (frag.ledger) next.ledger = byId(db.ledger, frag.ledger);
  return next;
}
