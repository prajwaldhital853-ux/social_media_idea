'use client';

import { useEffect, useRef, useSyncExternalStore, type MutableRefObject } from 'react';

export type AdminPulseKind =
  | 'comment'
  | 'post_new'
  | 'reaction'
  | 'audit'
  | 'staff_notice'
  | 'coin_request'
  | 'promotion'
  | 'coins'
  | 'warning';

type PulseId = string | number;

export interface AdminCommentPulse {
  kind: 'comment';
  post_id: PulseId;
  comments: number;
  comment_id?: PulseId;
  author_id?: PulseId;
  action?: string;
  parent_id?: PulseId;
  parent_replies?: number;
  deleted_ids?: PulseId[];
}

export interface AdminPostPulse {
  kind: 'post_new';
  id: PulseId;
  author: string;
  video: boolean;
}

export interface AdminReactionPulse {
  kind: 'reaction';
  target?: string;
  target_type?: string;
  target_id?: PulseId;
  post_id?: PulseId;
  id?: PulseId;
  position?: number;
  likes?: number;
  kinds?: Record<string, number>;
  counts?: Record<string, number>;
  mix?: Record<string, number>;
}

export interface AdminAuditPulse {
  kind: 'audit';
  id: PulseId;
}

export interface AdminStaffNoticePulse {
  kind: 'staff_notice';
  notice_kind: string;
  route: string;
}

export interface AdminCoinRequestPulse {
  kind: 'coin_request';
  id: PulseId;
  user_id: PulseId;
  status: string;
}

export interface AdminPromotionPulse {
  kind: 'promotion';
  id: PulseId;
  status: string;
}

export interface AdminCoinsPulse {
  kind: 'coins';
  user_id: PulseId;
  balance: string | number;
}

export interface AdminWarningPulse {
  kind: 'warning';
  user_id: PulseId;
}

export type AdminPulse =
  | AdminCommentPulse
  | AdminPostPulse
  | AdminReactionPulse
  | AdminAuditPulse
  | AdminStaffNoticePulse
  | AdminCoinRequestPulse
  | AdminPromotionPulse
  | AdminCoinsPulse
  | AdminWarningPulse;

export type AdminHealth = 'connecting' | 'live' | 'offline';
export type AdminEventHandler = (pulse: AdminPulse) => void;
export type AdminEventFilter = (pulse: AdminPulse) => boolean;

interface Subscription {
  kinds: ReadonlySet<AdminPulseKind>;
  latest: MutableRefObject<{
    handler: AdminEventHandler;
    filter?: AdminEventFilter;
  }>;
  pulse: AdminPulse | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const subscriptions = new Set<Subscription>();
const healthListeners = new Set<() => void>();
const PULSE_KINDS: ReadonlySet<string> = new Set<AdminPulseKind>([
  'comment', 'post_new', 'reaction', 'audit', 'staff_notice',
  'coin_request', 'promotion', 'coins', 'warning',
]);
const NOTICE_KINDS: ReadonlySet<string> = new Set([
  'report', 'coin_request', 'signup', 'coin_proof', 'promotion', 'alert',
]);
const REFRESH_DELAY = 40;
let health: AdminHealth = 'offline';

function isPulseId(value: unknown): value is PulseId {
  return typeof value === 'string' || typeof value === 'number';
}

function subscribeHealth(listener: () => void): () => void {
  healthListeners.add(listener);
  return () => { healthListeners.delete(listener); };
}

function getHealth(): AdminHealth {
  return health;
}

function getServerHealth(): AdminHealth {
  return 'offline';
}

export function setAdminHealth(next: AdminHealth): void {
  if (health === next) return;
  health = next;
  healthListeners.forEach(listener => listener());
}

export function useAdminLive(): { live: boolean; health: AdminHealth } {
  const current = useSyncExternalStore(subscribeHealth, getHealth, getServerHealth);
  return { live: current === 'live', health: current };
}

export function publishAdminPulse(pulse: AdminPulse): void {
  subscriptions.forEach(subscription => {
    if (!subscription.kinds.has(pulse.kind)) return;
    if (subscription.latest.current.filter && !subscription.latest.current.filter(pulse)) return;
    subscription.pulse = pulse;
    if (subscription.timer !== null) return;
    subscription.timer = setTimeout(() => {
      const latest = subscription.pulse;
      subscription.pulse = null;
      subscription.timer = null;
      if (latest && (!subscription.latest.current.filter || subscription.latest.current.filter(latest))) {
        subscription.latest.current.handler(latest);
      }
    }, REFRESH_DELAY);
  });
}

export function useAdminEvent(
  kinds: readonly AdminPulseKind[],
  handler: AdminEventHandler,
  filter?: AdminEventFilter,
): void {
  const latest = useRef({ handler, filter });
  const wanted = useRef(kinds);
  useEffect(() => {
    latest.current = { handler, filter };
  }, [handler, filter]);
  useEffect(() => {
    wanted.current = kinds;
  }, [kinds]);

  const key = Array.from(new Set(kinds)).sort().join(',');
  useEffect(() => {
    if (!key) return undefined;
    const subscription: Subscription = {
      kinds: new Set(wanted.current),
      latest,
      pulse: null,
      timer: null,
    };
    subscriptions.add(subscription);
    return () => {
      subscriptions.delete(subscription);
      if (subscription.timer !== null) clearTimeout(subscription.timer);
    };
  }, [key]);
}

export function parseAdminPulse(data: string): AdminPulse | null {
  let frame: unknown;
  try {
    frame = JSON.parse(data);
  } catch {
    return null;
  }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const value = frame as Record<string, unknown>;
  const kind = value.kind;
  if (typeof kind !== 'string') return null;
  if (typeof value.route === 'string' && NOTICE_KINDS.has(kind)) {
    return { kind: 'staff_notice', notice_kind: kind, route: value.route };
  }
  if (!PULSE_KINDS.has(kind)) return null;
  if (kind === 'staff_notice') {
    if (typeof value.route !== 'string') return null;
    const noticeKind = value.notice_kind ?? value.noticeKind;
    return {
      kind: 'staff_notice',
      notice_kind: typeof noticeKind === 'string' ? noticeKind : '',
      route: value.route,
    };
  }
  switch (kind) {
    case 'comment':
      if (!isPulseId(value.post_id) || typeof value.comments !== 'number') return null;
      break;
    case 'post_new':
      if (!isPulseId(value.id) || typeof value.author !== 'string' || typeof value.video !== 'boolean') return null;
      break;
    case 'reaction':
      if (typeof value.target !== 'string' && typeof value.target_type !== 'string') return null;
      break;
    case 'audit':
      if (!isPulseId(value.id)) return null;
      break;
    case 'promotion':
      if (!isPulseId(value.id) || typeof value.status !== 'string') return null;
      break;
    case 'coin_request':
      if (!isPulseId(value.id) || !isPulseId(value.user_id) || typeof value.status !== 'string') return null;
      break;
    case 'coins':
      if (!isPulseId(value.user_id) || (typeof value.balance !== 'string' && typeof value.balance !== 'number')) return null;
      break;
    case 'warning':
      if (!isPulseId(value.user_id)) return null;
      break;
  }
  return value as unknown as AdminPulse;
}
