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

/** --- contract 6.3: content and marketplace review -------------------------- */

export type ContentKind = 'post' | 'comment' | 'listing' | 'user';

/** The five verbs a decision can take. Which ones a target offers depends on its state. */
export type Decision = 'dismiss' | 'remove' | 'warn' | 'release' | 'restore';

export interface PersonRef {
  id: number;
  username: string;
  name: string;
  avatar_url: string;
  verified?: boolean;
}

/** The thing a decision is made about, in the words the server sends for each kind. */
export interface ContentPreview {
  kind: ContentKind;
  id: number;
  state: string;
  text?: string;
  title?: string;
  price?: string;
  currency?: string;
  category?: string | null;
  condition?: string;
  location?: string;
  image?: string;
  audience?: string;
  media?: { kind: string; url: string; duration: number | null }[];
  likes?: number;
  comments?: number;
  author: PersonRef | null;
  created_at: string;
  on_post?: { id: number; text: string; author: string; state: string };
  email?: string | null;
  is_staff?: boolean;
  suspended_until?: string | null;
}

/** Every report sitting on one target, so one click can speak for the whole pile. */
export interface Pile {
  reports: number;
  open: number;
  reporters: number;
  reasons: { reason: string; n: number }[];
}

export interface QueueRow {
  id: number;
  target: string;
  target_type: ContentKind;
  target_id: string;
  reason: string;
  details: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  reporter: PersonRef | null;
  missing: boolean;
  content: ContentPreview | null;
  pile: Pile;
  matches: string[];
  campaigns: number;
  permission: string | null;
  actions: Decision[];
}

export interface QueueFacets {
  open: number;
  by_target: Partial<Record<ContentKind, number>>;
  auto_hide_at: number;
}

export interface Page<T> {
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
}

export interface QueuePage extends Page<QueueRow> {
  facets: QueueFacets;
}

export interface CampaignStop {
  id: number;
  owner: string;
  package: string;
  budget: string;
  refunded: string;
}

export interface NoticeRow {
  id: number;
  target: string;
  target_type: ContentKind;
  target_id: string;
  about: string;
  text: string;
  reason: string;
  actor: string | null;
  created_at: string;
  is_live: boolean;
  withdrawn_at: string | null;
}

/** What the server did in answer to one verb — the sentence the screen shows back. */
export interface Outcome {
  action: Decision;
  kind: ContentKind;
  target: string;
  content: ContentPreview;
  reports_closed: number;
  campaigns: CampaignStop[];
  refunded: string;
  notice: NoticeRow | null;
  detail: string;
  report?: number;
  pile?: Pile;
  facets?: QueueFacets;
}

export interface ShelfRow {
  target: string;
  content: ContentPreview;
  matches: string[];
  campaigns: number;
  pile: Pile;
  permission: string | null;
  actions: Decision[];
  decision: { action: string; actor: string | null; at: string; detail: string } | null;
}

export interface ShelfPage extends Page<ShelfRow> {
  counts: Record<string, number>;
  type: ContentKind;
}

export interface TermRow {
  id: number;
  kind: 'word' | 'item';
  text: string;
  note: string;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
}

export interface CategoryRow {
  id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
  listings: number | null;
}

export interface PolicyPage {
  terms: TermRow[];
  categories: CategoryRow[];
  auto_hide_at: number;
}

export interface NoticePage extends Page<NoticeRow> {}

/** --- contract 6.4: user management and enforcement ------------------------- */

/** A seat's role plus the one answer the roster does not have: plain members. */
export type AccountRole = Role | 'user';

export interface Suspension {
  until: string;
  permanent: boolean;
  reason: string;
  /** null only for a permanent bar, where there is no date to count down to. */
  days_left: number | null;
}

export interface SeatBrief {
  role: Role;
  is_enabled: boolean;
  enrolled: boolean;
  permissions: string[];
}

/** The pile read the way the directory shows it: on the account, and on its content. */
export interface FlagPile {
  on_account: number;
  on_content: number;
  reporters: number;
  auto_hide_at: number;
}

