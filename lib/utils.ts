import { Follow, Post, ReactionKind, User } from './types';

/** Accounts that hide everything from anyone they have not approved. */
export const privateIds = (users: User[]): string[] => users.filter(u => !!u.private).map(u => u.id);

export const canSeePost = (post: Post, meId: string | null, follows: Follow[], privateAuthors: string[]): boolean => {
  if (post.uid === meId) return true;
  const approved = !!meId && follows.some(f => f.follower === meId && f.following === post.uid && f.status !== 'pending');
  // A private account is private whatever the author picked as the audience.
  if (privateAuthors.includes(post.uid)) return approved;
  return post.audience !== 'followers' || approved;
};

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
export const LANG_KEY = 'exposing-lang';
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

/**
 * About-section links open in a new tab, so anything that is not a plain
 * http(s) address — javascript:, data:, an unknown scheme — renders as null.
 */
export const safeUrl = (raw?: string | null): string | null => {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(String(raw).trim());
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
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

// A summary reads as Facebook's when Like leads it, so the order lives in the
// table above rather than in whatever the counter happened to sort first.
export const reactionRank = (kind: ReactionKind) => {
  const i = REACTIONS.findIndex(r => r.kind === kind);
  return i < 0 ? REACTIONS.length : i;
};

const blit = (src: HTMLImageElement | HTMLCanvasElement, sw: number, sh: number, dw: number, dh: number) => {
  const c = document.createElement('canvas');
  c.width = dw;
  c.height = dh;
  const x = c.getContext('2d');
  if (x) {
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.fillStyle = '#fff';
    x.fillRect(0, 0, dw, dh);
    x.drawImage(src, 0, 0, sw, sh, 0, 0, dw, dh);
  }
  return c;
};

let webpEncoder: Promise<boolean> | null = null;

// 2560 rather than 2048: a phone shows a card at two pixels per css point, and
// the extra edge is what keeps a zoomed-in picture from going soft. WebP at
// 0.88 pays for it — it lands near half the bytes of the JPEG it replaces
// while the eye stops telling the copy from the original. Browsers without a
// WebP encoder (old Safari) fall back to the old JPEG pass. Detection runs
// once and is remembered for the session.
export const canEncodeWebp = (): Promise<boolean> => {
  if (!webpEncoder) {
    webpEncoder = new Promise(done => {
      const c = document.createElement('canvas');
      c.width = 2;
      c.height = 2;
      c.toBlob(b => done(!!b && b.type === 'image/webp'), 'image/webp', 0.5);
    });
  }
  return webpEncoder;
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((res, rej) => {
  const reader = new FileReader();
  reader.onload = () => res(String(reader.result));
  reader.onerror = () => rej();
  reader.readAsDataURL(blob);
});

export const resizeImage = (file: File, max = 2560): Promise<string> => {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const s = Math.min(1, max / Math.max(w, h));
      // A picture that already fits and is already light stays byte for byte —
      // the cropper's output lands here that way, and re-encoding a few hundred
      // kilobytes spends time to save nothing. Anything heavier goes through
      // the encoder even at its own size: one pass from the decoded original,
      // not a re-compression of a JPEG, is what keeps the edges crisp.
      if (s === 1 && file.size <= 600 * 1024) {
        const reader = new FileReader();
        reader.onload = () => res(String(reader.result));
        reader.onerror = () => rej();
        URL.revokeObjectURL(url);
        reader.readAsDataURL(file);
        return;
      }
      const tw = Math.max(1, Math.round(w * s));
      const th = Math.max(1, Math.round(h * s));
      let from: HTMLImageElement | HTMLCanvasElement = img;
      let sw = w;
      let sh = h;
      // WebKit keeps a canvas's pixels alive until the canvas itself dies, so
      // every halving step would otherwise sit in memory beside the next one.
      // A phone asked to downscale five of these at once runs out and answers
      // with a blank, unresponsive tab.
      const drop = (old: HTMLImageElement | HTMLCanvasElement) => {
        if (old instanceof HTMLCanvasElement) { old.width = 0; old.height = 0; }
      };
      // One jump from four thousand pixels to two thousand is what makes a photo
      // mush: the browser averages a huge area into its destination in a single
      // pass. Halving twice over keeps the edges the eye reads as detail.
      while (sw > tw * 2 && sh > th * 2) {
        const dw = Math.max(tw, Math.floor(sw / 2));
        const dh = Math.max(th, Math.floor(sh / 2));
        const next = blit(from, sw, sh, dw, dh);
        drop(from);
        from = next;
        sw = dw;
        sh = dh;
      }
      URL.revokeObjectURL(url);
      const canvas = blit(from, sw, sh, tw, th);
      drop(from);
      canEncodeWebp().then(ok => {
        if (!ok) {
          res(canvas.toDataURL('image/jpeg', 0.94));
          return;
        }
        canvas.toBlob(blob => {
          if (!blob || blob.type !== 'image/webp') {
            res(canvas.toDataURL('image/jpeg', 0.94));
            return;
          }
          res(blobToDataUrl(blob));
        }, 'image/webp', 0.88);
      }).catch(() => rej());
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