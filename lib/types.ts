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
  emailVerified: boolean;
  susp: Suspension | null;
  provider: SignupProvider;
  dob: string;
  country: string;
  province?: string;
  city?: string;
  bio?: string;
  avatar?: string;
  twoStep: boolean;
  joined: number;
  coins: number;
  warning?: string | null;
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
}

export interface Media {
  type: 'image' | 'video';
  src?: string;
  gen?: string;
  dur?: number;
}

export interface Comment {
  id: string;
  pid: string;
  parentId?: string;
  uid: string;
  text: string;
  ts: number;
  status: 'live' | 'removed';
}

export interface Follow {
  follower: string;
  following: string;
  ts: number;
}

export interface Reaction {
  id: string;
  targetType: 'post' | 'comment';
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
}

export interface Database {
  users: User[];
  posts: Post[];
  comments: Comment[];
  follows: Follow[];
  reactions: Reaction[];
  saves: Save[];
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
}

export type ThemeMode = 'light' | 'dark';

export interface ComposerState {
  postId: string | null;
  media: Media[];
}