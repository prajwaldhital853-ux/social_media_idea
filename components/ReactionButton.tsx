'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { REACTIONS, compact } from '@/lib/utils';
import { ReactionKind } from '@/lib/types';
import { IC } from '@/lib/icons';
import ReactionIcon from './ReactionIcon';

export default function ReactionButton({ targetType, targetId, small, kinds, extraCount = 0, openOnClick, emptyLabel = '', showMix = false }: { targetType: 'post' | 'comment' | 'media'; targetId: string; small?: boolean; kinds?: ReactionKind[]; extraCount?: number; openOnClick?: boolean; emptyLabel?: string; showMix?: boolean }) {
  const { me, react, myReaction, reactionCount, reactionMix, t } = useApp();
  const list = kinds?.length ? REACTIONS.filter(r => kinds.includes(r.kind)) : REACTIONS;
  const trayWidth = list.length * 53 + 14;
  const router = useRouter();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const pressing = useRef(false);
  const button = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const mine = myReaction(targetType, targetId);
  const count = reactionCount(targetType, targetId) + extraCount;
  const mix = showMix ? reactionMix(targetType, targetId) : [];
  const [pop, setPop] = useState(false);
  const wasMine = useRef(mine);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const clearHover = () => { if (hover.current) clearTimeout(hover.current); hover.current = null; };
  const clearLeave = () => { if (leave.current) clearTimeout(leave.current); leave.current = null; };
  const release = () => { cancel(); pressing.current = false; };
  // A pointer that merely passes over the button on its way to something else
  // must not raise the tray, and one that steps off the button to reach the
  // tray must not drop it — so both edges wait a beat before deciding.
  const hoverIn = () => { clearLeave(); if (position || hover.current) return; hover.current = setTimeout(open, 350); };
  const hoverOut = () => {
    clearHover();
    if (!position) return;
    leave.current = setTimeout(() => setPosition(null), 220);
  };
  useEffect(() => {
    if (wasMine.current === mine) return;
    wasMine.current = mine;
    setPop(true);
    const done = setTimeout(() => setPop(false), 280);
    return () => clearTimeout(done);
  }, [mine]);
  useEffect(() => () => { clearHover(); clearLeave(); }, []);
  const open = () => {
    if (!me || !button.current) return;
    const rect = button.current.getBoundingClientRect();
    const rawTop = rect.top > 100 ? rect.top - 86 : rect.bottom + 8;
    setPosition({ left: Math.max(8, Math.min(rect.left - 8, window.innerWidth - trayWidth - 8)), top: Math.max(8, Math.min(rawTop, window.innerHeight - 88)) });
  };
  const pick = (kind: ReactionKind) => {
    react(targetType, targetId, kind);
    setPosition(null);
    button.current?.focus();
  };
  useEffect(() => () => cancel(), []);
  useEffect(() => {
    if (!position) return;
    const openedAt = performance.now();
    const outside = (e: PointerEvent) => { if (!picker.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setPosition(null); };
    const close = () => setPosition(null);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); button.current?.focus(); } };
    // Focus scrolls the button into view, and with smooth scrolling that travel
    // is still in flight when a keyboard-opened tray appears — so the first beat
    // of scroll after opening is the app finishing the trip, not the reader
    // leaving it.
    const onScroll = () => { if (performance.now() - openedAt > 320) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); };
  }, [position]);
  return <div className={`react-wrap ${small ? 'small' : ''}`}>
    <button ref={button} type="button" className={`action-btn reaction-trigger ${mine ? 'reacted' : ''} ${pop ? 'pop' : ''}`} aria-label={openOnClick ? 'Choose reaction' : t(mine || 'like')} aria-pressed={!!mine} aria-haspopup="dialog" aria-expanded={!!position} title={openOnClick ? 'Tap to choose a reaction' : 'Press and hold for reactions'} onPointerEnter={e => { if (e.pointerType === 'mouse') hoverIn(); }} onPointerDown={e => {
      if (e.button !== 0) return;
      cancel(); clearHover(); held.current = false; origin.current = { x: e.clientX, y: e.clientY };
      // A press that began here may end on an emoji the tray offers, and the
      // browser sends that release to the emoji, not here — so the tray needs to
      // know a held press is still in flight.
      pressing.current = true;
      document.addEventListener('pointerup', () => { pressing.current = false; }, { once: true });
      timer.current = setTimeout(() => { held.current = true; open(); }, 400);
    }} onPointerMove={e => { if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) cancel(); }} onPointerUp={release} onPointerCancel={release} onPointerLeave={e => { cancel(); if (e.pointerType === 'mouse') hoverOut(); }} onContextMenu={e => { e.preventDefault(); cancel(); held.current = true; open(); }} onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); open(); } }} onClick={e => {
      e.preventDefault(); e.stopPropagation();
      if (held.current) { held.current = false; return; }
      if (!me) { router.push('/login'); return; }
      if (openOnClick) { if (position) setPosition(null); else open(); return; }
      react(targetType, targetId, mine || list[0].kind); setPosition(null);
    }}>
      {showMix && mix.length ? <span className="reaction-mix">{mix.slice(0, 3).map(m => <ReactionIcon key={m.kind} kind={m.kind} />)}</span> : mine && mine !== 'like' ? <ReactionIcon kind={mine} /> : IC.thumb}
      <span>{count > 0 ? compact(count) : emptyLabel}</span>
    </button>
    {position && createPortal(<div ref={picker} className="reaction-tray" role="dialog" aria-label="Choose reaction" style={{ ...position, width: trayWidth }} onPointerEnter={clearLeave} onPointerLeave={hoverOut} onClick={e => e.stopPropagation()}>
      {list.map((r, index) => <button key={r.kind} type="button" aria-label={t(r.kind)} aria-pressed={mine === r.kind} style={{ animationDelay: `${index * 35}ms` }} onPointerUp={e => { if (!pressing.current) return; e.preventDefault(); e.stopPropagation(); pressing.current = false; pick(r.kind); }} onClick={() => pick(r.kind)}><ReactionIcon kind={r.kind}/><span>{t(r.kind)}</span></button>)}
    </div>, document.body)}
  </div>;
}
