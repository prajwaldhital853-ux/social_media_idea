'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api, API_ENABLED } from './api';
import {
  mapCoinRequest, mapComment, mapLedger, mapListing, mapMessage, mapNotification, mapPerson,
  mapPost, mapPromotion, reactionsOfComment, reactionsOfPost, idOf,
} from './dto';
import { Fragment } from './store';
import { User } from './types';

/**
 * Server-backed lists.
 *
 * A list is a keyset-paginated endpoint whose rows are merged into the `db`
 * cache; the hook keeps only the ordered ids and the cursor per (key, query),
 * so screens render entities from the cache and paginate from the server.
 */

export type Query = Record<string, string | number | boolean | null | undefined>;

/** How a re-read of page one treats the rows already on screen. */
type Mode = 'append' | 'refresh' | 'rebuild';

export interface ListDef {
  path: string;
  frag: (rows: any[]) => Fragment;
  ids?: (rows: any[]) => string[];
}

export interface ListState {
  ids: string[];
  cursor: string | null;
  loaded: boolean;
  done: boolean;
  loading: boolean;
  /** A re-read of page one while the previous rows stay on screen. */
  refreshing: boolean;
  error: string | null;
}

const IDLE: ListState = { ids: [], cursor: null, loaded: false, done: false, loading: false, refreshing: false, error: null };

const states = new Map<string, ListState>();
const listeners = new Set<() => void>();
let apply: ((frag: Fragment) => void) | null = null;

export function bindListCache(fn: (frag: Fragment) => void): () => void {
  apply = fn;
  return () => { if (apply === fn) apply = null; };
}

function emit(): void {
  listeners.forEach(l => l());
}

function set(key: string, patch: Partial<ListState>): void {
  states.set(key, { ...(states.get(key) || IDLE), ...patch });
  emit();
}

function stateKey(key: string, query?: Query): string {
  const params = new URLSearchParams();
  // Sorted, so the same filter written in any order names the same list.
  Object.entries(query || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([k, v]) => params.set(k, String(v)));
  const qs = params.toString();
  return qs ? `${key}?${qs}` : key;
}

function snapshot(key: string): ListState {
  return states.get(key) || IDLE;
}

export function forgetLists(prefix?: string): void {
  Array.from(states.keys()).forEach(key => {
    if (!prefix || key === prefix || key.startsWith(`${prefix}?`)) states.delete(key);
  });
  emit();
}

/**
 * List defs are written as endpoint paths (`/feed/`); the HTTP client speaks
 * full `/api/*` paths, so every page request is normalised here rather than at
 * the dozen call sites that would otherwise have to remember the prefix.
 */
function apiPath(path: string): string {
  if (path.startsWith('/api/')) return path;
  return `/api${path.startsWith('/') ? path : `/${path}`}`;
}

async function fetchPage(key: string, def: ListDef, query: Query | undefined, cursor: string | null, mode: Mode = 'append'): Promise<void> {
  // A demo build has no server of its own: fetching anyway would merge real
  // rows into the seeded cache and hand screens people the demo never had.
  const before = snapshot(key);
  if (!API_ENABLED || before.loading || before.refreshing) return;
  // A refresh is deliberately not a `loading` transition: `loading` is what
  // every screen reads to decide whether to show a skeleton, and re-running
  // the first page has to leave the rows already on screen alone.
  //
  // A rebuild is the opposite on purpose: it empties the list first, so the
  // screen trades the rows the reader was looking at for its own skeleton and
  // what lands underneath is the newest page. That is what makes releasing a
  // pull read as an answer rather than as a spinner that changed nothing.
  set(key, mode === 'append'
    ? { loading: true, error: null }
    : mode === 'refresh'
      ? { refreshing: true, error: null }
      : { ids: [], cursor: null, loaded: false, done: false, loading: true, refreshing: false, error: null });
  try {
    const page = await api.get<{ results: any[]; next_cursor: string | null; has_more: boolean }>(
      apiPath(def.path),
      { ...(query || {}), cursor: cursor || undefined },
    );
    const rows = page.results || [];
    if (apply) apply(def.frag(rows));
    const ids = (def.ids || (r => r.map(row => idOf(row.id))))(rows);
    const prev = snapshot(key).ids;
    set(key, {
      // A refresh answers with page one, so it replaces; a later page appends.
      ids: cursor ? [...prev, ...ids.filter(id => !prev.includes(id))] : ids,
      cursor: page.next_cursor || null,
      done: !page.has_more,
      loaded: true,
      loading: false,
      refreshing: false,
    });
  } catch (err: any) {
    const message = err?.message || 'Could not load this list.';
    // A rebuild emptied the rows on purpose, so a failed one puts back what the
    // reader was looking at and keeps quiet about it: the HTTP client has
    // already said the failure out loud, and an error line over a page that
    // still reads fine is worse than a page that is a beat stale.
    if (mode === 'rebuild' && before.ids.length) {
      set(key, { ids: before.ids, cursor: before.cursor, done: before.done, loaded: true, loading: false, refreshing: false, error: null });
      return;
    }
    // Rows that are already on screen outlive a failed re-read; only a list
    // that never answered at all is entitled to swap itself for an error line.
    set(key, before.ids.length
      ? { loading: false, refreshing: false, loaded: true, error: message }
      : { loading: false, refreshing: false, loaded: true, done: true, error: message });
  }
}

