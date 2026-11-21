'use client';

import { useEffect, useRef, useState } from 'react';

export interface ServerPaging {
  hasMore: boolean;
  loading: boolean;
  load: () => void | Promise<void>;
}

/**
 * Infinite windowing over a cache that a server may still be filling.
 *
 * The window renders `page` rows at a time from what is already loaded; when it
 * reaches the end of the cache and the server has another keyset page, the same
 * sentinel fetches it instead. `pending` and `hasMore` cover both sources so
 * callers keep one skeleton and one "load more" rule.
 */
export function useWindowed(total: number, page = 10, resetKey?: unknown, server?: ServerPaging) {
  const [limit, setLimit] = useState(page);
  const [pending, setPending] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useRef(server?.load);
  load.current = server?.load;

  useEffect(() => {
    busy.current = false;
    setPending(false);
    setLimit(page);
  }, [resetKey, page]);

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
        }, 140);
      } else if (server?.hasMore && !server.loading) {
        void load.current?.();
      }
    }, { rootMargin: '1200px 0px' });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [total, limit, page, server?.hasMore, server?.loading]);

  return {
    limit,
    pending: pending || !!server?.loading,
    sentinel,
    hasMore: limit < total || !!server?.hasMore,
  };
}
