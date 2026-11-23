'use client';

import { useState } from 'react';
import ReactionIcon from './ReactionIcon';
import ReactorsSheet from './ReactorsSheet';
import { useApp } from '@/lib/AppContext';
import { compact, reactionRank } from '@/lib/utils';
import { ReactionKind } from '@/lib/types';

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The line a post wears its reactions on: the kinds people reached for, then the
 * names, then the rest of the crowd behind a count.
 *
 * It sits above the action buttons rather than inside them because the buttons
 * answer for one person — what *you* did — and this answers for everybody.
 */
export default function ReactionSummary({ postId, extraCount = 0 }: { postId: string; extraCount?: number }) {
  const { t, reactionMix, reactionPeople, reactionCount } = useApp();
  const [open, setOpen] = useState(false);
  const mix = [...reactionMix('post', postId)]
    .sort((a, b) => b.n - a.n || reactionRank(a.kind) - reactionRank(b.kind))
    .slice(0, 3);
  const people = reactionPeople(postId);
  const total = reactionCount('post', postId) + extraCount;
  if (!total) return null;

  const label = (p: { name: string; me: boolean }) => (p.me ? t('you') : p.name);
  const shown = people.slice(0, 2);
  const others = Math.max(0, total - shown.length);
  const text = !shown.length
    ? `${compact(total)} others`
    : shown.length === 1
      ? others > 0 ? `${label(shown[0])} and ${compact(others)} others` : label(shown[0])
      : others > 0
        ? `${label(shown[0])}, ${firstName(label(shown[1]))} and ${compact(others)} others`
        : `${label(shown[0])}, ${label(shown[1])}`;

  return (
    <>
      <button
        type="button"
        className="reaction-summary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${text} — ${t('reactorsTitle')}`}
        onClick={() => setOpen(true)}
      >
        {mix.length > 0 && (
          <span className="reaction-stack" aria-hidden="true">
            {mix.map(m => <span className="reaction-chip" key={m.kind}><ReactionIcon kind={m.kind} /></span>)}
          </span>
        )}
        <span className="reaction-names">{text}</span>
      </button>
      {open && <ReactorsSheet postId={postId} onClose={() => setOpen(false)} />}
    </>
  );
}
