'use client';

import { useEffect, useRef, useState } from 'react';

export interface ServerPaging {
  hasMore: boolean;
  loading: boolean;
  load: () => void | Promise<void>;
  /** Set once the first page has answered, so an empty list can look different from an unsent one. */
  loaded?: boolean;
  error?: string | null;
  retry?: () => void | Promise<void>;
}

export interface WindowOpts {
  /**
   * How far ahead of the viewport the sentinel is allowed to ask for the next
   * page. The wide default suits a column the reader only scrolls to reach
   * something; a list that is supposed to *look* paged wants the sentinel
   * actually on screen, or the answer lands before the eye gets there.
   */
  margin?: string;
  /** Shortest time the skeleton may stay up, so a fast answer is not a blink. */
  dwell?: number;
}

/**
 * The settings for a list the reader is meant to watch page: the next ten are
 * asked for once the seam is nearly on screen, and the skeleton is held long
 * enough to be seen even when the answer comes back inside a blink.
 */
export const PAGED_WINDOW: WindowOpts = { margin: '200px 0px', dwell: 260 };

/**
 * Infinite windowing over a cache that a server may still be filling.
 *
 * The window renders `page` rows at a time from what is already loaded; when it
 * reaches the end of the cache and the server has another keyset page, the same
 * sentinel fetches it instead. `pending` and `hasMore` cover both sources so
 * callers keep one skeleton and one "load more" rule.
 */
export function useWindowed(total: number, page = 10, resetKey?: unknown, server?: ServerPaging, opts?: WindowOpts) {
  const margin = opts?.margin ?? '1200px 0px';
  const dwell = opts?.dwell ?? 0;
  const [limit, setLimit] = useState(page);
  const [pending, setPending] = useState(false);
  const [held, setHeld] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useRef(server?.load);
  load.current = server?.load;

  useEffect(() => {
    busy.current = false;
    setPending(false);
    setHeld(false);
    setLimit(page);
  }, [resetKey, page]);

  // The server's own `loading` is the truth about a page in flight, but on a warm
  // local link it opens and closes inside one paint. Holding the skeleton for a
  // beat past the answer is the difference between a list that pages and a list
  // that quietly rewrites itself.
  useEffect(() => {
    if (!server?.loading || dwell <= 0) return;
    setHeld(true);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setHeld(false), dwell);
  }, [server?.loading, dwell]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0].isIntersecting || busy.current) return;
      if (limit < total) {
        busy.current = true;
        setPending(true);
        timer.current = setTimeout(() => {
          setLimit(l => Math.min(total, l + page));
          setPending(false);
          busy.current = false;
        }, Math.max(140, dwell));
      } else if (server?.hasMore && !server.loading) {
        void load.current?.();
      }
    }, { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [total, limit, page, margin, server?.hasMore, server?.loading]);

  return {
    limit,
    pending: pending || held || !!server?.loading,
    sentinel,
    hasMore: limit < total || !!server?.hasMore,
  };
}