export interface PersonRow {
  id: number;
  username: string;
  name: string;
  email: string;
  bio: string;
  avatar_url: string;
  verified: boolean;
  is_private: boolean;
  /** Their own setting: false means a warning reaches the bell but not the inbox. */
  notify_email: boolean;
  provider: string;
  provider_label: string;
  email_verified: boolean;
  role: AccountRole;
  seat: SeatBrief | null;
  country: string;
  city: string;
  joined: string;
  coins: string;
  posts: number;
  followers: number;
  is_active: boolean;
  suspension: Suspension | null;
  locked_until: string | null;
  failed_attempts: number;
  flags: FlagPile;
}

export interface PeopleFacets {
  total: number;
  shown: number | null;
  suspended: number;
  permanent: number;
  locked: number;
  verified: number;
  deactivated: number;
  flagged: number;
  by_provider: Record<string, number>;
  auto_hide_at: number;
}

/** Which pens this seat holds, so the screen draws buttons or the reason it has none. */
export interface PersonVerbs {
  actions: boolean;
  warn: boolean;
}

export interface PersonPage extends Page<PersonRow> {
  facets: PeopleFacets;
  can: PersonVerbs;
}

/** What is still running on an account — the list a deletion has to clear first. */
export interface Holdings {
  campaigns: number;
  pending_requests: number;
  balance: string;
  posts: number;
  comments: number;
  listings: number;
}

export interface LedgerMove {
  id: number;
  kind: string;
  amount: string;
  note: string;
  created_at: string;
}

export interface ContentPileRow {
  target: string;
  state: string;
  open: number;
  reporters: number;
}

export interface ReportBrief {
  id: number;
  reason: string;
  details: string;
  status: string;
  created_at: string;
  reporter: PersonRef | null;
}

export interface WarningBrief {
  text: string;
  actor: string | null;
  created_at: string;
}

export interface NoticeBrief {
  id: number;
  target: string;
  text: string;
  reason: string;
  is_live: boolean;
  created_at: string;
  actor: string | null;
}

export interface AuditBrief {
  id: number;
  action: string;
  actor: string | null;
  detail: string;
  created_at: string;
}

export interface PersonDetail {
  person: PersonRow;
  holdings: Holdings;
  ledger: LedgerMove[];
  reports: ReportBrief[];
  content: ContentPileRow[];
  warnings: WarningBrief[];
  notices: NoticeBrief[];
  audit: AuditBrief[];
  can: PersonVerbs;
}

/** The server's answer to one verb, including what the guards refused. */
export interface PersonOutcome {
  action: string;
  username: string;
  detail: string;
  person?: PersonRow;
  suspension?: Suspension | null;
  permanent?: boolean;
  verified?: boolean;
  emailed?: { to: string; subject: string } | null;
  opted_out?: boolean;
  sessions_revoked?: number;
  reports_closed?: number;
  held_posts?: number;
  holdings?: Holdings;
}

/** One line of the first-load card, with the platform's own wording behind it. */
export interface WelcomeLine {
  key: string;
  field: 'message' | 'tagline' | 'email' | 'phone' | 'form';
  label: string;
  help: string;
  limit: number;
  value: string;
  default: string;
  set: boolean;
  by: string | null;
  at: string | null;
}

export interface WelcomeCard {
  message: string;
  tagline: string;
  contact: { label: string; value: string }[];
}

/** What the welcome desk holds, and what the website will show on first load. */
export interface WelcomeDesk {
  lines: WelcomeLine[];
  card: WelcomeCard;
  detail?: string;
}

/** Contract 6.7 — what a Coin costs, where the rupees go, and how long a proof lives. */
export interface CoinPricing {
  coin_price: string | number;
  min_purchase: number;
  bank: { name: string; account: string; holder: string; qr: string };
  proof_days: number;
}

export interface CoinAsk {
  id: number;
  card: PersonRef;
  coins: number;
  amount: string;
  method: string;
  reference: string;
  status: 'pending' | 'approved' | 'rejected';
  status_label: string;
  has_proof: boolean;
  created_at: string;
  reviewed_at: string | null;
  took: string | null;
  age_hours: number;
  asked?: boolean;
  review?: {
    action: 'approve' | 'reject' | 'proof';
    label: string;
    reason: string;
    coins_credited: number;
    by: string | null;
    at: string;
  };
}