/**
 * The three entry points below take a caller-facing list name and its filters;
 * the `*At` variants behind them take the already-composed state key, which is
 * what the hook holds. Composing twice would name a state nobody reads.
 */
function loadAt(sk: string, def: ListDef, query: Query | undefined): Promise<void> {
  return fetchPage(sk, def, query, null);
}

function refreshAt(sk: string, def: ListDef, query: Query | undefined): Promise<void> {
  return fetchPage(sk, def, query, null, 'refresh');
}

/** Re-read page one and let the screen redraw itself: the rows on the way out are cleared first. */
function rebuildAt(sk: string, def: ListDef, query: Query | undefined): Promise<void> {
  return fetchPage(sk, def, query, null, 'rebuild');
}

/**
 * The lists a mounted screen is reading right now, and how many screens are
 * reading each. Pull-to-refresh lives at the shell, where it cannot know the
 * name of a single list on the page — this registry is what it asks instead,
 * so every section of every screen is re-pulled by the one gesture.
 */
const held = new Map<string, { def: ListDef; query?: Query; owners: number }>();

function hold(sk: string, def: ListDef, query?: Query): void {
  const entry = held.get(sk);
  if (entry) entry.owners += 1;
  else held.set(sk, { def, query, owners: 1 });
}

function release(sk: string): void {
  const entry = held.get(sk);
  if (!entry) return;
  entry.owners -= 1;
  if (entry.owners <= 0) held.delete(sk);
}

/** Re-pull every list on screen, each from page one. */
export function refreshHeldLists(): Promise<void> {
  return Promise.all(Array.from(held.entries(), ([sk, entry]) => rebuildAt(sk, entry.def, entry.query)))
    .then(() => undefined);
}

/**
 * A screen whose headline number does not come from a paginated list — a
 * profile's real totals, a circle's counts — adds itself here, so the one pull
 * at the shell re-reads it too. Whatever it returns is waited on, and one screen
 * that fails does not stop the rest of the page.
 */
const pullers = new Set<() => unknown>();

export function refreshPullers(): Promise<void> {
  return Promise.all(Array.from(pullers, fn => Promise.resolve().then(fn).catch(() => undefined)))
    .then(() => undefined);
}

/** Re-read what this screen holds outside of a list when the page is pulled open. */
export function usePull(fn: () => unknown, enabled = true): void {
  const run = useRef(fn);
  run.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const job = () => run.current();
    pullers.add(job);
    return () => { pullers.delete(job); };
  }, [enabled]);
}

function loadMoreAt(sk: string, def: ListDef, query: Query | undefined): Promise<void> {
  const state = snapshot(sk);
  if (!state.loaded || state.loading || state.refreshing || state.done || !state.cursor) return Promise.resolve();
  return fetchPage(sk, def, query, state.cursor);
}

export function loadList(key: string, def: ListDef, query?: Query): Promise<void> {
  return loadAt(stateKey(key, query), def, query);
}

/** Re-read page one in place: the rows on screen stay until the answer lands. */
export function refreshList(key: string, def: ListDef, query?: Query): Promise<void> {
  return refreshAt(stateKey(key, query), def, query);
}

export function loadMoreList(key: string, def: ListDef, query?: Query): Promise<void> {
  return loadMoreAt(stateKey(key, query), def, query);
}

/**
 * A row the server just created belongs in the list it came from: at the head
 * of a newest-first page, at the end of an oldest-first one. Without this the
 * comment you wrote would sit in the cache but never reach the screen.
 */
export function pushListRow(key: string, query: Query | undefined, id: string): void {
  if (!id) return;
  const sk = stateKey(key, query);
  const state = snapshot(sk);
  if (!state.loaded || state.ids.includes(id)) return;
  const oldest = query?.order === 'oldest';
  set(sk, { ids: oldest ? [...state.ids, id] : [id, ...state.ids] });
}

