'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, Dispatch, SetStateAction } from 'react';
import { usePathname } from 'next/navigation';
import { Database, User, Post, Comment, ThemeMode, ReactionKind, NotificationKind, FeatureFlags, Promotion } from './types';
import { getDb, save } from './storage';
import { THEME_KEY, uid, ageFromDob, DAY } from './utils';
import { I18N, TranslationKey } from './i18n';

interface AppContextType {
  db: Database;
  setDb: Dispatch<SetStateAction<Database>>;
  me: User | null;
  isAdmin: () => boolean;
  isStaff: () => boolean;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  feature: (key: keyof FeatureFlags) => boolean;
  addPost: (post: Post) => void;
  updatePost: (id: string, updates: Partial<Post>) => void;
  deletePost: (id: string) => void;
  addComment: (comment: Comment) => void;
  deleteComment: (id: string) => void;
  toggleFollow: (targetId: string) => void;
  isFollowing: (targetId: string) => boolean;
  react: (targetType: 'post' | 'comment' | 'media', targetId: string, kind: ReactionKind) => void;
  myReaction: (targetType: 'post' | 'comment' | 'media', targetId: string) => ReactionKind | null;
  toggleSave: (pid: string) => void;
  isSaved: (pid: string) => boolean;
  notify: (uid: string, kind: NotificationKind, text: string, href?: string, actor?: string) => void;
  markAllRead: () => void;
  sendMessage: (to: string, text: string) => void;
  addReport: (type: 'post' | 'comment' | 'listing' | 'profile', targetId: string, reason: string, note: string) => void;
  logAudit: (action: string, target: string, reason: string) => void;
  requestPromotion: (targetType: 'post' | 'listing', targetId: string, cfg: PromoConfig) => boolean;
  cancelPromotion: (id: string) => void;
  activePromo: (targetType: 'post' | 'listing', targetId: string) => Promotion | undefined;
  promoEligible: (promo: Promotion) => boolean;
  updateLang: (lang: 'en' | 'ne') => void;
  login: (userId: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
  theme: ThemeMode;
  toggleTheme: () => void;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  composerPostId: string | null | undefined;
  openComposer: (postId?: string | null) => void;
  closeComposer: () => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

export interface PromoConfig {
  packageId: string;
  category: string;
  ageMin: number;
  ageMax: number;
  country: string;
  city: string;
}

function readTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return 'light';
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [db, setDb] = useState<Database>(getDb());
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [composerPostId, setComposerPostId] = useState<string | null | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  // Close drawer when navigation occurs
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    setMounted(true);
    const next = readTheme();
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
  }, []);

  useEffect(() => {
    if (mounted) save(db);
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

  const showToast = (msg: string) => setToast(msg);

  const addPost = (post: Post) => setDb(prev => ({ ...prev, posts: [post, ...prev.posts] }));

  const updatePost = (id: string, updates: Partial<Post>) =>
    setDb(prev => ({ ...prev, posts: prev.posts.map(p => p.id === id ? { ...p, ...updates } : p) }));

  const deletePost = (id: string) => setDb(prev => ({
    ...prev,
    posts: prev.posts.filter(p => p.id !== id),
    comments: prev.comments.filter(c => c.pid !== id),
    reactions: prev.reactions.filter(r => !(r.targetType === 'post' && r.targetId === id)),
    saves: prev.saves.filter(s => s.pid !== id),
    reports: prev.reports.filter(r => !(r.type === 'post' && r.targetId === id))
  }));

  const addComment = (comment: Comment) => setDb(prev => ({ ...prev, comments: [...prev.comments, comment] }));

  const deleteComment = (id: string) => setDb(prev => ({
    ...prev,
    comments: prev.comments.filter(c => c.id !== id),
    reactions: prev.reactions.filter(r => !(r.targetType === 'comment' && r.targetId === id)),
    reports: prev.reports.filter(r => !(r.type === 'comment' && r.targetId === id))
  }));

  const isFollowing = (targetId: string) =>
    !!me && db.follows.some(f => f.follower === me.id && f.following === targetId);

  const toggleFollow = (targetId: string) => {
    if (!me || me.id === targetId) return;
    const following = isFollowing(targetId);
    setDb(prev => ({
      ...prev,
      follows: following
        ? prev.follows.filter(f => !(f.follower === me.id && f.following === targetId))
        : [...prev.follows, { follower: me.id, following: targetId, ts: Date.now() }],
      notifications: following ? prev.notifications : [
        { id: uid(), uid: targetId, kind: 'follow', actor: me.id, text: 'started following you', href: `/u/${me.username}`, ts: Date.now(), read: false },
        ...prev.notifications
      ]
    }));
  };

  const myReaction = (targetType: 'post' | 'comment' | 'media', targetId: string) => {
    if (!me) return null;
    return db.reactions.find(r => r.targetType === targetType && r.targetId === targetId && r.uid === me.id)?.kind || null;
  };

  const react = (targetType: 'post' | 'comment' | 'media', targetId: string, kind: ReactionKind) => {
    if (!me) return;
    const existing = myReaction(targetType, targetId);
    setDb(prev => {
      const rest = prev.reactions.filter(r => !(r.targetType === targetType && r.targetId === targetId && r.uid === me.id));
      if (existing === kind) return { ...prev, reactions: rest };
      const ownerId = targetType === 'post'
        ? prev.posts.find(p => p.id === targetId)?.uid
        : targetType === 'media'
          ? prev.posts.find(p => p.id === targetId.split('#m')[0])?.uid
          : prev.comments.find(c => c.id === targetId)?.uid;
      const notifications = ownerId && ownerId !== me.id
        ? [{ id: uid(), uid: ownerId, kind: 'reaction' as const, actor: me.id, text: `reacted ${kind} to your ${targetType === 'media' ? 'photo' : targetType}`, href: targetType === 'comment' ? undefined : `/post/${targetType === 'media' ? targetId.split('#m')[0] : targetId}`, ts: Date.now(), read: false }, ...prev.notifications]
        : prev.notifications;
      return { ...prev, reactions: [...rest, { id: uid(), targetType, targetId, uid: me.id, kind, ts: Date.now() }], notifications };
    });
  };

  const isSaved = (pid: string) => !!me && db.saves.some(s => s.uid === me.id && s.pid === pid);

  const toggleSave = (pid: string) => {
    if (!me) return;
    const saved = isSaved(pid);
    setDb(prev => ({
      ...prev,
      saves: saved
        ? prev.saves.filter(s => !(s.uid === me.id && s.pid === pid))
        : [...prev.saves, { uid: me.id, pid, ts: Date.now() }]
    }));
    showToast(saved ? t('unsave') : t('saved'));
  };

  const notify = (targetUid: string, kind: NotificationKind, text: string, href?: string, actor?: string) =>
    setDb(prev => ({
      ...prev,
      notifications: [{ id: uid(), uid: targetUid, kind, text, href, actor, ts: Date.now(), read: false }, ...prev.notifications]
    }));

  const markAllRead = () => {
    if (!me) return;
    setDb(prev => ({ ...prev, notifications: prev.notifications.map(n => n.uid === me.id ? { ...n, read: true } : n) }));
  };

  const sendMessage = (to: string, text: string) => {
    if (!me || !text.trim()) return;
    setDb(prev => ({
      ...prev,
      messages: [...prev.messages, { id: uid(), from: me.id, to, text: text.trim(), ts: Date.now(), read: false }],
      notifications: [{ id: uid(), uid: to, kind: 'message', actor: me.id, text: 'sent you a message', href: `/messages/${me.id}`, ts: Date.now(), read: false }, ...prev.notifications]
    }));
  };

  const addReport = (type: 'post' | 'comment' | 'listing' | 'profile', targetId: string, reason: string, note: string) => {
    if (!me) return;
    setDb(prev => {
      const reports = [...prev.reports, { id: uid(), type, targetId, by: me.id, reason, note, ts: Date.now(), status: 'open' as const }];
      let posts = prev.posts;
      if (type === 'post') {
        const distinct = new Set(reports.filter(r => r.type === 'post' && r.targetId === targetId && r.status === 'open').map(r => r.by)).size;
        if (distinct >= prev.settings.threshold) {
          posts = prev.posts.map(p => p.id === targetId && p.status === 'live' ? { ...p, status: 'hidden' as const } : p);
        }
      }
      return { ...prev, reports, posts };
    });
    showToast(t('reported'));
  };

  const logAudit = (action: string, target: string, reason: string) => {
    if (!me) return;
    setDb(prev => ({ ...prev, audit: [{ id: uid(), ts: Date.now(), actor: me.id, action, target, reason }, ...prev.audit] }));
  };

  const activePromo = (targetType: 'post' | 'listing', targetId: string) =>
    db.promotions.find(p => p.targetType === targetType && p.targetId === targetId && p.status === 'active' && p.ends > Date.now());

  const promoEligible = (promo: Promotion) => {
    if (!me) return true;
    if (promo.country && me.country !== promo.country) return false;
    if (promo.city && (me.city || '') !== promo.city) return false;
    const age = ageFromDob(me.dob);
    return age >= promo.ageMin && age <= promo.ageMax;
  };

  const requestPromotion = (targetType: 'post' | 'listing', targetId: string, cfg: PromoConfig) => {
    if (!me) return false;
    const pk = db.settings.packages.find(p => p.id === cfg.packageId);
    if (!pk || me.coins < pk.coins) return false;
    const now = Date.now();
    const promo: Promotion = {
      id: uid(), uid: me.id, targetType, targetId,
      packageId: pk.id, category: cfg.category,
      ageMin: cfg.ageMin, ageMax: cfg.ageMax, country: cfg.country, city: cfg.city,
      coins: pk.coins, ts: now, ends: now + pk.days * DAY,
      status: 'pending', impressions: 0, clicks: 0
    };
    setDb(prev => ({
      ...prev,
      users: prev.users.map(u => u.id === me.id ? { ...u, coins: u.coins - pk.coins } : u),
      ledger: [{ id: uid(), uid: me.id, delta: -pk.coins, kind: 'spend', note: `Reserved: ${pk.name} promotion`, ts: now }, ...prev.ledger],
      promotions: [promo, ...prev.promotions],
      notifications: [{ id: uid(), uid: 'u_admin', kind: 'promotion', text: `New promotion request from @${me.username}`, href: '/admin', ts: now, read: false }, ...prev.notifications]
    }));
    showToast(t('promoRequested'));
    return true;
  };

  const cancelPromotion = (id: string) => {
    const promo = db.promotions.find(p => p.id === id);
    if (!promo || promo.status !== 'pending') return;
    setDb(prev => ({
      ...prev,
      promotions: prev.promotions.filter(p => p.id !== id),
      users: prev.users.map(u => u.id === promo.uid ? { ...u, coins: u.coins + promo.coins } : u),
      ledger: [{ id: uid(), uid: promo.uid, delta: promo.coins, kind: 'refund', note: 'Promotion request cancelled', ts: Date.now() }, ...prev.ledger]
    }));
    showToast(t('promoCancelled'));
  };

  const updateLang = (lang: 'en' | 'ne') => setDb(prev => ({ ...prev, lang }));

  const login = (userId: string) => setDb(prev => ({ ...prev, meId: userId }));

  const logout = () => {
    setDb(prev => ({ ...prev, meId: null }));
    setDrawerOpen(false);
  };

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
        toggleFollow, isFollowing, react, myReaction, toggleSave, isSaved,
        notify, markAllRead, sendMessage, addReport, logAudit,
        requestPromotion, cancelPromotion, activePromo, promoEligible,
        updateLang, login, logout, isAuthenticated,
        theme, toggleTheme,
        drawerOpen, openDrawer: () => setDrawerOpen(true), closeDrawer: () => setDrawerOpen(false),
        composerPostId,
        openComposer: (postId = null) => setComposerPostId(postId),
        closeComposer: () => setComposerPostId(undefined),
        toast, showToast
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