export interface CoinPage extends Page<CoinAsk> {
  counts: { pending: number; approved: number; rejected: number; every: number };
  held: { coins: number; rupees: string };
  proofs_deleted: number;
  retention_days: number;
  can_review: boolean;
  pricing: CoinPricing;
}

export interface CoinDetail {
  request: CoinAsk;
  asks: { action: string; reason: string; by: string | null; at: string }[];
}

export interface ProofLink {
  href: string;
  expires_in: number;
}

/** One row of the wallet's own history — this console can add to it and nothing else. */
export interface LedgerRow {
  id: number;
  username: string;
  card: PersonRef;
  kind: 'credit' | 'debit';
  amount: string;
  note: string;
  created_at: string;
  balance: string;
  currency: string;
}

export interface LedgerPage extends Page<LedgerRow> {
  totals: { credited: string; debited: string; entries: number };
}

/** A knob on a settings desk, typed by the server so the box knows what it holds. */
export interface SettingLine {
  key: string;
  value: string | number;
  default: string | number;
  set: boolean;
  type: 'int' | 'dec' | 'bool' | 'str';
  label: string;
  help: string;
  group: string;
  by: string | null;
  at: string | null;
}

export interface CoinDesk {
  lines: SettingLine[];
  pricing: CoinPricing;
  counts: { held: number };
  detail?: string;
}

/** --- contract 6.8: promotions, packages and the reach dials ------------------ */

export interface PromoPackage {
  id: string;
  name: string;
  coins: number;
  days: number | null;
  reach_max: number;
  reach: string;
}

/** One decision on one campaign. A campaign is paused and resumed more than once,
 *  so the desk reads the whole trail rather than a status column. */
export interface PromoMark {
  action: 'approve' | 'reject' | 'pause' | 'resume' | 'stop';
  label: string;
  reason: string;
  coins_refunded: string;
  choice: 'refunded' | 'withheld' | null;
  by: string | null;
  at: string;
}

export type PromoState = 'draft' | 'active' | 'paused' | 'ended';

export interface PromoRow {
  id: number;
  owner: string;
  card: ContentPreview | null;
  target: { type: ContentKind; id: string; state: string; text: string };
  status: PromoState;
  status_label: string;
  running: boolean;
  sign_off: string;
  sign_off_label: string;
  delivery: string;
  category: string;
  targeting: { age_min: number; age_max: number; country: string; city: string };
  package: PromoPackage | null;
  coins: string;
  impressions: number;
  clicks: number;
  created_at: string;
  ends_at: string | null;
  age_hours: number;
  left_hours: number | null;
  refund_reject: string;
  refund_stop: string;
  pile: Pile;
  today: number;
  review?: PromoMark;
  took?: string;
}

export interface PromoPage extends Page<PromoRow> {
  counts: {
    waiting: number; live: number; paused: number; ended: number; every: number; reserved: string;
  };
  state: string;
  can_review: boolean;
  controls: { caps: { daily: number; repeat: number; gap: number }; floor: number; global_pause: boolean };
  packages: PromoPackage[];
}

export interface PromoBrief {
  id: number;
  reason: string;
  details: string;
  status: string;
  created_at: string;
  reporter: PersonRef | null;
}

export interface PromoDetail {
  campaign: PromoRow;
  reviews: PromoMark[];
  reports: PromoBrief[];
  target_state: string;
}

export interface PackageDesk {
  packages: PromoPackage[];
  shipped: PromoPackage[];
  is_edited: boolean;
  bought: Record<string, number>;
  detail?: string;
  errors?: string[];
}

export interface AlgorithmDesk {
  lines: SettingLine[];
  weights: Record<string, number>;
  floor: number;
  caps: { daily: number; repeat: number; gap: number };
  global_pause: boolean;
  packages: PromoPackage[];
  shipped: boolean;
  running: number;
  started_today: number;
  detail?: string;
  changed?: string[];
  errors?: string[];
}

/** What the member site is told, with nobody signed in. */
export interface ReachConfig {
  weights: Record<string, number>;
  floor: number;
  caps: { daily: number; repeat: number; gap: number };
  global_pause: boolean;
  packages: PromoPackage[];
  packages_edited: boolean;
}
