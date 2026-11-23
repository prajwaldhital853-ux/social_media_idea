'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode, Dispatch, SetStateAction } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Database, Follow, User, Post, Comment, ThemeMode, ReactionKind, NotificationKind, FeatureFlags, Promotion, Message } from './types';
import { getDb, save, emptyDb } from './storage';
import { hydrateVideoSrcs } from './videoStore';
import { THEME_KEY, LANG_KEY, uid, ageFromDob, DAY, reactionRank } from './utils';
import { I18N, TranslationKey } from './i18n';
import { api, API_ENABLED, ApiError, onWakeChange } from './api';
import { merge as applyFragment, Fragment } from './store';
import {
  idOf, at, mapComment, mapFollow, mapMe, mapMessage, mapNotification, mapPerson, mapPost, mapPromotion,
  mapReport, mapSettings, mediaPayload, profilePatch, reactionsOfPost, toPostPayload, toProfilePayload,
} from './dto';
import { bindListCache, forgetLists, inboxListDef, listingsFragment, notificationsFragment, postsFragment, pushListRow, refreshList } from './lists';

type Target = 'post' | 'comment' | 'media';

interface AppContextType {
  db: Database;
  setDb: Dispatch<SetStateAction<Database>>;
  me: User | null;
  isAdmin: () => boolean;
  isStaff: () => boolean;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  feature: (key: keyof FeatureFlags) => boolean;
  addPost: (post: Post) => Promise<Post>;
  updatePost: (id: string, updates: Partial<Post>) => Promise<void>;
  deletePost: (id: string) => Promise<void>;
  addComment: (comment: Comment) => Promise<Comment>;
  deleteComment: (id: string) => Promise<void>;
  toggleFollow: (targetId: string) => Promise<void>;
  isFollowing: (targetId: string) => boolean;
  followState: (targetId: string) => 'none' | 'pending' | 'following';
  /** A request from that account to follow me that is still waiting. */
  requestFrom: (targetId: string) => Follow | null;
  incomingRequests: () => Follow[];
  acceptRequest: (followerId: string) => Promise<void>;
  declineRequest: (followerId: string) => Promise<void>;
  /** Drop one accepted follower of mine, silently and without blocking. */
  removeFollower: (followerId: string) => Promise<void>;
  mutualIds: () => string[];
  react: (targetType: Target, targetId: string, kind: ReactionKind) => Promise<void>;
  myReaction: (targetType: Target, targetId: string) => ReactionKind | null;
  reactionCount: (targetType: Target, targetId: string) => number;
  reactionMix: (targetType: Target, targetId: string) => { kind: ReactionKind; n: number }[];
  reactionPeople: (postId: string) => { id: string; name: string; kind: ReactionKind; me: boolean }[];
  myPostReaction: (postId: string) => ReactionKind | null;
  toggleSave: (pid: string) => Promise<void>;
  isSaved: (pid: string) => boolean;
  sharePost: (pid: string) => Promise<void>;
  /** One reel watched. Fire-and-forget: a refused counter must never spoil playback. */
  countView: (pid: string) => Promise<void>;
  blockUser: (targetId: string) => Promise<void>;
  unblockUser: (targetId: string) => Promise<void>;
  isBlocked: (targetId: string) => boolean;
  blockedIds: () => string[];
  toggleListingSave: (lid: string) => Promise<void>;
  isListingSaved: (lid: string) => boolean;
  notify: (uid: string, kind: NotificationKind, text: string, href?: string, actor?: string) => void;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  sendMessage: (to: string, text: string) => Promise<void>;
  markThreadRead: (username: string, opts?: { force?: boolean }) => Promise<void>;
  addReport: (type: 'post' | 'comment' | 'listing' | 'profile', targetId: string, reason: string, note: string) => Promise<void>;
  logAudit: (action: string, target: string, reason: string) => void;
  requestPromotion: (targetType: 'post' | 'listing', targetId: string, cfg: PromoConfig) => Promise<boolean>;
  cancelPromotion: (id: string) => Promise<void>;
  setPromotionStatus: (id: string, action: 'pause' | 'resume') => Promise<void>;
  updatePromotion: (id: string, patch: PromoTarget) => Promise<boolean>;
  activePromo: (targetType: 'post' | 'listing', targetId: string) => Promotion | undefined;
  promoEligible: (promo: Promotion) => boolean;
  updateLang: (lang: 'en' | 'ne') => void;
  login: (userId: string) => void;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
  theme: ThemeMode;
  toggleTheme: () => void;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  composerPostId: string | null | undefined;
  openComposer: (postId?: string | null) => void;
  closeComposer: () => void;
  createChooserOpen: boolean;
  openCreateChooser: () => void;
  closeCreateChooser: () => void;
  /** Which home feed tab is showing. The top bar owns the buttons, the feed reads it. */
  feedTab: 'foryou' | 'following';
  setFeedTab: (tab: 'foryou' | 'following') => void;
  toast: string | null;
  showToast: (msg: string) => void;
  hideToast: () => void;
  /** A question the reader answers in the toast bar, never in the browser's dialog. */
  confirmBox: { text: string; onYes: () => void } | null;
  showConfirm: (text: string, onYes: () => void) => void;
  hideConfirm: () => void;
  /** Session bootstrap has finished (signed in or anonymous). */
  ready: boolean;
  /** The API did not answer and is being waited on — say so instead of spinning. */
  waking: boolean;
  /** True while the live Django API drives the cache. */
  serverMode: boolean;
  /** Re-pull /api/sync/: session, graph edges, saves, wallet and unread counters. */
  resync: () => Promise<void>;
  /** Apply a server fragment onto the cache without a round-trip. */
  merge: (frag: Fragment) => void;
  /** Email and a password, the only pair this server accepts. */
  signin: (email: string, password: string) => Promise<AuthResult>;
  signupAccount: (payload: SignupPayload) => Promise<AuthResult>;
  verifyCode: (challenge: string | number, code: string) => Promise<AuthResult>;
  resendCode: (challenge: string | number) => Promise<CodeResult>;
  googleSignIn: (token: { id_token?: string; demo?: { email: string; name: string; sub: string } }) => Promise<AuthResult>;
  /** Step one of a forgotten password: mail a code to the address. */
  requestPasswordReset: (email: string) => Promise<CodeResult>;
  /** Step two: the code plus the new password, which signs nobody in. */
  confirmPasswordReset: (challenge: string | number, code: string, password: string, email?: string) => Promise<AuthResult>;
  updateProfile: (patch: Record<string, any>) => Promise<void>;
  /** Step one: the typed word goes to the server, which mails the code. */
  requestAccountDeletion: (confirm: string) => Promise<{ challenge?: number; dev_code?: string; detail?: string }>;
  /** Step two: the code deletes the account, its rows and its pictures. */
  confirmAccountDeletion: (challenge: number, code: string) => Promise<void>;
  loadPerson: (username: string) => Promise<PersonRead | null>;
  /** Pull one post or listing by id so a detail page opened cold still renders. */
  loadEntity: (kind: 'post' | 'listing', id: string) => Promise<'ok' | 'missing' | 'error'>;
}

/** What one `/api/profiles/<username>/` read answers: the person plus their totals. */
export interface PersonRead {
  person: User;
  stats: { posts: number; followers: number; following: number };
  locked: boolean;
}

export interface PromoConfig {
  packageId: string;
  category: string;
  ageMin: number;
  ageMax: number;
  country: string;
  city: string;
}

export interface PromoTarget {
  category?: string;
  ageMin?: number;
  ageMax?: number;
  country?: string;
  city?: string;
}

export interface SignupPayload {
  username: string;
  email: string;
  password: string;
  name: string;
  dob: string;
  country: string;
  province?: string;
  city?: string;
  google?: { sub: string; email: string; name: string };
}

export interface AuthResult {
  ok: boolean;
  status: number;
  user?: User;
  /** An email code must be confirmed before the session is usable. */
  challenge?: string;
  devCode?: string;
  /** Seconds the challenge stays valid, so the UI can count it down. */
  expiresIn?: number;
  emailHint?: string;
  newDevice?: boolean;
  /** Right password, address never confirmed: the code box is the way in. */
  emailNotVerified?: boolean;
  needsVerify?: boolean;
  needsSignup?: boolean;
  prefill?: { email: string; name: string; google_sub: string };
  locked?: boolean;
  lockedUntil?: number;
  /** Seconds of cooloff left, counted on the server clock. */
  retryIn?: number;
  /** A lock closed more than the password box: 'email', 'ip' or 'device'. */
  banned?: boolean;
  banScope?: string;
  /** The account was made by Google and has no password to type. */
  googleOnly?: boolean;
  /** The seat is closed by staff, so no credential opens it. */
  suspended?: boolean;
  suspendedUntil?: number;
  permanent?: boolean;
  attemptsLeft?: number;
  detail?: string;
  errors?: Record<string, string[]>;
  /** The server's handle for a failed call. Quoting it finds the log line. */
  requestId?: string;
}

