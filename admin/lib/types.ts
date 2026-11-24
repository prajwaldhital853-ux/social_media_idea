export type Role = 'superadmin' | 'admin' | 'moderator';

export type GateCode =
  | 'sign_in_required'
  | 'staff_only'
  | 'staff_disabled'
  | 'two_factor_enrolment'
  | 'two_factor_required'
  | 'two_factor_locked'
  | 'password_change_required'
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
  /** True until the person has replaced the password the console wrote for them. */
  must_change_password: boolean;
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
  alerts: {
    counts: { open: number; acked: number; resolved: number; attention: number; unwired: number };
    recent: AlertRow[];
    total: number;
  };
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
  offset: number;
  total: number;
}

/** --- contract 6.3: content and marketplace review -------------------------- */

export type ContentKind = 'post' | 'comment' | 'listing' | 'user';

/** The five verbs a decision can take. Which ones a target offers depends on its state. */
export type Decision = 'dismiss' | 'remove' | 'warn' | 'release' | 'restore';

/** The buttons the Decide aside can show. `withdraw` is not a server verb —
 * the screen answers it at the notices door instead. */
export type AsideVerb = 'remove' | 'warn' | 'withdraw' | 'release' | 'restore';

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
  images?: string[];
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
  resolved: number;
  dismissed: number;
  all: number;
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
  audience: 'public' | 'private';
  text: string;
  reason: string;
  actor: string | null;
  created_at: string;
  is_live: boolean;
  withdrawn_at: string | null;
}

