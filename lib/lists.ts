'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { api } from './api';
import {
  mapComment, mapListing, mapNotification, mapPerson, mapPost, mapPromotion,
  reactionsOfComment, reactionsOfPost, idOf, mediaUrl,
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
  Object.entries(query || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  });
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

async function fetchPage(key: string, def: ListDef, query: Query | undefined, cursor: string | null): Promise<void> {
  if (snapshot(key).loading) return;
  set(key, { loading: true, error: null });
  try {
    const page = await api.get<{ results: any[]; next_cursor: string | null; has_more: boolean }>(
      def.path,
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

export function loadList(key: string, def: ListDef, query?: Query): Promise<void> {
  const sk = stateKey(key, query);
  return fetchPage(sk, def, query, null);
}

/** Reload from the first page, dropping the cursor but keeping cached entities. */
export function refreshList(key: string, def: ListDef, query?: Query): Promise<void> {
  const sk = stateKey(key, query);
  set(sk, { loaded: false, done: false, cursor: null, ids: [] });
  return fetchPage(sk, def, query, null);
}

export function loadMoreList(key: string, def: ListDef, query?: Query): Promise<void> {
  const sk = stateKey(key, query);
  const state = snapshot(sk);
  if (!state.loaded || state.loading || state.done || !state.cursor) return Promise.resolve();
  return fetchPage(sk, def, query, state.cursor);
}

export function useList(key: string, def: ListDef, query?: Query) {
  const sk = stateKey(key, query);
  const defRef = useRef(def);
  defRef.current = def;
  const queryRef = useRef(query);
  queryRef.current = query;

  const state = useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => snapshot(sk),
    () => IDLE,
  );

  useEffect(() => {
    if (!snapshot(sk).loaded) void loadList(sk, defRef.current, queryRef.current);
  }, [sk]);

  return {
    ids: state.ids,
    loading: state.loading,
    loaded: state.loaded,
    hasMore: !state.done,
    error: state.error,
    loadMore: () => loadMoreList(sk, defRef.current, queryRef.current),
    reload: () => refreshList(sk, defRef.current, queryRef.current),
  };
}

/** Row → fragment builders. Each mirrors what one screen needs in one round-trip. */

function authorCard(row: any): User {
  return {
    id: idOf(row.author ?? row.id),
    username: row.author_username ?? row.username,
    name: row.author_name ?? row.name,
    avatar: mediaUrl(row.author_avatar_url ?? row.avatar_url),
    verified: !!(row.author_verified ?? row.verified),
  } as unknown as User;
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

export function listingsFragment(rows: any[]): Fragment {
  return {
    listings: rows.map(mapListing),
    // Only the keys the row answers for: a thin card must not reset a real profile.
    users: rows.map(row => ({
      id: idOf(row.seller),
      username: row.seller_username,
      name: row.seller_name,
    }) as unknown as User),
  };
}

export function notificationsFragment(rows: any[]): Fragment {
  return {
    notifications: rows.map(mapNotification),
    users: rows.filter(row => row.actor_card).map(mapPerson),
  };
}

export function promotionsFragment(rows: any[]): Fragment {
  return {
    promotions: rows.map(mapPromotion),
    users: rows.filter(row => row.owner_card).map(mapPerson),
  };
}
