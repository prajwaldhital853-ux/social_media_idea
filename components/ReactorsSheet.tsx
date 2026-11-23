'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import Avatar from './Avatar';
import ReactionIcon from './ReactionIcon';
import VerifiedBadge from './VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { api } from '@/lib/api';
import { mapPerson } from '@/lib/dto';
import { REACTIONS, compact } from '@/lib/utils';
import { ReactionKind, User } from '@/lib/types';
import { useBackClose } from '@/lib/useBackClose';
import { IC } from '@/lib/icons';

interface Reactor {
  user: User;
  kind: ReactionKind;
  me: boolean;
  followed: boolean;
}

const PAGE = 12;

/**
 * Everyone who reacted, one page at a time.
 *
 * The card prints three names; this is the rest of the list. It opens as a sheet
 * that rises from the bottom of a phone and as a framed dialog on a desktop,
 * because the same 400 people read very differently in a thumb's reach.
 */
export default function ReactorsSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const { db, me, t, serverMode, followState, toggleFollow } = useApp();
  const [tab, setTab] = useState<'all' | ReactionKind>('all');
  const [rows, setRows] = useState<Reactor[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useBackClose(true, onClose);

  // In the demo build the whole list already lives in the cache, so paging is a
  // slice and the tabs count the same rows the card drew its icons from.
  const demoAll = useMemo<Reactor[]>(() => {
    if (serverMode) return [];
    const seen = new Set<string>();
    const out: Reactor[] = [];
    for (const r of [...db.reactions].sort((a, b) => b.ts - a.ts)) {
      const onPost = r.targetType === 'post' && r.targetId === postId;
      const onMedia = r.targetType === 'media' && r.targetId.startsWith(`${postId}#m`);
      if ((!onPost && !onMedia) || seen.has(r.uid)) continue;
      const user = db.users.find(u => u.id === r.uid);
      if (!user) continue;
      seen.add(r.uid);
      out.push({ user, kind: r.kind, me: r.uid === me?.id, followed: followState(r.uid) === 'following' });
    }
    return out.sort((a, b) => (a.me ? 0 : a.followed ? 1 : 2) - (b.me ? 0 : b.followed ? 1 : 2));
  }, [serverMode, db.reactions, db.users, postId, me?.id]);

  const filtered = useMemo(
    () => (tab === 'all' ? demoAll : demoAll.filter(r => r.kind === tab)),
    [demoAll, tab],
  );

  useEffect(() => {
    if (serverMode) return;
    setRows(filtered.slice(0, PAGE));
    setNext(filtered.length > PAGE ? String(PAGE) : null);
    setError(null);
  }, [serverMode, filtered]);

  // The cache changes under this sheet every time a Follow lands, so the request
  // keys off the tab alone — otherwise following someone on the third page would
  // throw the reader back to the top of the first.
  useEffect(() => {
    if (!serverMode) return;
    let live = true;
    setLoading(true);
    api.get('/api/reactions/people/', {
      target_type: 'post',
      target_id: postId,
      ...(tab === 'all' ? {} : { kind: tab }),
    })
      .then(page => {
        if (!live) return;
        setRows(page.results.map(toReactor));
        setNext(page.next || null);
        setCounts(page.counts || {});
        setTotal(page.total || 0);
      })
      .catch(() => { if (live) setError(t('listFailed')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [serverMode, postId, tab]);

  const loadMore = async () => {
    if (loading || !next) return;
    setLoading(true);
    if (!serverMode) {
      const from = Number(next);
      setRows(filtered.slice(0, from + PAGE));
      setNext(filtered.length > from + PAGE ? String(from + PAGE) : null);
      setLoading(false);
      return;
    }
    try {
      const page = await api.get('/api/reactions/people/', {
        target_type: 'post',
        target_id: postId,
        ...(tab === 'all' ? {} : { kind: tab }),
        cursor: next,
      });
      setRows(prev => [...prev, ...page.results.map(toReactor)]);
      setNext(page.next || null);
    } catch {
      setError(t('listFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !next) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [next, loading, rows.length]);

  const demoCounts = useMemo(() => {
    if (serverMode) return counts;
    const out: Record<string, number> = {};
    for (const r of demoAll) out[r.kind] = (out[r.kind] || 0) + 1;
    return out;
  }, [serverMode, counts, demoAll]);

  const shown = serverMode ? total : filtered.length;
  const tabs = REACTIONS.filter(r => (demoCounts[r.kind] || 0) > 0);

  return createPortal(
    <div className="modal-overlay reactors-overlay" onClick={onClose}>
      <div
        className="modal-content reactors-sheet"
        role="dialog"
        aria-label={t('reactorsTitle')}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <b>{t('reactorsTitle')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="reactors-tabs" role="tablist" aria-label={t('reactorsTitle')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'all'}
            className={tab === 'all' ? 'on' : ''}
            onClick={() => setTab('all')}
          >
            {t('all')}{shown > 0 && <span>{compact(shown)}</span>}
          </button>
          {tabs.map(r => (
            <button
              key={r.kind}
              type="button"
              role="tab"
              aria-selected={tab === r.kind}
              className={tab === r.kind ? 'on' : ''}
              onClick={() => setTab(r.kind)}
            >
              <ReactionIcon kind={r.kind} />
              <span>{compact(demoCounts[r.kind] || 0)}</span>
            </button>
          ))}
        </div>
        <div className="reactors-list">
          {error && !rows.length ? (
            <p className="feed-empty">{error}</p>
          ) : !loading && !rows.length ? (
            <p className="feed-empty">{t('noReactions')}</p>
          ) : (
            rows.map(r => {
              const state = followState(r.user.id);
              return (
                <div className="people-row reactor-row" key={r.user.id}>
                  <Link className="people-id" href={`/u/${r.user.username}`}>
                    <Avatar user={r.user} size={44} />
                    <span className="people-meta">
                      <b>{r.user.name || r.user.username}{r.user.verified && <VerifiedBadge size={14} />}</b>
                      <small>@{r.user.username}</small>
                    </span>
                  </Link>
                  <span className="reactor-kind" aria-label={t(r.kind)}><ReactionIcon kind={r.kind} /></span>
                  {!r.me && (
                    <button
                      type="button"
                      className={`follow-btn small ${state === 'following' ? 'on' : ''} ${state === 'pending' ? 'pending' : ''}`}
                      onClick={() => void toggleFollow(r.user.id)}
                    >
                      {state === 'following' ? t('unfollow') : state === 'pending' ? t('requested') : t('follow')}
                    </button>
                  )}
                </div>
              );
            })
          )}
          {loading && !!rows.length && <div className="reactors-loading" aria-hidden="true" />}
          {next && <div ref={sentinel} className="feed-sentinel" aria-hidden="true" />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function toReactor(row: any): Reactor {
  return { user: mapPerson(row), kind: (row.kind as ReactionKind) || 'like', me: !!row.me, followed: !!row.followed };
}
