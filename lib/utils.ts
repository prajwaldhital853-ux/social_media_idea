import { Follow, Post, ReactionKind } from './types';

export const canSeePost = (post: Post, meId: string | null, follows: Follow[]): boolean =>
  post.audience !== 'followers' || post.uid === meId || (!!meId && follows.some(f => f.follower === meId && f.following === post.uid));

export const esc = (s: string): string => {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c] || c));
};

export const uid = (): string => {
  return Math.random().toString(36).slice(2, 10);
};

export const KEY = 'exposing-demo-v1';
export const THEME_KEY = 'exposing-theme';
export const DAY = 86400000;

export const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const ago = (ts: number, lang: string): string => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString(lang === 'ne' ? 'ne-NP' : 'en-GB', {
    day: 'numeric',
    month: 'short'
  });
};

export const num = (n: number, lang: string): string => {
  if (lang === 'ne') {
    return String(n).replace(/\d/g, (d) => '०१२३४५६७८९'[parseInt(d)]);
  }
  return String(n);
};

export const compact = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
};

export const cLabel = (n: number, lang: string): string => {
  if (lang === 'ne') {
    return `${num(n, lang)} टिप्पणी`;
  }
  return n === 1 ? '1 comment' : `${n} comments`;
};

export const fmtDur = (d: number): string => {
  if (!d) return '';
  const s = Math.round(d);
  return `${Math.floor(s / 60)}:${('0' + (s % 60)).slice(-2)}`;
};

export const ageFromDob = (dob: string): number => {
  if (!dob) return 0;
  const b = new Date(dob);
  if (isNaN(b.getTime())) return 0;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
};

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
};

export const COUNTRIES = ['Nepal', 'India', 'United States', 'United Kingdom', 'Australia', 'Japan', 'Germany', 'Other'];

export const POST_TOPICS = ['General', 'Travel', 'Photography', 'Food', 'Tech', 'Sports', 'Music', 'News'];

export const REACTIONS: { kind: ReactionKind; emoji: string; label: string }[] = [
  { kind: 'like', emoji: '👍', label: 'Like' },
  { kind: 'love', emoji: '❤️', label: 'Love' },
  { kind: 'haha', emoji: '😂', label: 'Haha' },
  { kind: 'wow', emoji: '😮', label: 'Wow' },
  { kind: 'sad', emoji: '😢', label: 'Sad' }
];

export const reactionMeta = (kind: ReactionKind) =>
  REACTIONS.find(r => r.kind === kind) || REACTIONS[0];

export const resizeImage = (file: File): Promise<string> => {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1280;
      const w = img.width;
      const h = img.height;
      const s = Math.min(1, max / Math.max(w, h));
      const nw = Math.round(w * s);
      const nh = Math.round(h * s);
      const c = document.createElement('canvas');
      c.width = nw;
      c.height = nh;
      const x = c.getContext('2d');
      if (x) {
        x.fillStyle = '#fff';
        x.fillRect(0, 0, nw, nh);
        x.drawImage(img, 0, 0, nw, nh);
      }
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej();
    };
    img.src = url;
  });
};

export const videoDuration = (url: string): Promise<number> => {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const to = setTimeout(() => {
      rej();
    }, 8000);
    v.onloadedmetadata = () => {
      clearTimeout(to);
      res(v.duration);
    };
    v.onerror = () => {
      clearTimeout(to);
      rej();
    };
    v.src = url;
  });
};

export const fileToDataUrl = (file: File): Promise<string> => {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('This file could not be read. Try another one.'));
    r.readAsDataURL(file);
  });
};