export interface CodeResult {
  challenge?: string;
  devCode?: string;
  expiresIn?: number;
  detail?: string;
  error?: string;
  /** Seconds until another code can be asked for — the server's number, not a guess. */
  resendIn?: number;
  retryIn?: number;
}

/**
 * The inline script in layout.tsx already picked a theme before first paint;
 * this has to agree with it or hydration would flip the page back to light.
 * Desktop starts dark because that is the product's viewing mode, and a stored
 * choice always beats the default.
 */
function readTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(min-width: 1024px)').matches ? 'dark' : 'light';
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [db, setDb] = useState<Database>(() => (API_ENABLED ? emptyDb() : getDb()));
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(!API_ENABLED);
  const [waking, setWaking] = useState(false);
  const [serverMode, setServerMode] = useState(API_ENABLED);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composerPostId, setComposerPostId] = useState<string | null | undefined>(undefined);
  const [createChooserOpen, setCreateChooserOpen] = useState(false);
  const [feedTab, setFeedTab] = useState<'foryou' | 'following'>('foryou');
  const [toast, setToast] = useState<string | null>(null);
  const [confirmBox, setConfirmBox] = useState<{ text: string; onYes: () => void } | null>(null);

  /** Async continuations read the cache through this ref, never a captured render. */
  const dbRef = useRef(db);
  dbRef.current = db;

  /** Stable identity: screens list it in an effect's deps to fetch once per subject. */
  const merge = useCallback((frag: Fragment) => setDb(cur => applyFragment(cur, frag)), []);

  useEffect(() => bindListCache(frag => setDb(cur => applyFragment(cur, frag))), []);

  useEffect(() => onWakeChange(setWaking), []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    setMounted(true);
    const next = readTheme();
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    const storedLang = localStorage.getItem(LANG_KEY);
    if (storedLang === 'en' || storedLang === 'ne') setDb(prev => (prev.lang === storedLang ? prev : { ...prev, lang: storedLang }));
    if (API_ENABLED) {
      void bootstrap();
      return;
    }
    hydrateVideoSrcs(db).then(srcs => {
      if (!srcs.size) return;
      setDb(cur => ({
        ...cur,
        posts: cur.posts.map(p => ({
          ...p,
          media: (p.media || []).map(m => m.blobId && srcs.has(m.blobId) ? { ...m, src: srcs.get(m.blobId) } : m)
        }))
      }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (API_ENABLED) return;
    if (mounted && !save(db)) setToast('Device storage is full — the latest change may not persist.');
  }, [db, mounted]);

  useEffect(() => {
    if (!toast) return;
    const to = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(to);
  }, [toast]);

  const me = db.users.find(u => u.id === db.meId) || null;
  const isAuthenticated = !!me;
  const isAdmin = () => !!(me && (me.role === 'admin' || me.role === 'superadmin'));
  const isStaff = () => !!(me && me.role !== 'user');

  const t = (key: TranslationKey, vars?: Record<string, string | number>) => {
    let s: string = (I18N[db.lang] as Record<string, string>)[key] || (I18N.en as Record<string, string>)[key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    }
    return s;
  };

  const feature = (key: keyof FeatureFlags) => db.settings.features[key];

  const lastToastRef = useRef<{ msg: string; at: number } | null>(null);
  const showToast = (msg: string) => {
    // One action fires several calls and a stalled server fails them all, then
    // fails every retry. The same sentence twice inside one display window is
    // noise, not news — hold the standing toast instead of strobing the screen.
    const last = lastToastRef.current;
    if (last && last.msg === msg && Date.now() - last.at < 4500) return;
    lastToastRef.current = { msg, at: Date.now() };
    setToast(msg);
  };

  /**
   * A destructive action asks in the bar at the foot of the screen, not through
   * window.confirm: the browser's dialog is unstyled, blocks the whole page, and
   * on a phone names the origin instead of the thing being deleted.
   */
  const showConfirm = (text: string, onYes: () => void) => {
    // Both bars sit at the same spot, so a question takes the space over.
    setToast(null);
    setConfirmBox({ text, onYes });
  };
  const hideConfirm = () => setConfirmBox(null);
  const hideToast = () => setToast(null);

  /** Fresh signed-in user record, read at the moment an async continuation needs it. */
  const currentMe = (): User | null => {
    const id = dbRef.current.meId;
    return id ? dbRef.current.users.find(u => u.id === id) || null : null;
  };

  const usernameOf = (userId: string) => dbRef.current.users.find(u => u.id === userId)?.username;

  const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  /** Write the one round-trip that hydrates session, graph, saves, promotions and counters. */
  const pullSession = async (): Promise<User | null> => {
    let payload: any;
    try {
      payload = await api.get<any>('/api/sync/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setDb(prev => ({ ...prev, meId: null, unread: undefined }));
      }
      return null;
    }
    const self = mapMe(payload.me);
    const serverNow = at(payload.server_time);
    setDb(prev => ({
      ...applyFragment(prev, {
        // Self goes last: a thin person card invents account flags (twoStep,
        // emailVerified) that must never overwrite what the session really says.
        users: [...(payload.people || []).map(mapPerson), ...(payload.suggestions || []).map(mapPerson), self],
        follows: (payload.follows || []).map(mapFollow),
        saves: (payload.saves?.posts || []).map((pid: number) => ({ uid: self.id, pid: idOf(pid), ts: serverNow })),
        listingSaves: (payload.saves?.listings || []).map((lid: number) => ({ uid: self.id, lid: idOf(lid), ts: serverNow })),
        promotions: (payload.promotions || []).map(mapPromotion),
      }),
      meId: self.id,
      blocks: (payload.blocks || []).map(idOf),
      settings: mapSettings(payload.config || prev.settings),
      unread: payload.unread,
      serverTime: serverNow,
    }));
    return self;
  };

  const resync = async () => {
    if (!API_ENABLED) return;
    await pullSession();
  };

  /**
   * Badges are the one thing that has to age in place: both counters are
   * re-pulled when the tab wakes and when the reader moves, not only at boot.
   */
  const pullBadges = useCallback(async () => {
    if (!API_ENABLED || !dbRef.current.meId) return;
    const before = dbRef.current.unread;
    const me = dbRef.current.meId;
    try {
      const row = await api.get<any>('/api/notifications/unread/');
      const next = { notifications: Number(row.unread) || 0, messages: Number(row.messages) || 0 };
      setDb(prev => (prev.meId ? { ...prev, unread: next } : prev));
      // A badge that grew means rows exist that no list has been told about. The
      // stream is the fast path for them, but a stream that is open and silent —
      // buffered by a proxy, refused by a WSGI worker — would otherwise leave the
      // reader staring at a number over an empty column.
      if (before && next.messages > before.messages) void refreshList('inbox', inboxListDef(me || ''));
      if (before && next.notifications > before.notifications) {
        void refreshList('notifications', { path: '/notifications/', frag: notificationsFragment });
      }
    } catch { /* a badge a beat behind is not worth interrupting anyone for */ }
  }, []);

  const selfId = db.meId;
  useEffect(() => {
    if (!serverMode || !selfId) return;
    void pullBadges();
    const timer = setInterval(() => void pullBadges(), 30000);
    const wake = () => { if (typeof document !== 'undefined' && document.visibilityState === 'visible') void pullBadges(); };
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [serverMode, selfId, pathname, pullBadges]);

  /**
   * The bell's live line. Server-Sent Events push every new notification row;
   * when the stream dies three times in a row the hook drops to HTTP polling
   * with a growing interval, and keeps trying the stream again every minute.
   * Hidden tabs close the socket entirely — nothing ships while nobody watches.
   */
  useEffect(() => {
    if (!serverMode || !selfId) return;

    const POLL_BASE = 15000;
    const POLL_CAP = 300000;

    let es: EventSource | null = null;
    let errors = 0;
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollDelay = POLL_BASE;
    let lastEsAttempt = 0;

    const absorb = (row: any) => {
      if (!row || row.recipient !== Number(selfId)) return;
      const mapped = mapNotification(row);
      setDb(prev => applyFragment(prev, notificationsFragment([row])));
      // The cache merges by id; the list's id order is what the popover renders.
      pushListRow('notifications', undefined, mapped.id);
      if (row.kind === 'message' && row.actor) {
        // The tray just announced a conversation. The column beside it has to
        // agree, including for a person never written to before, whose thread
        // did not exist when that column was last read.
        pushListRow('inbox', undefined, idOf(row.actor));
        // Not gated on the route any more: the top-bar popover reads the same
        // list, so a thread that only refreshes while the reader is standing in
        // /messages never reaches anyone who is not already there.
        void refreshList('inbox', inboxListDef(selfId));
      }
      if (row.kind === 'follow_request' || row.kind === 'follow_accept') {
        // Asking and answering both move an edge the cache still holds in its
        // old shape. The requests panel and every follow button read that
        // cache, so the graph is re-pulled here instead of waiting for a
        // reload — a request that only exists on the server cannot be accepted.
        void pullSession();
      }
      void pullBadges();
    };

    const refreshPage = () => {
      void pullBadges();
      // refreshList, not a bare fetch: the popover renders the list's id order,
      // so the state has to be refilled, not just the cache beneath it.
      void refreshList('notifications', { path: '/notifications/', frag: notificationsFragment });
      // The stream is the fast path for a new thread, but a stream that never
      // opens — a WSGI worker refusing it, a proxy buffering it — must not also
      // cost the reader the message itself. The fallback poll carries both lists.
      void refreshList('inbox', inboxListDef(selfId));
    };

    const pollTick = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      refreshPage();
      pollDelay = Math.min(pollDelay * 2, POLL_CAP);
      pollTimer = setTimeout(pollTick, pollDelay);
      // The stream gets another chance while the polls carry on.
      if (Date.now() - lastEsAttempt > 60000) open();
    };

    const startPolling = () => {
      if (pollTimer || stopped) return;
      pollDelay = POLL_BASE;
      pollTimer = setTimeout(pollTick, 0);
    };

    const stopPolling = () => {
      if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    };

    const open = () => {
      if (stopped || es || document.visibilityState !== 'visible') return;
      lastEsAttempt = Date.now();
      const source = new EventSource('/api/notifications/stream/');
      es = source;
      source.addEventListener('open', () => { errors = 0; stopPolling(); });
      source.addEventListener('notification', ev => absorb(JSON.parse((ev as MessageEvent).data)));
      source.addEventListener('error', () => {
        errors += 1;
        if (errors >= 3 && es === source) {
          source.close();
          es = null;
          startPolling();
        }
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (es) { es.close(); es = null; }
        stopPolling();
      } else {
        void pullBadges();
        refreshPage();
        open();
      }
    };

    open();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (es) es.close();
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [serverMode, selfId]);

  async function bootstrap() {
    try {
      const meta = await api.get<any>('/api/meta/');
      setDb(cur => ({ ...cur, settings: mapSettings(meta) }));
    } catch { /* keep the shipped defaults */ }
    try {
      const session = await api.get<any>('/api/auth/me/');
      setDb(cur => ({ ...cur, meId: idOf(session.id) }));
      await pullSession();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setDb(cur => ({ ...cur, meId: null }));
    } finally {
      setReady(true);
    }
  }

  const authResult = (err: unknown): AuthResult => {
    if (err instanceof ApiError) {
      return {
        ok: false,
        status: err.status,
        detail: err.message,
        errors: err.fieldErrors,
        requestId: err.requestId || undefined,
        challenge: err.data?.challenge ? idOf(err.data.challenge) : undefined,
        devCode: err.data?.dev_code,
        expiresIn: err.data?.expires_in ? Number(err.data.expires_in) : undefined,
        emailHint: err.data?.email_hint,
        newDevice: !!err.data?.new_device,
        emailNotVerified: !!err.data?.email_not_verified,
        locked: !!err.data?.locked,
        lockedUntil: at(err.data?.locked_until),
        retryIn: err.data?.retry_in === undefined ? undefined : Number(err.data.retry_in),
        banned: !!err.data?.banned,
        banScope: err.data?.scope || undefined,
        googleOnly: !!err.data?.google_only,
        suspended: !!err.data?.suspended,
        suspendedUntil: at(err.data?.suspended_until),
        permanent: !!err.data?.permanent,
        attemptsLeft: err.data?.attempts_left,
      };
    }
    return { ok: false, status: 0, detail: 'Cannot reach the server. Check your connection.' };
  };

  /**
   * A 200/201 with a `user` block means cookies are set and the session is live;
   * a 202 carries only a challenge, so the cache must not be touched yet.
   */
  const finishAuth = async (data: any): Promise<AuthResult> => {
    setServerMode(true);
    const challenge = data?.challenge ? idOf(data.challenge) : undefined;
    const expiresIn = data?.expires_in ? Number(data.expires_in) : undefined;
    if (!data?.user) {
      return { ok: true, status: 200, challenge, expiresIn, devCode: data?.dev_code, emailHint: data?.email_hint, newDevice: !!data?.new_device };
    }
    const user = await pullSession();
    setReady(true);
    return {
      ok: true,
      status: 200,
      user: user || undefined,
      challenge,
      expiresIn,
      devCode: data.dev_code,
      emailHint: data.email_hint,
      newDevice: !!data.new_device,
      needsVerify: !!challenge,
    };
  };

  const codeResult = (data: any, err?: unknown): CodeResult => {
    if (err) {
      const body = err instanceof ApiError ? err.data : null;
      return {
        error: errText(err, 'That request failed. Try again.'),
        resendIn: body?.resend_in === undefined ? undefined : Number(body.resend_in),
        retryIn: body?.retry_in === undefined ? undefined : Number(body.retry_in),
      };
    }
    return {
      challenge: data?.challenge ? idOf(data.challenge) : undefined,
      devCode: data?.dev_code,
      expiresIn: data?.expires_in ? Number(data.expires_in) : undefined,
      detail: data?.detail,
      resendIn: data?.resend_in === undefined ? undefined : Number(data.resend_in),
      retryIn: data?.retry_in === undefined ? undefined : Number(data.retry_in),
    };
  };

  const signin = async (email: string, password: string): Promise<AuthResult> => {
    try {
      return await finishAuth(await api.post('/api/auth/login/', { email, password, device_id: api.deviceId() }));
    } catch (err) {
      return authResult(err);
    }
  };

  const signupAccount = async (payload: SignupPayload): Promise<AuthResult> => {
    try {
      return await finishAuth(await api.post('/api/auth/signup/', { ...payload, device_id: api.deviceId() }));
    } catch (err) {
      return authResult(err);
    }
  };

  /** Both purposes confirm through the same endpoint; the server knows which code this is. */
  const verifyCode = async (challenge: string | number, code: string): Promise<AuthResult> => {
    try {
      return await finishAuth(await api.post('/api/auth/otp/', { challenge, code, device_id: api.deviceId() }));
    } catch (err) {
      return authResult(err);
    }
  };

  const resendCode = async (challenge: string | number) => {
    try {
      return codeResult(await api.post('/api/auth/otp/resend/', { challenge, device_id: api.deviceId() }));
    } catch (err) {
      return codeResult(null, err);
    }
  };

  const googleSignIn = async (token: { id_token?: string; demo?: { email: string; name: string; sub: string } }): Promise<AuthResult> => {
    try {
      const data = await api.post('/api/auth/google/', { ...token, device_id: api.deviceId() });
      if (data?.needs_signup) {
        return { ok: false, status: 200, needsSignup: true, prefill: data.prefill, detail: data.detail };
      }
      return await finishAuth(data);
    } catch (err) {
      return authResult(err);
    }
  };

  /** Step one of a reset: the address in, a challenge back. Never says whether it exists. */
  const requestPasswordReset = async (email: string): Promise<CodeResult> => {
    try {
      return codeResult(await api.post('/api/auth/reset/', { email, device_id: api.deviceId() }));
    } catch (err) {
      return codeResult(null, err);
    }
  };

  /** Step two: the code and the new password. The session is not reopened here. */
  const confirmPasswordReset = async (
    challenge: string | number, code: string, password: string, email = '',
  ): Promise<AuthResult> => {
    try {
      const data = await api.post('/api/auth/reset/confirm/', {
        challenge, code, password, email, device_id: api.deviceId(),
      });
      return { ok: true, status: 200, detail: data?.detail };
    } catch (err) {
      return authResult(err);
    }
  };

  const logout = async () => {
    setDb(prev => ({ ...prev, meId: null, unread: undefined }));
    setDrawerOpen(false);
    forgetLists();
    if (!API_ENABLED) return;
    try {
      await api.post('/api/auth/logout/', {});
    } catch { /* the cookie is already cleared */ }
    router.push('/login');
  };

  const updateProfile = async (patch: Record<string, any>) => {
    const self = currentMe();
    if (!self) return;
    // Demo builds have no server to call, so the cache is the source of truth — and
    // a new photo is still announced as a post, the way the API would do it.
    if (!API_ENABLED) {
      const now = Date.now();
      const changed: Array<'profile' | 'cover'> = [];
      if (patch.avatar && patch.avatar !== self.avatar) changed.push('profile');
      if (patch.cover && patch.cover !== self.cover) changed.push('cover');
      const notes: Post[] = changed.map((activity, i) => ({
        id: uid(),
        uid: self.id,
        text: '',
        media: [{ type: 'image', src: activity === 'profile' ? patch.avatar : patch.cover }],
        ts: now + i,
        status: 'live',
        activity,
      }));
      setDb(prev => ({
        ...prev,
        users: prev.users.map(u => u.id === self.id ? { ...u, ...patch } : u),
        posts: [...notes, ...prev.posts],
      }));
      return;
    }
    const data = await api.patch<any>(`/api/profiles/${self.username}/`, toProfilePayload(patch));
    merge({ users: [{ ...self, ...profilePatch(data) }] });
    // A changed photo or banner is announced by a post the server just created,
    // so the lists that already hold a page of this author have to be re-read.
    if ((patch.avatar && patch.avatar !== self.avatar) || (patch.cover && patch.cover !== self.cover)) {
      forgetLists('feed');
      forgetLists('profile-posts');
    }
  };

  const requestAccountDeletion = async (confirm: string) => {
    if (!API_ENABLED) return { detail: 'Demo accounts are kept in this browser only.' };
    return api.post<{ challenge?: number; dev_code?: string; detail?: string }>('/api/auth/delete/request/', { confirm });
  };

  const confirmAccountDeletion = async (challenge: number, code: string) => {
    const self = currentMe();
    if (API_ENABLED) {
      await api.post('/api/auth/delete/confirm/', { challenge, code });
    } else if (self) {
      // No server to ask: forget the account and everything this browser kept.
      setDb(prev => ({
        ...prev,
        meId: null,
        users: prev.users.filter(u => u.id !== self.id),
        posts: prev.posts.filter(p => p.uid !== self.id),
        comments: prev.comments.filter(c => c.uid !== self.id),
        follows: prev.follows.filter(f => f.follower !== self.id && f.following !== self.id),
        unread: undefined,
      }));
    }
    setDb(prev => ({ ...prev, meId: null, unread: undefined }));
    setDrawerOpen(false);
    forgetLists();
    router.push('/');
    showToast(t('accountDeleted'));
  };

  /**
   * One profile read gives a screen both the person and their real totals —
   * the counts live on the profile row, so no list has to be paged to count it.
   * A 404 (or any failure) reads as "no such person" and the screen says so.
   */
  const loadPerson = useCallback(async (username: string): Promise<PersonRead | null> => {
    if (!API_ENABLED || !username) return null;
    try {
      const row = await api.get<any>(`/api/profiles/${username}/`);
      const person = mapPerson(row);
      merge({ users: [person] });
      return {
        person,
        stats: {
          posts: Number(row.posts) || 0,
          followers: Number(row.followers) || 0,
          following: Number(row.following) || 0,
        },
        locked: !!row.locked,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  }, [merge]);

  /**
   * One row by primary key, for a screen opened straight from a link. A 404 or
   * a 403 is the server saying this row is not for this viewer's eyes; anything
   * else is the network, and the screen offers a retry rather than a false "gone".
   */
  const loadEntity = useCallback(async (kind: 'post' | 'listing', id: string): Promise<'ok' | 'missing' | 'error'> => {
    if (!API_ENABLED || !id) return 'error';
    try {
      const row = await api.get<any>(kind === 'post' ? `/api/posts/${id}/` : `/api/marketplace/${id}/`);
      merge(kind === 'post' ? postsFragment(currentMe()?.id || null)([row]) : listingsFragment([row]));
      return 'ok';
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403 || err.status === 401)) return 'missing';
      return 'error';
    }
  }, [merge]);

  /** Server aggregates move by hand so the UI answers instantly; pages re-read them anyway. */
  const bumpCount = (targetType: Target, targetId: string, delta: number) => {
    if (!delta) return;
    setDb(prev => {
      if (targetType === 'comment') {
        return { ...prev, comments: prev.comments.map(c => (c.id === targetId ? { ...c, likes: (c.likes ?? 0) + delta } : c)) };
      }
      if (targetType === 'media') {
        const [postId, position] = targetId.split('#m');
        return {
          ...prev,
          posts: prev.posts.map(p => (p.id === postId
            ? { ...p, media: p.media.map((m, i) => (i === Number(position) ? { ...m, likes: (m.likes ?? 0) + delta } : m)) }
            : p))
        };
      }
      return { ...prev, posts: prev.posts.map(p => (p.id === targetId ? { ...p, likes: (p.likes ?? 0) + delta } : p)) };
    });
  };

  /** Keep the per-kind maps in step with the totals so the emoji mix moves with the tap. */
  const bumpKinds = (targetType: Target, targetId: string, removed: ReactionKind | null, added: ReactionKind | null) => {
    if (targetType === 'comment' || (!removed && !added)) return;
    const adjust = (map?: Record<string, number>) => {
      const next = { ...(map || {}) };
      if (removed) {
        const left = (next[removed] || 0) - 1;
        if (left > 0) next[removed] = left; else delete next[removed];
      }
      if (added) next[added] = (next[added] || 0) + 1;
      return next;
    };
    setDb(prev => {
      if (targetType === 'media') {
        const [postId, position] = targetId.split('#m');
        return { ...prev, posts: prev.posts.map(p => (p.id === postId
          ? { ...p, media: p.media.map((m, i) => (i === Number(position) ? { ...m, reactionKinds: adjust(m.reactionKinds) } : m)) }
          : p)) };
      }
      return { ...prev, posts: prev.posts.map(p => (p.id === targetId ? { ...p, reactionKinds: adjust(p.reactionKinds) } : p)) };
    });
  };

  const addPost = async (post: Post): Promise<Post> => {
    if (!API_ENABLED) {
      setDb(prev => ({ ...prev, posts: [post, ...prev.posts] }));
      return post;
    }
    const self = currentMe();
    const row = await api.post<any>('/api/posts/', toPostPayload(post));
    const saved = mapPost(row);
    merge({
      posts: [saved],
      reactions: reactionsOfPost(row, self ? self.id : saved.uid),
    });
    return { ...saved, kind: post.kind };
  };

  const updatePost = async (id: string, updates: Partial<Post>) => {
    const before = dbRef.current.posts.find(p => p.id === id);
    setDb(prev => ({ ...prev, posts: prev.posts.map(p => (p.id === id ? { ...p, ...updates } : p)) }));
    if (!API_ENABLED) return;
    try {
      const payload: Record<string, any> = {};
      if (updates.text !== undefined) {
        payload.text = updates.text;
        payload.category = updates.category !== undefined ? updates.category : (before?.category || '');
      }
      if (updates.mood !== undefined) payload.mood = updates.mood || '';
      if (updates.place !== undefined) payload.place = updates.place || '';
      if (updates.audience !== undefined) payload.audience = updates.audience;
      if (updates.media !== undefined) payload.media = mediaPayload(updates.media);
      merge({ posts: [mapPost(await api.patch<any>(`/api/posts/${id}/`, payload))] });
    } catch (err) {
      if (before) setDb(prev => ({ ...prev, posts: prev.posts.map(p => (p.id === id ? before : p)) }));
      showToast(errText(err, 'That change could not be saved.'));
    }
  };

  const deletePost = async (id: string) => {
    const snapshot = dbRef.current;
    setDb(prev => ({
      ...prev,
      posts: prev.posts.filter(p => p.id !== id),
      comments: prev.comments.filter(c => c.pid !== id),
      reactions: prev.reactions.filter(r => !(r.targetId === id || r.targetId.startsWith(`${id}#m`))),
      saves: prev.saves.filter(s => s.pid !== id),
      reports: prev.reports.filter(r => !(r.type === 'post' && r.targetId === id))
    }));
    if (!API_ENABLED) return;
    try {
      await api.del(`/api/posts/${id}/`);
    } catch (err) {
      setDb(snapshot);
      showToast(errText(err, 'The post is still up.'));
    }
  };

  const addComment = async (comment: Comment): Promise<Comment> => {
    if (!API_ENABLED) {
      setDb(prev => ({ ...prev, comments: [...prev.comments, comment] }));
      return comment;
    }
    const row = await api.post<any>('/api/comments/', {
      post: comment.pid,
      parent: comment.parentId || null,
      media_index: comment.mediaIndex === undefined ? null : comment.mediaIndex,
      text: comment.text,
    });
    const saved = mapComment(row);
    merge({ comments: [saved] });
    setDb(prev => ({ ...prev, posts: prev.posts.map(p => (p.id === saved.pid ? { ...p, comments: (p.comments ?? 0) + 1 } : p)) }));
    return saved;
  };

  const deleteComment = async (id: string) => {
    const snapshot = dbRef.current;
    setDb(prev => ({
      ...prev,
      comments: prev.comments.filter(c => c.id !== id && c.parentId !== id),
      reactions: prev.reactions.filter(r => !(r.targetType === 'comment' && r.targetId === id)),
      reports: prev.reports.filter(r => !(r.type === 'comment' && r.targetId === id))
    }));
    if (!API_ENABLED) return;
    try {
      await api.del(`/api/comments/${id}/`);
    } catch (err) {
      setDb(snapshot);
      showToast(errText(err, 'The comment is still up.'));
    }
  };

  const isFollowing = (targetId: string) => {
    const self = currentMe();
    const edge = self ? db.follows.find(f => f.follower === self.id && f.following === targetId) : undefined;
    return !!edge && edge.status !== 'pending';
  };

  const followState = (targetId: string): 'none' | 'pending' | 'following' => {
    const self = currentMe();
    const edge = self ? db.follows.find(f => f.follower === self.id && f.following === targetId) : undefined;
    if (!edge) return 'none';
    return edge.status === 'pending' ? 'pending' : 'following';
  };

  const requestFrom = (targetId: string): Follow | null => {
    const self = currentMe();
    if (!self) return null;
    return db.follows.find(f => f.follower === targetId && f.following === self.id && f.status === 'pending') || null;
  };

  const incomingRequests = () => {
    const self = currentMe();
    return self ? db.follows.filter(f => f.following === self.id && f.status === 'pending') : [];
  };

  const mutualIds = () => {
    const self = currentMe();
    if (!self) return [] as string[];
    const mine = new Set(db.follows.filter(f => f.follower === self.id && f.status !== 'pending').map(f => f.following));
    return db.follows.filter(f => f.following === self.id && f.status !== 'pending' && mine.has(f.follower)).map(f => f.follower);
  };

  const edgeOf = (followerId: string, followingId: string) =>
    dbRef.current.follows.find(f => f.follower === followerId && f.following === followingId);

  const putEdge = (edge: Follow) => setDb(prev => ({
    ...prev,
    follows: [...prev.follows.filter(f => !(f.follower === edge.follower && f.following === edge.following)), edge]
  }));

  const dropEdge = (followerId: string, followingId: string) => setDb(prev => ({
    ...prev,
    follows: prev.follows.filter(f => !(f.follower === followerId && f.following === followingId))
  }));

  const followInFlight = useRef<Set<string>>(new Set());
  const toggleFollow = async (targetId: string) => {
    // One network round per tap: a rapid second tap on the same author must
    // not read the not-yet-rendered edge and turn the follow into an unfollow.
    if (followInFlight.current.has(targetId)) return;
    followInFlight.current.add(targetId);
    try {
      const self = currentMe();
      if (!self || self.id === targetId) return;
      const username = usernameOf(targetId);
      if (API_ENABLED && !username) return;
      const existing = edgeOf(self.id, targetId);
      if (existing) {
        dropEdge(self.id, targetId);
        if (API_ENABLED) {
          try {
            await api.del(`/api/follows/${username}/`);
          } catch (err) {
            putEdge(existing);
            showToast(errText(err, 'Could not update follow.'));
            return;
          }
        }
        if (existing.status === 'pending') {
          // Withdrawing the ask settles the other member's bell row server-side;
          // this reader's own counters are re-read so nothing waits on a visit
          // to Notifications.
          void pullBadges();
          showToast('Follow request cancelled.');
        }
        return;
      }
      const target = dbRef.current.users.find(u => u.id === targetId);
      const pending = !!target?.private;
      putEdge({ follower: self.id, following: targetId, ts: Date.now(), status: pending ? 'pending' : 'accepted' });
      notify(targetId, 'follow', pending ? 'requested to follow you' : 'started following you', pending ? `/u/${self.username}/followers` : `/u/${self.username}`, self.username);
      if (API_ENABLED) {
        try {
          const data = await api.post<any>('/api/follows/', { username });
          putEdge({ follower: self.id, following: targetId, ts: at(data?.created_at) || Date.now(), status: data?.status === 'pending' ? 'pending' : 'accepted' });
        } catch (err) {
          dropEdge(self.id, targetId);
          showToast(errText(err, 'Could not follow.'));
          return;
        }
      }
      if (pending) showToast('Follow request sent.');
    } finally {
      followInFlight.current.delete(targetId);
    }
  };

  const requestEdge = (followerId: string) => {
    const self = currentMe();
    return self ? edgeOf(followerId, self.id) : undefined;
  };

  const moderateRequest = async (followerId: string, accept: boolean) => {
    const self = currentMe();
    if (!self) return;
    const edge = requestEdge(followerId);
    if (!edge) return;
    if (accept) putEdge({ ...edge, status: 'accepted' });
    else dropEdge(followerId, self.id);
    if (API_ENABLED) {
      if (!edge.rid) {
        if (accept) putEdge(edge); else putEdge({ ...edge, status: 'pending' });
        showToast('Re-syncing the request list…');
        await resync();
        return;
      }
      try {
        // The username rides along because the row id is only a snapshot: the
        // server answers the request that is actually standing between us.
        await api.post(`/api/follows/requests/${edge.rid}/${accept ? 'accept' : 'decline'}/`, { username: usernameOf(followerId) });
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          dropEdge(followerId, self.id);
          // Nothing was waiting, so whatever the bell said about this ask is
          // already out of date — the withdraw settled it.
          void pullBadges();
          showToast('That request is no longer waiting.');
          return;
        }
        if (accept) putEdge(edge); else putEdge({ ...edge, status: 'pending' });
        showToast(errText(err, 'That request could not be updated.'));
        return;
      }
      // Answering on this page is the whole point of the notification, so the
      // server clears the row and the badge is re-read to agree with it.
      void pullBadges();
    }
    if (accept) notify(followerId, 'follow', 'accepted your follow request', `/u/${self.username}`, self.username);
    showToast(accept ? 'Follow request accepted.' : 'Follow request declined.');
  };

  const acceptRequest = (followerId: string) => moderateRequest(followerId, true);
  const declineRequest = (followerId: string) => moderateRequest(followerId, false);

  /** Take a person out of my followers. Silent, and it is not a block. */
  const removeFollower = async (followerId: string) => {
    const self = currentMe();
    if (!self || self.id === followerId) return;
    const edge = edgeOf(followerId, self.id);
    if (!edge) return;
    const username = usernameOf(followerId);
    if (API_ENABLED && !username) return;
    dropEdge(followerId, self.id);
    if (API_ENABLED) {
      try {
        await api.del(`/api/follows/${username}/follower/`);
      } catch (err) {
        putEdge(edge);
        showToast(errText(err, 'That follower could not be removed.'));
        return;
      }
    }
    showToast('Follower removed.');
  };

  const myReaction = (targetType: Target, targetId: string) => {
    const self = currentMe();
    if (!self) return null;
    return db.reactions.find(r => r.targetType === targetType && r.targetId === targetId && r.uid === self.id)?.kind || null;
  };

  /** Server aggregates in API mode; the demo cache counts its own reaction rows. */
  const reactionCount = (targetType: Target, targetId: string): number => {
    if (targetType === 'post') {
      const post = db.posts.find(p => p.id === targetId);
      if (post?.likes !== undefined) return post.likes;
    }
    if (targetType === 'comment') {
      const comment = db.comments.find(c => c.id === targetId);
      if (comment?.likes !== undefined) return comment.likes;
    }
    if (targetType === 'media') {
      const [postId, position] = targetId.split('#m');
      const media = db.posts.find(p => p.id === postId)?.media?.[Number(position)];
      if (media?.likes !== undefined) return media.likes;
    }
    return db.reactions.filter(r => r.targetType === targetType && r.targetId === targetId).length;
  };

  /** The emoji people actually used, most common first — a post folds in its media. */
  const reactionMix = (targetType: Target, targetId: string): { kind: ReactionKind; n: number }[] => {
    const kinds: Record<string, number> = {};
    const add = (map?: Record<string, number>) => {
      if (!map) return;
      for (const k in map) kinds[k] = (kinds[k] || 0) + (map[k] || 0);
    };
    if (targetType === 'post') {
      const post = db.posts.find(p => p.id === targetId);
      if (post?.reactionKinds || post?.media?.some(m => m.reactionKinds)) {
        add(post?.reactionKinds);
        post?.media?.forEach(m => add(m.reactionKinds));
      } else {
        for (const r of db.reactions) {
          if ((r.targetType === 'post' && r.targetId === targetId) || (r.targetType === 'media' && r.targetId.startsWith(`${targetId}#m`))) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
        }
      }
    } else if (targetType === 'media') {
      const [postId, position] = targetId.split('#m');
      const media = db.posts.find(p => p.id === postId)?.media?.[Number(position)];
      if (media?.reactionKinds) add(media.reactionKinds);
      else for (const r of db.reactions) if (r.targetType === 'media' && r.targetId === targetId) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    } else {
      for (const r of db.reactions) if (r.targetType === targetType && r.targetId === targetId) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    }
    return Object.entries(kinds).map(([kind, n]) => ({ kind: kind as ReactionKind, n })).sort((a, b) => reactionRank(a.kind) - reactionRank(b.kind));
  };

  /** The viewer's own take on a post, whether they pressed it on the card or on a photo. */
  const myPostReaction = (postId: string): ReactionKind | null => {
    const direct = myReaction('post', postId);
    if (direct) return direct;
    const post = db.posts.find(p => p.id === postId);
    for (let position = 0; position < (post?.media?.length || 0); position += 1) {
      const mine = myReaction('media', `${postId}#m${position}`);
      if (mine) return mine;
    }
    return null;
  };

  /**
   * The names a card prints under its icons — you, then the people you follow.
   *
   * A stranger is not a name worth printing: the reader already knows how many
   * people reacted, and the row is about the ones they chose to keep near them.
   * The server sends its preview in the same order (you, followed, everyone
   * else), so dropping the last bucket here cannot hide a followed person —
   * they were always printed before the strangers.
   */
  const reactionPeople = (postId: string): { id: string; name: string; kind: ReactionKind; me: boolean }[] => {
    const self = currentMe();
    const post = db.posts.find(p => p.id === postId);
    if (!post) return [];
    const bucket = (uid: string) => (self && uid === self.id ? 0 : followState(uid) === 'following' ? 1 : 2);
    const rows: { id: string; name: string; kind: ReactionKind; me: boolean; at: number }[] = [];
    const mine = myPostReaction(postId);
    if (self && mine) rows.push({ id: self.id, name: self.name, kind: mine, me: true, at: Date.now() });
    if (serverMode && post.people?.length) {
      for (const person of post.people) {
        if (self && person.id === self.id) continue;
        rows.push({ ...person, at: 0 });
      }
    } else {
      const seen = new Set(rows.map(r => r.id));
      for (const r of db.reactions) {
        if (seen.has(r.uid)) continue;
        const onPost = r.targetType === 'post' && r.targetId === postId;
        const onMedia = r.targetType === 'media' && r.targetId.startsWith(`${postId}#m`);
        if (!onPost && !onMedia) continue;
        seen.add(r.uid);
        rows.push({ id: r.uid, name: db.users.find(u => u.id === r.uid)?.name || '', kind: r.kind, me: !!self && r.uid === self.id, at: r.ts });
      }
    }
    return rows
      .filter(r => bucket(r.id) < 2)
      .sort((a, b) => bucket(a.id) - bucket(b.id) || b.at - a.at)
      .slice(0, 3)
      .map(({ id, name, kind, me }) => ({ id, name, kind, me }));
  };

  const react = async (targetType: Target, targetId: string, kind: ReactionKind) => {
    const self = currentMe();
    if (!self) return;
    const mine = (prev: Database) => prev.reactions.filter(r => !(r.targetType === targetType && r.targetId === targetId && r.uid === self.id));
    const existing = myReaction(targetType, targetId);
    const off = existing === kind;
    const nextKind: ReactionKind | null = off ? null : kind;
    setDb(prev => ({
      ...prev,
      reactions: nextKind ? [...mine(prev), { id: uid(), targetType, targetId, uid: self.id, kind: nextKind, ts: Date.now() }] : mine(prev)
    }));
    if (!API_ENABLED) return;
    bumpCount(targetType, targetId, (nextKind ? 1 : 0) - (existing ? 1 : 0));
    bumpKinds(targetType, targetId, existing, nextKind);
    try {
      if (off) await api.del('/api/reactions/toggle/', { target_type: targetType, target_id: targetId });
      else await api.post('/api/reactions/', { target_type: targetType, target_id: targetId, kind });
    } catch (err) {
      setDb(prev => ({
        ...prev,
        reactions: existing
          ? [...mine(prev), { id: uid(), targetType, targetId, uid: self.id, kind: existing, ts: Date.now() }]
          : mine(prev)
      }));
      bumpCount(targetType, targetId, (existing ? 1 : 0) - (nextKind ? 1 : 0));
      bumpKinds(targetType, targetId, nextKind, existing);
      showToast(errText(err, 'Sign in to react.'));
    }
  };

  const isSaved = (pid: string) => {
    const self = currentMe();
    return !!self && db.saves.some(s => s.uid === self.id && s.pid === pid);
  };

  const toggleSave = async (pid: string) => {
    const self = currentMe();
    if (!self) return;
    const saved = isSaved(pid);
    const mine = (prev: Database) => prev.saves.filter(s => !(s.uid === self.id && s.pid === pid));
    setDb(prev => ({ ...prev, saves: saved ? mine(prev) : [...mine(prev), { uid: self.id, pid, ts: Date.now() }] }));
    if (API_ENABLED) {
      try {
        if (saved) await api.del(`/api/saved/posts/${pid}/`);
        else await api.post('/api/saved/posts/', { post: pid });
      } catch (err) {
        setDb(prev => ({ ...prev, saves: saved ? [...mine(prev), { uid: self.id, pid, ts: Date.now() }] : mine(prev) }));
        showToast(errText(err, 'Could not save.'));
        return;
      }
    }
    showToast(saved ? t('unsave') : t('saved'));
  };

  /** Shares and views are tallies on one post, so they move without a row rewrite. */
  const bumpTally = (pid: string, field: 'shares' | 'views', delta: number) =>
    setDb(prev => ({ ...prev, posts: prev.posts.map(p => (p.id === pid ? { ...p, [field]: (p[field] ?? 0) + delta } : p)) }));

  const settleTally = (pid: string, field: 'shares' | 'views', value: unknown) => {
    if (typeof value !== 'number') return;
    setDb(prev => ({ ...prev, posts: prev.posts.map(p => (p.id === pid ? { ...p, [field]: value } : p)) }));
  };

  const sharePost = async (pid: string) => {
    // The link has already left the app by the time this is called, so a refused
    // POST is a lost tally and nothing the reader should be told about.
    bumpTally(pid, 'shares', 1);
    if (!API_ENABLED) return;
    try {
      const data = await api.post<any>(`/api/posts/${pid}/share/`, {});
      settleTally(pid, 'shares', data?.share_count);
    } catch { /* counted locally; the server will agree on the next read */ }
  };

  const countView = async (pid: string) => {
    bumpTally(pid, 'views', 1);
    if (!API_ENABLED) return;
    try {
      const data = await api.post<any>(`/api/posts/${pid}/view/`, {});
      settleTally(pid, 'views', data?.views);
    } catch { /* a reel still plays when its counter refuses */ }
  };

  const blockedIds = () => db.blocks || [];
  const isBlocked = (targetId: string) => (db.blocks || []).includes(targetId);

  const blockUser = async (targetId: string) => {
    const self = currentMe();
    if (!self || self.id === targetId) return;
    const before = dbRef.current.blocks || [];
    setDb(prev => ({ ...prev, blocks: [...before.filter(id => id !== targetId), targetId] }));
    if (API_ENABLED) {
      const username = usernameOf(targetId);
      if (!username) return;
      try {
        await api.post('/api/blocks/', { username });
      } catch (err) {
        setDb(prev => ({ ...prev, blocks: before }));
        showToast(errText(err, 'Could not block.'));
        return;
      }
    }
    // A block severs the follow in both directions, and the feed is built from
    // that graph — so the shelves that show their work are dropped, not patched.
    setDb(prev => ({
      ...prev,
      follows: prev.follows.filter(f => !(
        (f.follower === self.id && f.following === targetId) || (f.follower === targetId && f.following === self.id)
      )),
    }));
    forgetLists('feed');
    forgetLists('reels');
    forgetLists('posts');
    showToast('Blocked. Their posts are out of your feed.');
  };

  const unblockUser = async (targetId: string) => {
    const before = dbRef.current.blocks || [];
    setDb(prev => ({ ...prev, blocks: before.filter(id => id !== targetId) }));
    if (API_ENABLED) {
      const username = usernameOf(targetId);
      if (!username) return;
      try {
        await api.del(`/api/blocks/${username}/`);
      } catch (err) {
        setDb(prev => ({ ...prev, blocks: before }));
        showToast(errText(err, 'Could not unblock.'));
        return;
      }
    }
    forgetLists('feed');
    forgetLists('reels');
    forgetLists('posts');
    showToast('Unblocked.');
  };

  const isListingSaved = (lid: string) => {
    const self = currentMe();
    return !!self && (db.listingSaves || []).some(s => s.uid === self.id && s.lid === lid);
  };

  const toggleListingSave = async (lid: string) => {
    const self = currentMe();
    if (!self) return;
    const saved = isListingSaved(lid);
    const mine = (prev: Database) => (prev.listingSaves || []).filter(s => !(s.uid === self.id && s.lid === lid));
    setDb(prev => ({ ...prev, listingSaves: saved ? mine(prev) : [...mine(prev), { uid: self.id, lid, ts: Date.now() }] }));
    if (API_ENABLED) {
      try {
        if (saved) await api.del(`/api/saved/listings/${lid}/`);
        else await api.post('/api/saved/listings/', { listing: lid });
      } catch (err) {
        setDb(prev => ({ ...prev, listingSaves: saved ? [...mine(prev), { uid: self.id, lid, ts: Date.now() }] : mine(prev) }));
        showToast(errText(err, 'Could not save.'));
        return;
      }
    }
    showToast(saved ? t('unsave') : t('saved'));
  };

  /**
   * Demo mode writes notification rows into the local feed. With the API the
   * server owns them, so this only nudges the badge and the caller re-syncs.
   */
  const notify = (targetUid: string, kind: NotificationKind, text: string, href?: string, actor?: string) => {
    if (API_ENABLED) return;
    setDb(prev => ({
      ...prev,
      notifications: [{ id: uid(), uid: targetUid, kind, text, href, actor, ts: Date.now(), read: false }, ...prev.notifications]
    }));
  };

  const markAllRead = async () => {
    const self = currentMe();
    if (!self) return;
    // Only an API session needs a stored badge: the server counts what the
    // client has not fetched. A demo session holds every row, so writing an
    // aggregate here would freeze the bell at zero and hide anything that
    // arrives afterwards.
    setDb(prev => ({
      ...prev,
      notifications: prev.notifications.map(n => (n.uid === self.id ? { ...n, read: true } : n)),
      ...(API_ENABLED ? { unread: { notifications: 0, messages: prev.unread?.messages || 0 } } : {})
    }));
    if (!API_ENABLED) return;
    try {
      await api.post('/api/notifications/read/', {});
    } catch (err) {
      showToast(errText(err, 'Notifications are still unread.'));
      await resync();
    }
  };

  /**
   * Opening one activity is a read receipt the server has to remember; marking
   * only the local copy would bring the dot back on the next load.
   */
  const markRead = async (id: string) => {
    const self = currentMe();
    if (!self) return;
    setDb(prev => ({
      ...prev,
      notifications: prev.notifications.map(n => (n.id === id && n.uid === self.id ? { ...n, read: true } : n))
    }));
    if (!API_ENABLED) return;
    try {
      await api.post('/api/notifications/read/', { ids: [id] });
      void pullBadges();
    } catch { /* the worst case is a dot that returns on reload */ }
  };

  const sendMessage = async (to: string, text: string) => {
    const self = currentMe();
    const body = text.trim();
    if (!self || !body) return;
    if (!API_ENABLED) {
      const id = uid();
      const sent: Message = { id, from: self.id, to, text: body, ts: Date.now(), read: false, status: 'sent' };
      setDb(prev => ({
        ...prev,
        // A receipt still waiting from an earlier session was delivered long ago.
        messages: [...prev.messages.map(m => (m.from === self.id && m.status === 'sent' ? { ...m, status: 'delivered' as const } : m)), sent],
        notifications: [{ id: uid(), uid: to, kind: 'message', actor: self.id, text: 'sent you a message', href: `/messages/${self.username}`, ts: Date.now(), read: false }, ...prev.notifications]
      }));
      setTimeout(() => setDb(prev => ({
        ...prev,
        messages: prev.messages.map(m => (m.id === id && m.status === 'sent' ? { ...m, status: 'delivered' as const } : m)),
      })), 1500);
      return;
    }
    const username = usernameOf(to);
    if (!username) return;
    const optimistic = { id: uid(), from: self.id, to, text: body, ts: Date.now(), read: false, status: 'sent' as const };
    setDb(prev => ({ ...prev, messages: [...prev.messages, optimistic] }));
    try {
      const row = await api.post<any>(`/api/messages/${username}/`, { text: body });
      const real = mapMessage(row, self.id, to);
      setDb(prev => {
        // A live wire can beat the response to the same row. Whichever arrives
        // second must not leave the bubble on screen twice under two ids.
        const echoed = prev.messages.some(m => m.id === real.id);
        return {
          ...prev,
          messages: echoed
            ? prev.messages.filter(m => m.id !== optimistic.id)
            : prev.messages.map(m => (m.id === optimistic.id ? real : m)),
        };
      });
      // The first message to a person makes the thread the inbox is a list of.
      pushListRow('inbox', undefined, to);
    } catch (err) {
      setDb(prev => ({ ...prev, messages: prev.messages.filter(m => m.id !== optimistic.id) }));
      showToast(errText(err, 'Message not sent.'));
    }
  };

  /**
   * Opening a thread reads all of it — including the messages above the page
   * this screen happened to load. So the server is asked in server mode, and the
   * badge is re-pulled rather than decremented by whatever rows were cached.
   * Receipts are cosmetic: a failed mark still reads locally and never
   * interrupts the conversation.
   */
  // Stable identity: a thread screen calls this on open, and a fresh function
  // per render would turn that one call into a request per render.
  const markThreadRead = useCallback(async (username: string, opts?: { force?: boolean }) => {
    const self = currentMe();
    const other = dbRef.current.users.find(u => u.username === username);
    if (!self || !other) return;
    const unread = dbRef.current.messages.filter(m => m.from === other.id && m.to === self.id && !m.read);
    // Nothing cached reads, but the badge says something does: the row is
    // simply above the pages this thread has walked. Ask the server anyway.
    // force skips the guard for socket deliveries, which arrive before the
    // render that would make dbRef see them.
    if (!opts?.force && !unread.length && !dbRef.current.unread?.messages) return;
    setDb(prev => ({
      ...prev,
      messages: prev.messages.map(m => (m.from === other.id && m.to === self.id && !m.read ? { ...m, read: true } : m)),
      unread: prev.unread ? { ...prev.unread, messages: Math.max(0, (prev.unread.messages || 0) - unread.length) } : prev.unread,
    }));
    if (!API_ENABLED) return;
    try {
      const done = await api.post<any>(`/api/messages/${username}/read/`, {});
      // The unread dot rides on the inbox row, so the row has to be re-read —
      // in place. Dropping the whole list here re-armed the column's first-load
      // skeleton on every receipt.
      refreshList('inbox', inboxListDef(self.id));
      // Opening the thread is also how most people arrive at it, and the server
      // just marked that person's bells read on the way. The tray has to hear:
      // a message notification still shining next to the reply it caused.
      if (Number(done?.notifications) > 0) {
        refreshList('notifications', { path: '/notifications/', frag: notificationsFragment });
      }
    } catch {}
    void pullBadges();
  }, [pullBadges]);

  const addReport = async (type: 'post' | 'comment' | 'listing' | 'profile', targetId: string, reason: string, note: string) => {
    const self = currentMe();
    if (!self) return;
    if (!API_ENABLED) {
      setDb(prev => {
        const reports = [...prev.reports, { id: uid(), type, targetId, by: self.id, reason, note, ts: Date.now(), status: 'open' as const }];
        let posts = prev.posts;
        if (type === 'post') {
          const distinct = new Set(reports.filter(r => r.type === 'post' && r.targetId === targetId && r.status === 'open').map(r => r.by)).size;
          if (distinct >= prev.settings.threshold) {
            posts = prev.posts.map(p => (p.id === targetId && p.status === 'live' ? { ...p, status: 'hidden' as const } : p));
          }
        }
        return { ...prev, reports, posts };
      });
      showToast(t('reported'));
      return;
    }
    try {
      const row = mapReport(await api.post<any>('/api/moderation/reports/', { target_type: type, target_id: targetId, reason, details: note }));
      merge({ reports: [row] });
      if (type === 'post') {
        // Enough open reports and the server hides the post — the row says which.
        try {
          merge({ posts: [mapPost(await api.get<any>(`/api/posts/${targetId}/`))] });
        } catch { /* the author may no longer be allowed to read it */ }
      }
      showToast(t('reported'));
    } catch (err) {
      showToast(errText(err, 'Report not sent.'));
    }
  };

  const logAudit = (action: string, target: string, reason: string) => {
    if (API_ENABLED) return;
    const self = currentMe();
    if (!self) return;
    setDb(prev => ({ ...prev, audit: [{ id: uid(), ts: Date.now(), actor: self.id, action, target, reason }, ...prev.audit] }));
  };

  const activePromo = (targetType: 'post' | 'listing', targetId: string) =>
    db.promotions.find(p => p.targetType === targetType && p.targetId === targetId && p.status === 'active' && p.ends > Date.now());

  const promoEligible = (promo: Promotion) => {
    const self = currentMe();
    if (!self) return true;
    if (promo.country && self.country !== promo.country) return false;
    if (promo.city && (self.city || '') !== promo.city) return false;
    const age = ageFromDob(self.dob);
    return age >= promo.ageMin && age <= promo.ageMax;
  };

  const requestPromotion = async (targetType: 'post' | 'listing', targetId: string, cfg: PromoConfig): Promise<boolean> => {
    const self = currentMe();
    if (!self) return false;
    // Nobody outside the approved followers can see a private account's post, so
    // a promotion there would spend coins on an audience of zero. Same answer the
    // API gives, before the wallet is touched.
    if (self.private) {
      showToast('A private account cannot promote. Turn off the private switch first.');
      return false;
    }
    const pack = db.settings.packages.find(p => p.id === cfg.packageId);
    if (!pack || self.coins < pack.coins) return false;
    if (!API_ENABLED) {
      const now = Date.now();
      const promo: Promotion = {
        id: uid(), uid: self.id, targetType, targetId,
        packageId: pack.id, category: cfg.category,
        ageMin: cfg.ageMin, ageMax: cfg.ageMax, country: cfg.country, city: cfg.city,
        coins: pack.coins, ts: now, ends: now + pack.days * DAY,
        status: 'pending', impressions: 0, clicks: 0
      };
      setDb(prev => ({
        ...prev,
        users: prev.users.map(u => (u.id === self.id ? { ...u, coins: u.coins - pack.coins } : u)),
        ledger: [{ id: uid(), uid: self.id, delta: -pack.coins, kind: 'spend', note: `Reserved: ${pack.name} promotion`, ts: now }, ...prev.ledger],
        promotions: [promo, ...prev.promotions],
        notifications: [{ id: uid(), uid: 'u_admin', kind: 'promotion', text: `New promotion request from @${self.username}`, href: '/admin', ts: now, read: false }, ...prev.notifications]
      }));
      showToast(t('promoRequested'));
      return true;
    }
    try {
      const row = await api.post<any>('/api/promotions/', {
        target_type: targetType, target_id: targetId, category: cfg.category,
        age_min: cfg.ageMin, age_max: cfg.ageMax, country: cfg.country, city: cfg.city, package: cfg.packageId,
      });
      merge({ promotions: [mapPromotion(row)] });
      await resync();
      showToast(t('promoRequested'));
      return true;
    } catch (err) {
      showToast(errText(err, 'Promotion could not start.'));
      return false;
    }
  };

  const cancelPromotion = async (id: string) => {
    const promo = db.promotions.find(p => p.id === id);
    if (!promo) return;
    if (!API_ENABLED) {
      if (promo.status !== 'pending') return;
      setDb(prev => ({
        ...prev,
        promotions: prev.promotions.filter(p => p.id !== id),
        users: prev.users.map(u => (u.id === promo.uid ? { ...u, coins: u.coins + promo.coins } : u)),
        ledger: [{ id: uid(), uid: promo.uid, delta: promo.coins, kind: 'refund', note: 'Promotion request cancelled', ts: Date.now() }, ...prev.ledger]
      }));
      showToast(t('promoCancelled'));
      return;
    }
    try {
      merge({ promotions: [mapPromotion(await api.post<any>(`/api/promotions/${id}/end/`, {}))] });
      await resync();
      showToast(t('promoCancelled'));
    } catch (err) {
      showToast(errText(err, 'Could not end the promotion.'));
    }
  };

  const setPromotionStatus = async (id: string, action: 'pause' | 'resume') => {
    const promo = db.promotions.find(p => p.id === id);
    if (!promo) return;
    const paint = (status: Promotion['status']) => setDb(prev => ({
      ...prev,
      promotions: prev.promotions.map(p => (p.id === id ? { ...p, status } : p)),
    }));
    paint(action === 'pause' ? 'paused' : 'active');
    if (!API_ENABLED) return;
    try {
      merge({ promotions: [mapPromotion(await api.post<any>(`/api/promotions/${id}/${action}/`, {}))] });
    } catch (err) {
      paint(promo.status);
      showToast(errText(err, 'The promotion could not be updated.'));
    }
  };

  /** Retarget a running campaign; the budget was spent at request time and stays put. */
  const updatePromotion = async (id: string, patch: PromoTarget): Promise<boolean> => {
    const promo = db.promotions.find(p => p.id === id);
    if (!promo) return false;
    const next: Promotion = {
      ...promo,
      category: patch.category ?? promo.category,
      ageMin: patch.ageMin ?? promo.ageMin,
      ageMax: patch.ageMax ?? promo.ageMax,
      country: patch.country ?? promo.country,
      city: patch.city ?? promo.city,
    };
    setDb(prev => ({ ...prev, promotions: prev.promotions.map(p => (p.id === id ? next : p)) }));
    if (!API_ENABLED) {
      showToast(t('promoUpdated'));
      return true;
    }
    try {
      merge({
        promotions: [mapPromotion(await api.patch<any>(`/api/promotions/${id}/`, {
          category: next.category, age_min: next.ageMin, age_max: next.ageMax,
          country: next.country, city: next.city,
        }))],
      });
      showToast(t('promoUpdated'));
      return true;
    } catch (err) {
      setDb(prev => ({ ...prev, promotions: prev.promotions.map(p => (p.id === id ? promo : p)) }));
      showToast(errText(err, 'The promotion could not be saved.'));
      return false;
    }
  };

  const updateLang = (lang: 'en' | 'ne') => {
    setDb(prev => ({ ...prev, lang }));
    if (typeof window !== 'undefined') localStorage.setItem(LANG_KEY, lang);
  };

  const login = (userId: string) => setDb(prev => ({ ...prev, meId: userId }));

  const toggleTheme = () => {
    const next: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_KEY, next);
      document.documentElement.setAttribute('data-theme', next);
    }
  };

  return (
    <AppContext.Provider
      value={{
        db, setDb, me, isAdmin, isStaff, t, feature,
        addPost, updatePost, deletePost, addComment, deleteComment,
        toggleFollow, isFollowing, followState, requestFrom, incomingRequests, acceptRequest, declineRequest, removeFollower, mutualIds,
        react, myReaction, reactionCount, reactionMix, reactionPeople, myPostReaction, toggleSave, isSaved, toggleListingSave, isListingSaved,
        sharePost, countView, blockUser, unblockUser, isBlocked, blockedIds,
        notify, markAllRead, markRead, sendMessage, markThreadRead, addReport, logAudit,
        requestPromotion, cancelPromotion, activePromo, promoEligible,
        setPromotionStatus, updatePromotion,
        updateLang, login, logout, isAuthenticated,
        theme, toggleTheme,
        drawerOpen, openDrawer: () => setDrawerOpen(true), closeDrawer: () => setDrawerOpen(false),
        composerPostId,
        openComposer: (postId = null) => setComposerPostId(postId),
        closeComposer: () => setComposerPostId(undefined),
        createChooserOpen,
        openCreateChooser: () => setCreateChooserOpen(true),
        closeCreateChooser: () => setCreateChooserOpen(false),
        feedTab, setFeedTab,
        toast, showToast, hideToast,
        confirmBox, showConfirm, hideConfirm,
        ready, waking, serverMode, resync, merge,
        signin, signupAccount, verifyCode, resendCode, googleSignIn,
        requestPasswordReset, confirmPasswordReset,
        updateProfile, requestAccountDeletion, confirmAccountDeletion, loadPerson, loadEntity,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
