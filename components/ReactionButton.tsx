'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { REACTIONS, compact } from '@/lib/utils';
import { ReactionKind } from '@/lib/types';
import { IC } from '@/lib/icons';
import ReactionIcon from './ReactionIcon';

export default function ReactionButton({ targetType, targetId, small, kinds, extraCount = 0 }: { targetType: 'post' | 'comment' | 'media'; targetId: string; small?: boolean; kinds?: ReactionKind[]; extraCount?: number }) {
  const { db, me, react, myReaction, t } = useApp();
  const list = kinds?.length ? REACTIONS.filter(r => kinds.includes(r.kind)) : REACTIONS;
  const trayWidth = list.length * 53 + 14;
  const router = useRouter();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const mine = myReaction(targetType, targetId);
  const count = db.reactions.filter(r => r.targetType === targetType && r.targetId === targetId).length + extraCount;
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const open = () => {
    if (!me || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - trayWidth - 8)), top: rect.top > 100 ? rect.top - 86 : rect.bottom + 8 });
  };
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (!position) return;
    const outside = (e: PointerEvent) => { if (!picker.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setPosition(null); };
    const close = () => setPosition(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [position]);
  return <div className={`react-wrap ${small ? 'small' : ''}`}>
    <button ref={button} type="button" className={`action-btn reaction-trigger ${mine ? 'reacted' : ''}`} aria-label={t(mine || 'like')} aria-pressed={!!mine} aria-haspopup="dialog" aria-expanded={!!position} title="Press and hold for reactions" onPointerDown={e => {
      if (e.button !== 0) return;
      cancel(); held.current = false; origin.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => { held.current = true; open(); }, 450);
    }} onPointerMove={e => { if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) cancel(); }} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel} onContextMenu={e => { e.preventDefault(); cancel(); held.current = true; open(); }} onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); open(); } }} onClick={e => {
      e.preventDefault(); e.stopPropagation();
      if (held.current) { held.current = false; return; }
      if (!me) { router.push('/login'); return; }
      react(targetType, targetId, mine || list[0].kind); setPosition(null);
    }}>
      {mine ? <ReactionIcon kind={mine} /> : IC.thumb}<span>{count > 0 ? compact(count) : ''}</span>
    </button>
    {position && createPortal(<div ref={picker} className="reaction-tray" role="dialog" aria-label="Choose reaction" style={{ ...position, width: trayWidth }} onClick={e => e.stopPropagation()}>
      {list.map((r, index) => <button key={r.kind} type="button" aria-label={t(r.kind)} aria-pressed={mine === r.kind} style={{ animationDelay: `${index * 35}ms` }} onClick={() => { react(targetType, targetId, r.kind); setPosition(null); button.current?.focus(); }}><ReactionIcon kind={r.kind}/><span>{t(r.kind)}</span></button>)}
    </div>, document.body)}
  </div>;
}