export function useList(key: string, def: ListDef, query?: Query, enabled = true) {
  const sk = stateKey(key, query);
  const defRef = useRef(def);
  defRef.current = def;
  const queryRef = useRef(query);
  queryRef.current = query;

  const state = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => (enabled ? snapshot(sk) : IDLE),
    () => IDLE,
  );

  // While this screen is open it owns a reading of the list, so the shell's
  // pull-to-refresh re-pulls it. Counted, because two screens on one page can
  // read the same list and only the last one to leave should drop it.
  useEffect(() => {
    if (!enabled) return;
    hold(sk, defRef.current, queryRef.current);
    return () => release(sk);
  }, [sk, enabled]);

  // An exhausted list that came back with no rows has not finished reading: the
  // first thread, the first comment and the first post all arrive into exactly
  // that state, and a screen that refuses to ask again shows "nothing yet" for
  // the rest of the session. Re-armed once per mount, so an author who really
  // has nothing does not re-read on every scroll.
  const rearmed = useRef('');
  useEffect(() => {
    // Keyed on `loaded`, not just on mount: a list that is dropped while this
    // screen is open (marking a thread read forgets the inbox) has to come back
    // by itself, or the screen keeps showing a list nobody will ever refill.
    if (!enabled) return;
    if (!state.loaded) { void loadAt(sk, defRef.current, queryRef.current); return; }
    if (state.done && !state.ids.length && rearmed.current !== sk) {
      rearmed.current = sk;
      void loadAt(sk, defRef.current, queryRef.current);
    }
  }, [sk, enabled, state.loaded, state.done, state.ids.length]);

  return {
    ids: state.ids,
    loading: state.loading,
    loaded: state.loaded,
    hasMore: enabled && !state.done,
    error: state.error,
    loadMore: () => (enabled ? loadMoreAt(sk, defRef.current, queryRef.current) : Promise.resolve()),
    reload: () => (enabled ? refreshAt(sk, defRef.current, queryRef.current) : Promise.resolve()),
  };
}

/** Row → fragment builders. Each mirrors what one screen needs in one round-trip. */

/**
 * The author embedded in a post, comment or listing row. Everything the row
 * leaves unanswered stays unanswered — `cards` and mapPerson then decide what
 * the cache may take.
 */
function authorCard(row: any): any {
  return {
    id: row.author ?? row.id,
    username: row.author_username ?? row.username,
    name: row.author_name ?? row.name,
    avatar_url: row.author_avatar_url ?? row.avatar_url,
    verified: row.author_verified ?? row.verified,
    is_private: row.author_is_private ?? row.is_private,
  };
}

/**
 * Collect the person cards one page embeds. Every screen finds people by
 * handle, so a card that cannot answer with one is a dead entry — and worse, a
 * record that makes those lookups throw for the whole cache. Rows that carry no
 * card at all (a system notification, an anonymous listing) contribute nothing.
 */
function cards(rows: any[], card: (row: any) => any): User[] {
  return rows.map(card).filter(c => c && c.username).map(mapPerson);
}

export function postsFragment(meId: string | null): (rows: any[]) => Fragment {
  return rows => ({
    posts: rows.map(mapPost),
    users: cards(rows, authorCard),
    reactions: meId ? rows.flatMap(row => reactionsOfPost(row, meId)) : [],
    promotions: rows.filter(row => row.promo).map(mapPromotion),
  });
}

export function commentsFragment(meId: string | null): (rows: any[]) => Fragment {
  return rows => ({
    comments: rows.map(mapComment),
    users: cards(rows, authorCard),
    reactions: meId ? rows.flatMap(row => reactionsOfComment(row, meId)) : [],
  });
}

export function usersFragment(rows: any[]): Fragment {
  return { users: cards(rows, row => row) };
}

/**
 * One page of a conversation. The two participants are already known, so the
 * rows carry no person cards — a username-only card would overwrite a real
 * display name with a handle.
 */
export function threadFragment(meId: string, otherId: string): (rows: any[]) => Fragment {
  return rows => ({ messages: rows.map(row => mapMessage(row, meId, otherId)) });
}

/**
 * The inbox answers one row per conversation, and its unread count describes the
 * conversation — so the count rides along on that row's last message.
 */
export function inboxFragment(meId: string): (rows: any[]) => Fragment {
  return rows => ({
    messages: rows.filter(row => row.last_message && row.user).map(row => ({
      ...mapMessage(row.last_message, meId, idOf(row.user.id)),
      unread: Number(row.unread) || 0,
    })),
    users: cards(rows, row => row.user),
  });
}

/**
 * The inbox def in one place: the messages screen reads through it, and the
 * read receipt refreshes through it. Two copies would drift, and a def that
 * names the rows differently than the screen does yields an empty list.
 */
export function inboxListDef(meId: string): ListDef {
  return {
    path: '/messages/inbox/',
    frag: inboxFragment(meId),
    ids: rows => rows.map(row => idOf(row.user && row.user.id)),
  };
}

export function listingsFragment(rows: any[]): Fragment {
  return {
    listings: rows.map(mapListing),
    // Only the keys the row answers for: a thin card must not reset a real profile.
    users: cards(rows, row => ({ id: row.seller, username: row.seller_username, name: row.seller_name })),
  };
}

export function notificationsFragment(rows: any[]): Fragment {
  return {
    notifications: rows.map(mapNotification),
    users: cards(rows, row => row.actor_card),
  };
}

/** The ledger is one person's own money, so every row belongs to the signed-in user. */
export function walletFragment(meId: string | null): (rows: any[]) => Fragment {
  return rows => ({ ledger: rows.map(row => mapLedger(row, meId || '')) });
}

export const coinRequestsFragment = (rows: any[]): Fragment => ({ coinRequests: rows.map(mapCoinRequest) });

export function promotionsFragment(rows: any[]): Fragment {
  return {
    promotions: rows.map(mapPromotion),
    users: cards(rows, row => row.owner_card),
  };
}