/** What the server did in answer to one verb — the sentence the screen shows back. */
export interface Outcome {
  /** "withdraw" is the screen's own verb, answered at the notices door. */
  action: Decision | 'withdraw';
  kind: ContentKind;
  target: string;
  content: ContentPreview | null;
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

/**
 * One target opened as a page of its own. Both moderation desks land here, so
 * the report queue and the takedown shelf are two ways of reaching the same
 * thing rather than two screens that disagree about what it says.
 */
export interface ReviewCase {
  target: string;
  kind: ContentKind;
  id: number;
  missing: boolean;
  content: ContentPreview | null;
  matches: string[];
  pile: Pile;
  campaigns: number;
  permission: string | null;
  actions: Decision[];
  reports: ReportBrief[];
  notices: NoticeRow[];
  history: { id: number; action: string; actor: string | null; at: string; detail: string }[];
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

export interface NoticePage extends Page<NoticeRow> {
  /** How many notices stand on each kind of thing, plus the whole record. */
  counts?: Partial<Record<ContentKind | 'all', number>>;
}

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
  audience: 'public' | 'private';
  withdrawn_at: string | null;
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
  /** What the account has put on the platform, newest first. */
  posts: PersonPost[];
  comments: PersonComment[];
  listings: PersonListing[];
}

/** One post, as the record page lists it. */
export interface PersonPost {
  id: string;
  text: string;
  state: string;
  audience: string;
  created_at: string;
  likes: number;
  comments: number;
  preview?: ContentPreview;
}

export interface PersonComment {
  id: string;
  text: string;
  state: string;
  created_at: string;
  post: string;
  preview?: ContentPreview;
}

export interface PersonListing {
  id: string;
  title: string;
  price: string;
  currency: string;
  state: string;
  created_at: string;
  preview?: ContentPreview;
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
  notices_withdrawn?: number;
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

/** What the mail settings on this deployment really are, read without sending anything. */
export interface WelcomeMail {
  backend: string;
  provider: string;
  sender: string;
  reply_to: string;
  site: string;
  provider_key: boolean;
  dispatch: string;
  problem: string;
}

/** What the welcome desk holds, and what the website will show on first load. */
export interface WelcomeDesk {
  lines: WelcomeLine[];
  card: WelcomeCard;
  mail?: WelcomeMail;
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
  resubmitted?: boolean;
  resubmitted_at?: string | null;
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
  counts?: Partial<Record<'credit' | 'debit', number>>;
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

export type PromoState = 'draft' | 'pending' | 'active' | 'paused' | 'ended' | 'rejected';

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
  targeting: { age_min: number; age_max: number; country: string; cities: string[] };
  package: PromoPackage | null;
  coins: string;
  /** False while the order only promises the money: the coins leave the wallet on approval. */
  charged: boolean;
  impressions: number;
  clicks: number;
  /** What the package promised, what the ledger has handed out, and how many
   *  separate people that reached — `people` is only answered on one campaign. */
  reach_bought: number;
  delivered: number;
  people: number | null;
  created_at: string;
  starts_at: string | null;
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
    waiting: number; orders: number; live: number; paused: number; refused: number;
    ended: number; every: number; reserved: string; unbilled: string;
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
  target: number;
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
  target: number;
  floor: number;
  caps: { daily: number; repeat: number; gap: number };
  global_pause: boolean;
  packages: PromoPackage[];
  packages_edited: boolean;
}

/** --- contract 6.9: spam rules, the flagged pile, alerts, audit, exports ---- */

/** One heading of the spam desk: a name and the knobs that belong under it. */
export interface SpamBlock {
  id: 'rate' | 'new' | 'pile';
  label: string;
  lines: (SettingLine & { enforced: boolean })[];
}

export interface SpamDesk {
  blocks: SpamBlock[];
  threshold: number;
  autohide: boolean;
  block_links: boolean;
  words: number;
  items: number;
  links: (Omit<TermRow, 'kind'> & { kind: string })[];
  enforced: string[];
  can_write_links: boolean;
  detail?: string;
  changed?: string[];
  config?: SpamConfig;
  errors?: string[];
}

/** What the member site is told, with nobody signed in. */
export interface SpamConfig {
  limits: Record<string, string | number | boolean>;
  new_account: { hold_hours: number; posts_per_day: number; verify_first: boolean };
  auto_hide: { enabled: boolean; reports: number };
  link_block: boolean;
  blocked_links: string[];
  blocked_words: string[];
}

/** One target the pile has already pulled out of the feed. */
export interface FlagRow {
  kind: ContentKind;
  label: string;
  id: string;
  state: string;
  live: boolean;
  gone: boolean;
  state_word?: string;
  owner: PersonRef | null;
  reporters: number;
  reports: number;
  newest: string;
  reasons: { reason: string; n: number }[];
}

export interface FlaggedPage {
  generated_at: string;
  threshold: number;
  content: FlagRow[];
  content_page: number;
  content_more: boolean;
  accounts: PersonRow[];
  accounts_total: number;
  words: number;
  links: number;
  can_review: boolean;
}

/** One outside reporter: the wire, and whether anything has ever spoken on it. */
export interface AlertPulse {
  key: string;
  label: string;
  severity: AlertRow['severity'];
  href: string;
  wired: boolean;
  state: string;
  detail: string;
  counts: Record<string, number>;
  stamped_at: string | null;
  stamps: number;
  quiet_after: number | null;
  quiet_unit: string;
  counted: string | null;
  counted_at: number | null;
  command: string;
  silent: string;
}

export interface AlertKind {
  kind: string;
  label: string;
  n: number;
  active: number;
  resolved: number;
}

export interface AlertDesk {
  generated_at: string;
  counts: {
    open: number; acked: number; resolved: number; attention: number; unwired: number;
  };
  rows: AlertRow[];
  kinds: AlertKind[];
  thresholds: SettingLine[];
  pulses: AlertPulse[];
  statuses: { id: string; label: string }[];
  severities: { id: string; label: string }[];
  shown: number;
  health: Overview['health'];
  detail?: string;
}

export interface AlertScan {
  detail: string;
  raised: AlertRow[];
  counts: AlertDesk['counts'];
  feed: AlertRow[];
}

/** One row of the append-only log: who, when, what, and the reason typed with it. */
export interface AuditLine {
  id: number;
  actor: string | null;
  by: string;
  action: string;
  family: string;
  target: string;
  detail: string;
  created_at: string;
}

export interface AuditFacets {
  families: { id: string; label: string; n: number; contract: boolean }[];
  actors: { actor: string; n: number }[];
  actions: { action: string; n: number }[];
}

export interface AuditSummary {
  entries: number;
  people: number;
  system: number;
  newest: string | null;
}

export interface AuditPage extends Page<AuditLine> {
  generated_at: string;
  facets: AuditFacets;
  summary: AuditSummary;
  whole: AuditSummary;
  filters: Record<string, string>;
  contract: string[];
}

/** One of the five files, with what it would hold before it is built. */
export interface ExportFile {
  id: string;
  label: string;
  blurb: string;
  columns: string[];
  rows: number;
}

export interface ExportIndex {
  files: ExportFile[];
  labels: { id: string; label: string; blurb: string }[];
  window: { since: string | null; until: string | null };
  cap: number;
  taken: AuditLine[];
  columns_of: Record<string, string[]>;
  detail?: string;
}

export interface ExportBuilt {
  filename: string;
  dataset: string;
  rows: number;
  columns: string[];
  truncated: boolean;
  detail: string;
  csv: string;
  taken_at: string;
}

/** --- contract 6.10: the size of one post ---------------------------------- */

export interface LimitsBlock {
  id: 'text' | 'photo' | 'video';
  label: string;
  lines: (SettingLine & { range: number[] })[];
}

export interface LimitsConfig {
  text: { characters: number };
  photo: { per_post: number; each_mb: number; each_bytes: number };
  video: { per_post: number; seconds: number; each_mb: number; each_bytes: number };
  server_upload_mb: number;
}

export interface LimitsDesk {
  blocks: LimitsBlock[];
  contract: Record<string, number>;
  server: { upload_mb: number; kinds: string[] };
  published: LimitsConfig;
  oversized: string[];
  can_write: boolean;
  detail?: string;
  changed?: string[];
  warnings?: string[];
  config?: LimitsConfig;
  errors?: string[];
}
