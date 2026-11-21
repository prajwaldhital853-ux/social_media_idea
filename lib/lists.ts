'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api';
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
  error: string | null;
}

const IDLE: ListState = { ids: [], cursor: null, loaded: false, done: false, loading: false, error: null };

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

async function fetchPage(key: string, def: ListDef, query: Query | undefined, cursor: string | null): Promise<void> {
  if (snapshot(key).loading) return;
  set(key, { loading: true, error: null });
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
      ids: cursor ? [...prev, ...ids.filter(id => !prev.includes(id))] : ids,
      cursor: page.next_cursor || null,
      done: !page.has_more,
      loaded: true,
      loading: false,
    });
  } catch (err: any) {
    set(key, { loading: false, loaded: true, done: true, error: err?.message || 'Could not load this list.' });
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
  set(sk, { loaded: false, done: false, cursor: null, ids: [] });
  return fetchPage(sk, def, query, null);
}

function loadMoreAt(sk: string, def: ListDef, query: Query | undefined): Promise<void> {
  const state = snapshot(sk);
  if (!state.loaded || state.loading || state.done || !state.cursor) return Promise.resolve();
  return fetchPage(sk, def, query, state.cursor);
}

export function loadList(key: string, def: ListDef, query?: Query): Promise<void> {
  return loadAt(stateKey(key, query), def, query);
}

/** Reload from the first page, dropping the cursor but keeping cached entities. */
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

  useEffect(() => {
    // Keyed on `loaded`, not just on mount: a list that is dropped while this
    // screen is open (marking a thread read forgets the inbox) has to come back
    // by itself, or the screen keeps showing a list nobody will ever refill.
    if (enabled && !state.loaded) void loadAt(sk, defRef.current, queryRef.current);
  }, [sk, enabled, state.loaded]);

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
 * leaves unanswered stays unanswered — mapPerson then decides what a card may
 * overwrite in a record the cache already knows in full.
 */
function authorCard(row: any): User {
  return mapPerson({
    id: row.author ?? row.id,
    username: row.author_username ?? row.username,
    name: row.author_name ?? row.name,
    avatar_url: row.author_avatar_url ?? row.avatar_url,
    verified: row.author_verified ?? row.verified,
    is_private: row.author_is_private ?? row.is_private,
  });
}

export function postsFragment(meId: string | null): (rows: any[]) => Fragment {
  return rows => ({
    posts: rows.map(mapPost),
    users: rows.map(authorCard),
    reactions: meId ? rows.flatMap(row => reactionsOfPost(row, meId)) : [],
    promotions: rows.filter(row => row.promo).map(mapPromotion),
  });
}

export function commentsFragment(meId: string | null): (rows: any[]) => Fragment {
  return rows => ({
    comments: rows.map(mapComment),
    users: rows.map(authorCard),
    reactions: meId ? rows.flatMap(row => reactionsOfComment(row, meId)) : [],
  });
}

export function usersFragment(rows: any[]): Fragment {
  return { users: rows.map(mapPerson) };
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
    users: rows.filter(row => row.user).map(mapPerson),
  });
}

export function listingsFragment(rows: any[]): Fragment {
  return {
    listings: rows.map(mapListing),
    // Only the keys the row answers for: a thin card must not reset a real profile.
    users: rows.map(row => mapPerson({ id: row.seller, username: row.seller_username, name: row.seller_name })),
  };
}

export function notificationsFragment(rows: any[]): Fragment {
  return {
    notifications: rows.map(mapNotification),
    users: rows.filter(row => row.actor_card).map(mapPerson),
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
    users: rows.filter(row => row.owner_card).map(mapPerson),
  };
}
