'use client';

import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/AppContext';
import { REACTIONS, compact, reactionMeta } from '@/lib/utils';
import { ReactionKind } from '@/lib/types';
import { IC } from '@/lib/icons';

interface ReactionButtonProps {
  targetType: 'post' | 'comment';
  targetId: string;
  small?: boolean;
}

export default function ReactionButton({ targetType, targetId, small }: ReactionButtonProps) {
  const { db, me, react, myReaction, t } = useApp();
  const [open, setOpen] = useState(false);
  const hoverTo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const mine = myReaction(targetType, targetId);
  const rows = db.reactions.filter(r => r.targetType === targetType && r.targetId === targetId);
  const count = rows.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (kind: ReactionKind) => {
    react(targetType, targetId, kind);
    setOpen(false);
  };

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!me) {
      window.location.href = '/login';
      return;
    }
    if (mine) react(targetType, targetId, mine);
    else react(targetType, targetId, 'like');
  };

  const label = mine ? t(reactionMeta(mine).kind) : t('like');

  return (
    <div
      className={`react-wrap ${small ? 'small' : ''}`}
      ref={wrapRef}
      onMouseEnter={() => {
        if (!me) return;
        hoverTo.current = setTimeout(() => setOpen(true), 350);
      }}
      onMouseLeave={() => {
        if (hoverTo.current) clearTimeout(hoverTo.current);
        setOpen(false);
      }}
    >
      {open && me && (
        <div className="react-picker" role="menu">
          {REACTIONS.map(r => (
            <button
              key={r.kind}
              type="button"
              title={t(r.kind)}
              aria-label={t(r.kind)}
              className={mine === r.kind ? 'on' : ''}
              onClick={e => { e.preventDefault(); e.stopPropagation(); pick(r.kind); }}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-pressed={!!mine}
        className={`action-btn ${mine ? 'reacted' : ''}`}
        onClick={onClick}
        aria-label={label}
      >
        {mine ? <span className="react-emoji">{reactionMeta(mine).emoji}</span> : IC.thumb}
        <span>{count > 0 ? compact(count) : ''}</span>
      </button>
      {me && <button type="button" className="reaction-options" aria-label="Choose reaction" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(value => !value); }}>⌄</button>}
    </div>
  );
}