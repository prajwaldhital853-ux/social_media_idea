export type Role = 'superadmin' | 'admin' | 'moderator';

export type GateCode =
  | 'sign_in_required'
  | 'staff_only'
  | 'staff_disabled'
  | 'two_factor_enrolment'
  | 'two_factor_required'
  | 'two_factor_locked'
  | 'permission_required'
  | 'code_rejected'
  | 'session_expired'
  | 'locked'
  | 'code_required';

export interface Enrolment {
  secret: string;
  otpauth_url: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
}

export interface Session {
  user: { id: number; username: string; name: string; email: string };
  role: Role;
  permissions: string[];
  /** Same keys, labelled — the server only sends the ones this seat holds. */
  permission_keys?: PermissionEntry[];
  enrolled: boolean;
  recovery_left: number;
  admin_expires_at: number | null;
  last_admin_login_at?: string | null;
}

export interface SignInChallenge {
  detail: string;
  code: GateCode;
  username: string;
  totp?: Enrolment;
  recovery_left?: number;
  retry_in?: number;
}

export interface SignedIn extends Session {
  amr: string[];
  recovery_codes: string[] | null;
}

export interface Seat {
  username: string;
  name: string;
  email: string;
  role: Role;
  is_enabled: boolean;
  enrolled: boolean;
  granted_keys: string[];
  denied_keys: string[];
  permissions: string[];
  granted_by: string | null;
  granted_at: string;
  revoked_at: string | null;
  last_admin_login_at: string | null;
  recovery_left: number;
  codes_locked_until: string | null;
}

export interface PermissionEntry {
  key: string;
  label: string;
  group: string;
  group_label?: string;
  roles: Role[];
}

export interface Catalogue {
  groups: { id: string; label: string }[];
  permissions: PermissionEntry[];
}

/** --- contract 6.2: the dashboard ----------------------------------------- */

export interface SeriesPoint {
  day: string;
  n: number;
}

/** One tile, whose shape follows its `kind` — the card that reads it owns the fields. */
export interface Tile {
  id: string;
  kind: 'rate' | 'queue' | 'coins' | 'promotions' | 'storage' | 'ledger';
  label: string;
  href: string;

  today?: number;
  week?: number;
  month?: number;
  total?: number;
  series?: SeriesPoint[];

  value?: number;
  new_today?: number;
  closed_week?: number;
  by_target?: Record<string, number>;
  by_reason?: { reason: string; n: number }[];
  oldest_minutes?: number;

  pending?: number;
  pending_coins?: number;
  pending_npr?: number;
  waiting_today?: number;
  sold_today?: number;
  sold_week?: number;
  sold_month?: number;
  collected_npr?: number;

  active?: number;
  awaiting_review?: number;
  paused?: number;
  started_month?: number;
  impressions_month?: number;
  clicks_month?: number;

  bytes?: number;
  files?: number;
  state?: string;
  by_kind?: Record<string, number>;
  detail?: string;
  limit_gb?: number;

  spent_today?: number;
  spent_week?: number;
  spent_month?: number;
  credited_month?: number;
}

export interface HealthCheck {
  id: string;
  label: string;
  state: 'ok' | 'slow' | 'degraded' | 'off' | 'unknown' | 'down';
  detail: string;
}

export interface AlertRow {
  id: number;
  key: string;
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'open' | 'acked' | 'resolved';
  title: string;
  detail: string;
  href: string;
  context: Record<string, unknown>;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  acked_by: string | null;
}

export interface Threshold {
  key: string;
  value: string | number;
  default: string | number;
  set: boolean;
  type: string;
  label: string;
  help: string;
  group: string;
}

export interface Overview {
  generated_at: string;
  windows: { today: string; week: string; month: string; series_days: number };
  tiles: Tile[];
  health: { state: HealthCheck['state']; checks: HealthCheck[] };
  alerts: { counts: { open: number; acked: number; resolved: number }; recent: AlertRow[] };
  thresholds: Record<string, Threshold>;
}

export interface CampaignRow {
  id: number;
  owner: string;
  owner_name: string;
  target: string;
  target_type: string;
  package: string;
  status: string;
  category: string;
  started_at: string;
  ends_at: string | null;
  minutes_live: number;
  metrics: Record<string, number>;
  unmeasured: Record<string, string>;
  click_rate: number | null;
}

export interface PromotionAnalytics {
  generated_at: string;
  metrics: { id: string; label: string }[];
  unmeasured: Record<string, string>;
  rows: CampaignRow[];
  totals: Record<string, number>;
  shown: number;
}
