'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from './AppContext';

export type RowState = 'idle' | 'loading' | 'missing' | 'error';

/**
 * A row opened by id — from a link, a notification, a share — is not
 * necessarily inside any list this session has paged through, so the screen
 * asks for that one row and keeps its empty state hidden until the answer
 * arrives: 'missing' is the server's no, 'error' is the network's.
 */
export function useRemoteRow(kind: 'post' | 'listing', id: string, present: boolean) {
  const { serverMode, loadEntity } = useApp();
  const [remote, setRemote] = useState<RowState>(() => (serverMode && !present ? 'loading' : 'idle'));

  const pull = useCallback(() => {
    setRemote('loading');
    void loadEntity(kind, id).then(res => setRemote(res === 'ok' ? 'idle' : res));
  }, [kind, id, loadEntity]);

  useEffect(() => {
    if (!serverMode) return;
    if (present) { setRemote('idle'); return; }
    if (id) pull();
  }, [serverMode, present, id, pull]);

  return { remote, pull };
}
