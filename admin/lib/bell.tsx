'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ReactNode } from 'react';
import { api } from './api';
import { parseAdminPulse, publishAdminPulse, setAdminHealth, useAdminEvent, useAdminLive } from './live';
import { useSession } from './session';

export interface BellItem {
  id: number;
  kind: string;
  text: string;
  href: string;
  route: string;
  created_at: string;
  age_minutes: number;
}

interface Tray {
  items: BellItem[];
  total: number;
  routes: Record<string, number>;
  walked: Record<string, number>;
  poll_seconds: number;
}

interface BellValue extends Tray {
  open: boolean;
  setOpen: (open: boolean) => void;
  refresh: () => void;
  read: (id: number) => void;
  readRoute: (route: string) => void;
  readAll: () => void;
}

const BellContext = createContext<BellValue | null>(null);

export function useBell(): BellValue {
  const value = useContext(BellContext);
  if (!value) throw new Error('useBell must run inside <BellProvider>');
  return value;
}

const EMPTY: Tray = { items: [], total: 0, routes: {}, walked: {}, poll_seconds: 20 };

/**
 * A polled tray is merged over the empty one, never swapped in whole. The console
 * reaches the browser minutes after a merge and the API behind it much later, so a
 * poll can answer from a build that has never heard of a field this shell indexes;
 * `walked` did exactly that, and reading it off a bare payload threw on every page.
 */
function over(next: Tray | null): Tray {
  return { ...EMPTY, ...(next || {}) };
}

export function BellProvider({ children }: { children: ReactNode }) {
  // The bell belongs to a seat, not to the door: no session, nothing to poll.
  const { status } = useSession();
  const enabled = status === 'in';
  const { health } = useAdminLive();
  const [tray, setTray] = useState<Tray>(EMPTY);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setTray(over(await api<Tray>('admin/bell/')));
    } catch {
      // A seat whose window just ended has bigger things to read than a bell error.
    }
  }, []);

  const write = useCallback(async (body: Record<string, unknown>) => {
    try {
      setTray(over(await api<Tray>('admin/bell/read/', { method: 'POST', body })));
    } catch {
      // The notice is still on the screen it came from, which is the point of it.
    }
  }, []);

  useAdminEvent(['staff_notice'], load);

  useEffect(() => {
    if (!enabled) {
      setTray(EMPTY);
      return undefined;
    }
    load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) {
      setAdminHealth('offline');
      return undefined;
    }
    setAdminHealth('connecting');
    const stream = new EventSource('/api/notifications/stream/?staff=1');
    let opened = false;
    stream.onopen = () => {
      setAdminHealth('live');
      if (opened) void load();
      opened = true;
    };
    stream.onerror = () => setAdminHealth('offline');
    stream.addEventListener('pulse', event => {
      const pulse = parseAdminPulse((event as MessageEvent<string>).data);
      if (pulse) publishAdminPulse(pulse);
    });
    return () => {
      stream.close();
      setAdminHealth('offline');
    };
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || health === 'live') return undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(load, (tray.poll_seconds || 20) * 1000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const watch = () => {
      if (document.hidden) stop();
      else { load(); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', watch);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', watch);
    };
  }, [enabled, health, load, tray.poll_seconds]);

  const value = useMemo<BellValue>(() => ({
    ...tray,
    open,
    setOpen,
    refresh: load,
    read: (id: number) => write({ id }),
    readRoute: (route: string) => write({ route }),
    readAll: () => write({ all: true }),
  }), [tray, open, load, write]);

  return <BellContext.Provider value={value}>{children}</BellContext.Provider>;
}
