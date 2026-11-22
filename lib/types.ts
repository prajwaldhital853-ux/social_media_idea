export type Role = 'superadmin' | 'admin' | 'moderator' | 'user';
export type SignupProvider = 'email' | 'google' | 'facebook' | 'apple';
export type ReactionKind = 'like' | 'love' | 'haha' | 'wow' | 'sad';

export interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: Role;
  verified: boolean;
  // Only the session knows these two; a card for somebody else must stay silent
  // so merging it over a profile cannot invent account settings.
  emailVerified?: boolean;
  susp: Suspension | null;
  provider: SignupProvider;
  dob: string;
  country: string;
  province?: string;
  city?: string;
  bio?: string;
  avatar?: string;
  cover?: string;
  private?: boolean;
  twoStep?: boolean;
  /** Email a member about new followers as well as the in-app bell. */
  notifyEmail?: boolean;
  website?: string;
  phone?: string;
  links?: ProfileLink[];
  joined: number;
  coins: number;
  warning?: string | null;
}

/** A row in the About section. The url is http(s) only: it opens in a new tab. */
export interface ProfileLink {
  label: string;
  url: string;
}

export interface Suspension {
  until: number | null;
  reason: string;
}

export interface Post {
  id: string;
  uid: string;
  kind?: 'post' | 'reel';
  text: string;
  media: Media[];
  ts: number;
  status: 'live' | 'hidden' | 'removed';
  edited?: boolean;
  processingUntil?: number;
  removedReason?: string;
  mood?: string;
  place?: string;
  /** Set on a card that announces a profile or cover change instead of a caption. */
  activity?: 'profile' | 'cover';
  audience?: 'public' | 'followers';
  category?: string;
  /** Server-side aggregates: present in API mode, derived from `reactions` in demo mode. */
  likes?: number;
  comments?: number;
  /** {kind: count} in API mode; undefined in demo mode (count the reaction rows instead). */
  reactionKinds?: Record<string, number>;
  promoted?: boolean;
}

export interface Media {
  type: 'image' | 'video';
  src?: string;
  gen?: string;
  dur?: number;
  blobId?: string;
  likes?: number;
  reactionKinds?: Record<string, number>;
}

export interface Comment {
  id: string;
  pid: string;
  parentId?: string;
  mediaIndex?: number;
  uid: string;
  text: string;
  ts: number;
  status: 'live' | 'removed';
  likes?: number;
  replies?: number;
}

export interface Follow {
  follower: string;
  following: string;
  ts: number;
  status?: 'pending' | 'accepted';
  /** Server id of a pending follow request; needed to accept or decline it. */
  rid?: string;
}

export interface Reaction {
  id: string;
  targetType: 'post' | 'comment' | 'media';
  targetId: string;
  uid: string;
  kind: ReactionKind;
  ts: number;
}

export interface Save {
  uid: string;
  pid: string;
  ts: number;
}

export interface ListingSave {
  uid: string;
  lid: string;
  ts: number;
}

export type NotificationKind =
  | 'follow' | 'reaction' | 'comment' | 'message'
  | 'system' | 'promotion' | 'coins' | 'warning';

export interface Notification {
  id: string;
  uid: string;
  kind: NotificationKind;
  actor?: string;
  text: string;
  href?: string;
  ts: number;
  read: boolean;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  text: string;
  ts: number;
  read: boolean;
  /** Only the inbox answers this: how many messages are still unread in the thread. */
  unread?: number;
}

export interface Listing {
  id: string;
  uid: string;
  title: string;
  desc: string;
  price: number;
  category: string;
  location: string;
  media: Media[];
  ts: number;
  status: 'active' | 'sold' | 'hidden' | 'removed';
  condition?: string;
  sellerName?: string;
  sellerUsername?: string;
}

export interface CoinRequest {
  id: string;
  uid: string;
  coins: number;
  amount: number;
  method: 'bank' | 'qr';
  reference: string;
  screenshot?: string;
  ts: number;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
}

export interface LedgerEntry {
  id: string;
  uid: string;
  delta: number;
  kind: 'purchase' | 'spend' | 'refund' | 'admin';
  note: string;
  ts: number;
}

export interface Promotion {
  id: string;
  uid: string;
  targetType: 'post' | 'listing';
  targetId: string;
  packageId: string;
  category: string;
  ageMin: number;
  ageMax: number;
  country: string;
  city?: string;
  coins: number;
  ts: number;
  ends: number;
  status: 'pending' | 'active' | 'paused' | 'ended' | 'rejected';
  impressions: number;
  clicks: number;
}

export interface PromoPackage {
  id: string;
  name: string;
  coins: number;
  days: number;
  reach: string;
}

export interface Report {
  id: string;
  type: 'post' | 'comment' | 'listing' | 'profile';
  targetId: string;
  by: string;
  reason: string;
  note: string;
  ts: number;
  status: 'open' | 'dismissed' | 'actioned';
  reporterUsername?: string;
}

export interface Audit {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target: string;
  reason: string;
}

export interface FeatureFlags {
  video: boolean;
  marketplace: boolean;
  promotion: boolean;
  googleLogin: boolean;
  /** A DEBUG server offers an explicitly labelled demo Google identity. */
  googleDemo: boolean;
  facebookLogin: boolean;
  appleLogin: boolean;
}

export interface Settings {
  threshold: number;
  coinPrice: number;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  qrImage?: string;
  features: FeatureFlags;
  packages: PromoPackage[];
  categories: string[];
  /** Set when the server has a real Google OAuth app; the SPA then loads GIS. */
  googleClientId?: string;
  demoGoogle?: { email: string; name: string; sub: string } | null;
}

export interface Database {
  users: User[];
  posts: Post[];
  comments: Comment[];
  follows: Follow[];
  reactions: Reaction[];
  saves: Save[];
  listingSaves?: ListingSave[];
  notifications: Notification[];
  messages: Message[];
  listings: Listing[];
  coinRequests: CoinRequest[];
  ledger: LedgerEntry[];
  promotions: Promotion[];
  reports: Report[];
  audit: Audit[];
  settings: Settings;
  meId: string | null;
  lang: 'en' | 'ne';
  seedVersion?: number;
  /** Server unread counters — the only badge source that is not windowed into the cache. */
  unread?: { notifications: number; messages: number };
  /** Server clock, used to price promotion windows and expiring locks. */
  serverTime?: number;
}

export type ThemeMode = 'light' | 'dark';

export interface ComposerState {
  postId: string | null;
  media: Media[];
}