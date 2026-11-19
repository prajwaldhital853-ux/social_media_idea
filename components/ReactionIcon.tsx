'use client';

import { useId } from 'react';
import { ReactionKind } from '@/lib/types';

export default function ReactionIcon({ kind }: { kind: ReactionKind }) {
  const id = useId().replace(/:/g, '');
  const face = kind !== 'like' && kind !== 'love';
  return <svg className="reaction-art" viewBox="0 0 48 48" aria-hidden="true">
    <defs>
      <radialGradient id={id} cx="35%" cy="24%" r="80%"><stop stopColor={face ? '#fff3a6' : kind === 'like' ? '#80d4ff' : '#ff9aa8'} /><stop offset=".55" stopColor={face ? '#ffd44d' : kind === 'like' ? '#2995ed' : '#ef4562'} /><stop offset="1" stopColor={face ? '#f39a20' : kind === 'like' ? '#1261c3' : '#bd2448'} /></radialGradient>
      <radialGradient id={`${id}c`}><stop stopColor="#ed7950" stopOpacity=".7"/><stop offset="1" stopColor="#ed7950" stopOpacity="0"/></radialGradient>
    </defs>
    <circle cx="24" cy="24" r="22" fill={`url(#${id})`} />
    <ellipse cx="18" cy="9" rx="10" ry="3" fill="white" opacity=".22" />
    {face && <><ellipse cx="10" cy="29" rx="6" ry="4" fill={`url(#${id}c)`}/><ellipse cx="38" cy="29" rx="6" ry="4" fill={`url(#${id}c)`}/></>}
    {kind === 'like' && <path fill="white" d="M12 22h6v16h-6zm8 15V22l6-11c1-2 4-1 4 2l-1 8h7c3 0 4 2 3 5l-3 10c0 2-2 3-4 3h-8z" />}
    {kind === 'love' && <path fill="white" d="M24 37S9 28 9 19c0-8 10-11 15-4 5-7 15-4 15 4 0 9-15 18-15 18z" />}
    {kind === 'haha' && <><path d="m10 21 6-4 5 4m6 0 5-4 6 4" fill="none" stroke="#653817" strokeWidth="3" strokeLinecap="round"/><path d="M11 27q13 5 26 0c-1 19-25 19-26 0" fill="#693321"/><path d="M14 29q10 3 20 0l-2 5H16z" fill="white"/><ellipse cx="24" cy="39" rx="7" ry="3" fill="#ed7778"/></>}
    {kind === 'wow' && <><ellipse cx="16" cy="21" rx="3" ry="5" fill="#653817"/><ellipse cx="32" cy="21" rx="3" ry="5" fill="#653817"/><ellipse cx="24" cy="34" rx="6" ry="8" fill="#693321"/><path d="m11 12 8-2m10 0 8 2" stroke="#8d571c" strokeWidth="2" strokeLinecap="round"/></>}
    {kind === 'sad' && <><path d="m11 18 8-3m10 0 8 3" stroke="#8d571c" strokeWidth="2" strokeLinecap="round"/><ellipse cx="16" cy="23" rx="2.5" ry="3.5" fill="#653817"/><ellipse cx="32" cy="23" rx="2.5" ry="3.5" fill="#653817"/><path d="M17 36q7-6 14 0" stroke="#653817" strokeWidth="3" fill="none" strokeLinecap="round"/><path d="M36 26s-8 9-4 12c7 5 9-3 4-12" fill="#54c5f6"/><path d="m35 31-1 4" stroke="white" strokeWidth="2" strokeLinecap="round"/></>}
  </svg>;
}
