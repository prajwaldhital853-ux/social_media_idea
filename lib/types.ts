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
  notifyFollowEmail?: boolean;
  website?: string;
  phone?: string;
  links?: ProfileLink[];
  /** What staff have said publicly about this account, newest first. */
  notices?: Notice[];
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

/**
 * A sentence a seat put over one piece of content. It is not a report and not a
 * takedown: the thing stays up and everyone who reaches it reads this first.
 */
export interface Notice {
  id: string;
  text: string;
  /** The reason the seat wrote for the record, shown under the sentence. */
  reason?: string;
  by?: string;
  ts: number;
  /** True when a seat wrote it for the account alone — nobody else reads this one. */
  private?: boolean;
  /** The recipient's linked warning row, used to open the full detail page. */
  notificationId?: string;
}

export interface Post {
  id: string;
  uid: string;
  kind?: 'post' | 'reel';
  text: string;
  media: Media[];
  ts: number;
  status: 'live' | 'hidden' | 'removed';
  /** What staff have said publicly about this card, newest first. */
  notices?: Notice[];
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
  /** How many times the link has been handed to someone else. */
  shares?: number;
  /** How many times a reel was watched. Reels are counted, photos are not. */
  views?: number;
  /** {kind: count} in API mode; undefined in demo mode (count the reaction rows instead). */
  reactionKinds?: Record<string, number>;
  /** The first people who reacted, in the order the card prints them. */
  people?: { id: string; name: string; kind: ReactionKind; me: boolean }[];
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
  status: 'live' | 'hidden' | 'removed';
  /** What staff have said publicly about this comment, newest first. */
  notices?: Notice[];
  likes?: number;
  replies?: number;
  /** True when the commenter owns the post — the server decides it, replies included. */
  isPostAuthor?: boolean;
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
  /** Receipt on my own messages: sent -> delivered -> read. Older rows without one read off `read`. */
  status?: 'sent' | 'delivered' | 'read';
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
  /** What staff have said publicly about this listing, newest first. */
  notices?: Notice[];
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
  /** The desk asked for a better screenshot and has not been answered yet. */
  proofAsked?: boolean;
  proofReason?: string;
  /** This buyer already answered an ask, so the row is waiting on the desk. */
  resubmitted?: boolean;
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
  cities?: string[];
  /** What has actually left the wallet — zero until a seat approves the order. */
  coins: number;
  /** The price the package quotes, whether or not it has been paid yet. */
  budget?: number;
  ts: number;
  starts?: number;
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
  facebookLogin: boolean;
  appleLogin: boolean;
}

/** The size one post is allowed to be, the console's post limits desk decides. */
export interface PostLimits {
  textChars: number;
  photoCount: number;
  photoMb: number;
  videoCount: number;
  videoSeconds: number;
  videoMb: number;
}

export interface Settings {
  threshold: number;
  coinPrice: number;
  minPurchase: number;
  limits: PostLimits;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  qrImage?: string;
  features: FeatureFlags;
  packages: PromoPackage[];
  categories: string[];
  /** Set when the server has a real Google OAuth app; the SPA then loads GIS. */
  googleClientId?: string;
  /**
   * The wording the console's desk writes for the first load: the sentence on
   * the card, the line under it, and the contacts below that. Empty until a seat
   * says something, because the platform's own wording is what the server sends.
   */
  wording?: { message?: string; tagline?: string; contact?: { label: string; value: string }[] };
}

export interface Database {
  users: User[];
  posts: Post[];
  comments: Comment[];
  follows: Follow[];
  /** User ids the signed-in account has blocked. */
  blocks?: string[];
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