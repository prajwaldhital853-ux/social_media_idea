'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ReactNode } from 'react';
import { api } from './api';

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

const EMPTY: Tray = { items: [], total: 0, routes: {}, poll_seconds: 20 };

/**
 * The tray is polled rather than pushed: this console has no socket, and a seat who
 * is not looking at the screen should not be the reason a report sits unseen. The
 * interval stops while the tab is hidden and one read starts on the way back, so a
 * console left open overnight costs nothing until somebody comes back to it.
 */
export function BellProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [tray, setTray] = useState<Tray>(EMPTY);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setTray(await api<Tray>('admin/bell/'));
    } catch {
      // A seat whose window just ended has bigger things to read than a bell error.
    }
  }, []);

  const write = useCallback(async (body: Record<string, unknown>) => {
    try {
      setTray(await api<Tray>('admin/bell/read/', { method: 'POST', body }));
    } catch {
      // The notice is still on the screen it came from, which is the point of it.
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setTray(EMPTY);
      return undefined;
    }
    load();
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
  }, [enabled, load, tray.poll_seconds]);

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
