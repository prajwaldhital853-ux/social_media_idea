import {
  Audit, CoinRequest, Comment, Follow, LedgerEntry, Listing, Media, Message,
  Notice, Notification, NotificationKind, Post, Promotion, Reaction, ReactionKind, Report,
  Settings, User,
} from './types';

/**
 * Translators between the Django API and the client view-model.
 *
 * The API returns ids as integers and money as decimal strings; the app works
 * with string ids and numbers throughout, so every mapping funnels through the
 * two coercions below.
 */

export const idOf = (value: number | string | null | undefined): string => (value === null || value === undefined ? '' : String(value));
export const at = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};
const amount = (value: number | string | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(n) ? 0 : n;
};

const KINDS: ReactionKind[] = ['like', 'love', 'haha', 'wow', 'sad'];
const reactionKind = (kind: string): ReactionKind => (KINDS.includes(kind as ReactionKind) ? (kind as ReactionKind) : 'like');

/**
 * Files live behind `/media/`, which next.config.js proxies to the API. Rebuilding
 * the URL on the current origin keeps every asset first-party no matter which host
 * the API happened to be listening on when it was uploaded.
 */
const ORIGIN = typeof window === 'undefined' ? '' : window.location.origin;
export function mediaUrl(value: string | undefined | null): string {
  if (!value || !ORIGIN) return value || '';
  const cut = value.indexOf('/media/');
  return cut < 0 ? value : ORIGIN + value.slice(cut);
}

const NOTE_KIND: Record<string, NotificationKind> = {
  follow: 'follow', follow_request: 'follow', follow_accept: 'follow',
  reaction: 'reaction', comment: 'comment', reply: 'comment',
  message: 'message', system: 'system', promotion: 'promotion',
  coins: 'coins', warning: 'warning',
};

export function mapMe(p: any): User {
  return {
    id: idOf(p.id),
    email: p.email || '',
    username: p.username,
    name: p.name || p.username,
    role: p.role || 'user',
    verified: !!p.verified,
    emailVerified: !!p.emailVerified,
    susp: p.susp ? { until: p.susp.until ? at(p.susp.until) : null, reason: p.susp.reason || '' } : null,
    provider: p.provider || 'email',
    dob: p.dob || '',
    country: p.country || '',
    province: p.province || '',
    city: p.city || '',
    bio: p.bio || '',
    website: p.website || '',
    phone: p.phone || '',
    links: Array.isArray(p.links) ? p.links : [],
    avatar: mediaUrl(p.avatar),
    cover: mediaUrl(p.cover),
    private: !!p.private,
    twoStep: p.twoStep !== false,
    notifyEmail: p.notifyEmail !== false,
    notifyFollowEmail: p.notifyFollowEmail !== false,
    joined: at(p.joined),
    coins: Math.round(amount(p.coins)),
  };
}

/** A person card as returned by feeds, search, followers and the admin roster. */
export function mapPerson(c: any): User {
  const person: Record<string, any> = {
    id: idOf(c.id ?? c.username),
    email: c.email || '',
    username: c.username,
    name: c.name || c.username,
    role: c.role || 'user',
    verified: !!c.verified,
    emailVerified: c.email_verified === undefined ? undefined : !!c.email_verified,
    susp: c.suspended_until ? { until: at(c.suspended_until), reason: c.suspend_reason || '' } : null,
    provider: c.provider || 'email',
    dob: c.dob || '',
    country: c.country || '',
    province: c.province || '',
    city: c.city || '',
    bio: c.bio || '',
    avatar: mediaUrl(c.avatar_url || c.avatar),
    cover: mediaUrl(c.cover_url || c.cover),
    private: !!c.is_private,
    twoStep: c.two_step === undefined ? undefined : !!c.two_step,
    joined: at(c.joined ?? c.created_at),
    coins: Math.round(amount(c.coins)),
  };
  // A thin card that never answered these would demote a staff account, un-verify
  // a badge or date a member from the epoch, so unanswered keys are dropped
  // rather than defaulted onto a richer record already in the cache.
  if (c.verified === undefined) delete person.verified;
  if (!c.role) delete person.role;
  if (!c.provider) delete person.provider;
  if (c.joined === undefined && c.created_at === undefined) delete person.joined;
  if (c.is_private === undefined) delete person.private;
  // About-section contacts only ride on a full profile read; a thin card that
  // never answered them must not clear what the cache already holds.
  if (c.website !== undefined) person.website = c.website || '';
  else delete person.website;
  if (c.phone !== undefined) person.phone = c.phone || '';
  else delete person.phone;
  if (c.links !== undefined) person.links = Array.isArray(c.links) ? c.links : [];
  else delete person.links;
  // A notice about the account only rides on a full profile read, and an empty
  // list is left off rather than stored, so a thin card cannot clear one.
  if (c.notices !== undefined) person.notices = mapNotices(c.notices);
  else delete person.notices;
  return person as unknown as User;
}

export function mapMedia(m: any): Media {
  return {
    type: m.kind === 'video' ? 'video' : 'image',
    src: mediaUrl(m.url || m.file),
    dur: m.duration ? Number(m.duration) : undefined,
    likes: amount(m.like_count),
    // Every comment hanging on this picture, replies and words on the picture
    // alike, counted where the rows live so the badge is right before the
    // thread is opened. Absent means the server said nothing, so the reader's
    // own cached rows stand in.
    comments: m.comment_count === undefined ? undefined : amount(m.comment_count),
  };
}

/**
 * The notices standing on one piece of content. Empty comes back as undefined
 * rather than an empty array, so a card the server said nothing about keeps the
 * shape it had and prints no banner.
 */
function mapNotices(rows: any): Notice[] | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  return rows.map((n: any) => ({
    id: idOf(n.id), text: n.text || '', reason: n.reason || undefined,
    by: n.by || undefined, ts: at(n.at), private: !!n.private,
    notificationId: n.notification_id == null ? undefined : idOf(n.notification_id),
  }));
}

export function mapPost(row: any): Post {
  const mediaKinds: Record<string, Record<string, number>> | undefined = row.media_reaction_kinds;
  return {
    id: idOf(row.id),
    uid: idOf(row.author),
    text: row.text || '',
    media: (row.media || []).map((m: any) => ({ ...mapMedia(m), reactionKinds: mediaKinds?.[String(m.position)] })),
    ts: at(row.created_at),
    status: row.status === 'hidden' || row.status === 'removed' ? row.status : 'live',
    notices: mapNotices(row.notices),
    edited: !!row.edited,
    mood: row.mood || undefined,
    place: row.place || undefined,
    activity: row.activity === 'profile' || row.activity === 'cover' ? row.activity : undefined,
    audience: row.audience === 'followers' ? 'followers' : 'public',
    likes: amount(row.like_count),
    // Every comment the post still has counts: a reply the reader wrote and a
    // word left on one picture of a multi-picture post are both comments, even
    // though the first hangs under its parent and the second also sits in that
    // picture's own thread. Counted once, wherever it is read.
    comments: amount(row.comment_total ?? row.comment_count),
    shares: amount(row.share_count),
    views: amount(row.views),
    reactionKinds: row.reaction_kinds || undefined,
    people: (row.reaction_people || []).map((p: any) => ({ id: idOf(p.id), name: p.name, kind: reactionKind(p.kind), me: !!p.me })),
    category: row.category || undefined,
    promoted: !!row.promoted,
  };
}

export function mapComment(row: any): Comment {
  return {
    id: idOf(row.id),
    pid: idOf(row.post),
    parentId: row.parent ? idOf(row.parent) : undefined,
    mediaIndex: row.media_index === null || row.media_index === undefined ? undefined : Number(row.media_index),
    uid: idOf(row.author),
    text: row.text || '',
    ts: at(row.created_at),
    status: row.status === 'hidden' || row.status === 'removed' ? row.status : 'live',
    notices: mapNotices(row.notices),
    likes: amount(row.like_count),
    replies: amount(row.reply_count),
    isPostAuthor: !!row.is_post_author,
  };
}

export function mapListing(row: any): Listing {
  const images = (row.images || []).map((i: any) => ({ type: 'image' as const, src: mediaUrl(i.url) }));
  return {
    id: idOf(row.id),
    uid: idOf(row.seller),
    title: row.title || '',
    desc: row.description || '',
    price: amount(row.price),
    category: row.category || 'Other',
    location: row.location || '',
    media: images.length ? images : row.image_url ? [{ type: 'image' as const, src: mediaUrl(row.image_url) }] : [],
    ts: at(row.created_at),
    status: row.status || 'active',
    promoted: !!row.promoted,
    promoId: row.promo ? idOf(row.promo.id) : undefined,
    notices: mapNotices(row.notices),
    condition: row.condition || '',
    sellerName: row.seller_name || undefined,
    sellerUsername: row.seller_username || undefined,
  };
}

export function hrefOf(kind: string, targetType: string, targetId: string, actorUsername?: string): string | undefined {
  // A message bell carries its sender as target_type='user', so this has to be
  // read before the user branch or the notification walks you to a profile
  // instead of the thread the message is waiting in.
  if (kind === 'message') return actorUsername ? `/messages/${actorUsername}` : '/messages';
  if (targetType === 'post') return `/post/${targetId}`;
  if (targetType === 'listing') return `/marketplace/${targetId}`;
  if (targetType === 'user') return actorUsername ? `/u/${actorUsername}` : '/messages';
  // A request for more proof is not a look at the balance: it is a question about
  // one open purchase, so it lands on the page that answers it.
  if (targetType === 'coin_proof') return `/wallet/proof/${targetId}`;
  // The same purchase, seen from the desk: the member answered the ask, and the
  // proof sits in the console queue rather than on a member screen.
  if (targetType === 'coin_request') return '/admin';
  if (targetType === 'wallet') return '/wallet';
  return undefined;
}

export function mapNotification(row: any): Notification {
  const kind = NOTE_KIND[row.kind] || 'system';
  return {
    id: idOf(row.id),
    uid: idOf(row.recipient),
    kind,
    actor: row.actor ? idOf(row.actor) : undefined,
    text: row.text || '',
    href: kind === 'warning'
      ? `/notifications/${idOf(row.id)}`
      : hrefOf(kind, row.target_type, idOf(row.target_id), row.actor_username),
    ts: at(row.created_at),
    read: !!row.read_at,
  };
}

export function mapMessage(row: any, meId: string, otherId: string): Message {
  const sender = idOf(row.sender);
  return {
    id: idOf(row.id),
    from: sender,
    to: sender === meId ? otherId : meId,
    text: row.text || '',
    ts: at(row.created_at),
    read: !!row.read_at,
    status: row.status || undefined,
  };
}

export function mapPromotion(row: any): Promotion {
  const budget = amount(row.budget);
  return {
    id: idOf(row.id),
    uid: idOf(row.owner),
    targetType: row.target_type === 'listing' ? 'listing' : 'post',
    targetId: idOf(row.target_id),
    packageId: row.package || '',
    category: row.category || '',
    ageMin: Number(row.age_min ?? 13),
    ageMax: Number(row.age_max ?? 65),
    country: row.country || '',
    cities: (Array.isArray(row.cities) ? row.cities : []).map((name: unknown) => String(name)),
    // The approval is what takes the coins, so `starts_at` is also the line between
    // "spent" and "quoted" — a waiting campaign has cost its payer nothing yet.
    coins: row.starts_at ? budget : 0,
    budget,
    ts: at(row.created_at),
    starts: at(row.starts_at),
    ends: at(row.ends_at),
    status: row.status || 'pending',
    impressions: amount(row.impressions),
    clicks: amount(row.clicks),
    profileVisits: amount(row.profile_visits),
    messages: amount(row.messages),
    reach: amount(row.reach),
    cpm: row.cpm === null || row.cpm === undefined ? null : amount(row.cpm),
    cpr: row.cpr === null || row.cpr === undefined ? null : amount(row.cpr),
    conversionRate: row.conversion_rate === null || row.conversion_rate === undefined
      ? null : amount(row.conversion_rate),
    engagementRate: row.engagement_rate === null || row.engagement_rate === undefined
      ? null : amount(row.engagement_rate),
    quality: row.quality === 'above' || row.quality === 'average' || row.quality === 'below' ? row.quality : null,
    editedAt: at(row.edited_at),
    targetLabel: row.target_label || undefined,
  };
}

export function mapReport(row: any): Report {
  return {
    id: idOf(row.id),
    type: (row.target_type === 'listing' || row.target_type === 'comment' || row.target_type === 'profile') ? row.target_type : 'post',
    targetId: idOf(row.target_id),
    by: idOf(row.reporter),
    reason: row.reason || '',
    note: row.details || '',
    ts: at(row.created_at),
    status: row.status === 'open' || row.status === 'reviewing' ? 'open' : row.status === 'dismissed' ? 'dismissed' : 'actioned',
    reporterUsername: row.reporter_username || '',
  };
}

export function mapAudit(row: any): Audit {
  return {
    id: idOf(row.id),
    ts: at(row.created_at),
    actor: row.actor ? `@${row.actor}` : 'system',
    action: row.action || '',
    target: row.target || '',
    reason: row.detail || '',
  };
}

export function mapLedger(row: any, uid: string): LedgerEntry {
  const value = amount(row.amount);
  return {
    id: idOf(row.id),
    uid,
    delta: row.kind === 'debit' ? -Math.abs(value) : Math.abs(value),
    kind: row.kind === 'debit' ? 'spend' : 'purchase',
    note: row.note || '',
    ts: at(row.created_at),
  };
}

export function mapCoinRequest(row: any): CoinRequest {
  return {
    id: idOf(row.id),
    uid: idOf(row.user),
    coins: Number(row.coins ?? 0),
    amount: amount(row.amount),
    method: row.method === 'bank' ? 'bank' : 'qr',
    reference: row.reference || '',
    screenshot: mediaUrl(row.screenshot_url) || undefined,
    ts: at(row.created_at),
    status: row.status || 'pending',
    proofAsked: !!row.proof_asked,
    proofReason: row.proof_reason || '',
    resubmitted: !!row.resubmitted,
    refundable: !!row.refundable,
    refundRequested: !!row.refund_requested,
    refunded: !!row.refunded,
    locked: Math.round(Number(row.locked_coins) || 0),
  };
}

export function mapFollow(edge: any): Follow {
  return {
    follower: idOf(edge.follower),
    following: idOf(edge.following),
    ts: at(edge.ts ?? edge.created_at),
    status: edge.status === 'pending' ? 'pending' : 'accepted',
    rid: edge.id ?? edge.request_id ? idOf(edge.id ?? edge.request_id) : undefined,
  };
}

export function mapSettings(config: any): Settings {
  return {
    threshold: Number(config.threshold ?? 3),
    coinPrice: Number(config.coinPrice ?? 10),
    minPurchase: Number(config.minPurchase ?? 100),
    limits: {
      textChars: Number(config.limits?.text?.characters ?? 2000),
      photoCount: Number(config.limits?.photo?.per_post ?? 4),
      photoMb: Number(config.limits?.photo?.each_mb ?? 5),
      videoCount: Number(config.limits?.video?.per_post ?? 1),
      videoSeconds: Number(config.limits?.video?.seconds ?? 60),
      videoMb: Number(config.limits?.video?.each_mb ?? 150),
    },
    bankName: config.bank?.name ?? '',
    bankAccount: config.bank?.account ?? '',
    bankHolder: config.bank?.holder ?? '',
    qrImage: config.bank?.qr || undefined,
    features: {
      video: config.features?.video !== false,
      marketplace: config.features?.marketplace !== false,
      promotion: config.features?.promotion !== false,
      googleLogin: !!config.features?.googleLogin,
      facebookLogin: !!config.features?.facebookLogin,
      appleLogin: !!config.features?.appleLogin,
    },
    packages: (config.packages || []).map((p: any) => ({
      id: p.id, name: p.name, coins: Number(p.coins), days: Number(p.days), reach: p.reach || '',
    })),
    categories: config.categories || [],
    googleClientId: config.googleClientId || undefined,
    wording: config.wording && Object.keys(config.wording).length
      ? {
        message: config.wording.message || '',
        tagline: config.wording.tagline || '',
        contact: (config.wording.contact || []).map((row: any) => ({ label: row.label || '', value: row.value || '' })),
      }
      : undefined,
  };
}

/** The current user's reactions implied by a page of posts — one row per target. */
export function reactionsOfPost(row: any, uid: string): Reaction[] {
  const rows: Reaction[] = [];
  const postId = idOf(row.id);
  if (row.my_reaction) {
    rows.push({ id: `rx_post_${postId}`, targetType: 'post', targetId: postId, uid, kind: reactionKind(row.my_reaction), ts: at(row.created_at) });
  }
  for (const [position, kind] of Object.entries(row.my_media_reactions || {})) {
    if (!kind) continue;
    rows.push({ id: `rx_media_${postId}_${position}`, targetType: 'media', targetId: `${postId}#m${position}`, uid, kind: reactionKind(kind as string), ts: at(row.created_at) });
  }
  return rows;
}

export function reactionsOfComment(row: any, uid: string): Reaction[] {
  if (!row.my_reaction) return [];
  return [{
    id: `rx_comment_${idOf(row.id)}`, targetType: 'comment', targetId: idOf(row.id),
    uid, kind: reactionKind(row.my_reaction), ts: at(row.created_at),
  }];
}

/**
 * A post row carries a slim author card; omitting the keys the row does not
 * answer (email, private, coins) keeps `merge` from overwriting a fuller record.
 */
export function personFromRow(row: any, prefix: string): User {
  return {
    id: idOf(row[prefix] ?? row.id),
    username: row[`${prefix}_username`],
    name: row[`${prefix}_name`],
    avatar: mediaUrl(row[`${prefix}_avatar_url`]),
    cover: mediaUrl(row[`${prefix}_cover_url`]) || undefined,
    bio: row[`${prefix}_bio`] || undefined,
    verified: !!row[`${prefix}_verified`],
  } as unknown as User;
}

/** Client post → the write payload the API accepts (never a position or a counter). */
export function toPostPayload(post: Post & { category?: string }): Record<string, any> {
  return {
    text: post.text || '',
    audience: post.audience === 'followers' ? 'followers' : 'public',
    mood: post.mood || '',
    place: post.place || '',
    category: post.category || hashtagOf(post.text),
    media: mediaPayload(post.media),
  };
}

/** Attachments the API can store: the database only accepts absolute http(s) URLs. */
export function mediaPayload(items: Media[]): Array<{ kind: 'image' | 'video'; url: string; duration: number }> {
  return (items || [])
    .filter(m => m.src && /^https?:/i.test(m.src))
    .map(m => ({ kind: m.type === 'video' ? 'video' : 'image', url: m.src as string, duration: m.dur || 0 }));
}

/**
 * Listing photos. `position` is left out on purpose: the serializer numbers the
 * rows in the order it receives them, and sending one would collide with the
 * keyword it already passes.
 */
export function listingImages(items: Media[]): Array<{ url: string }> {
  return (items || [])
    .filter(m => m.src && /^https?:/i.test(m.src))
    .map(m => ({ url: m.src as string }));
}

/** The first hashtag becomes the interest category the promotion matcher ranks on. */
export function hashtagOf(text: string): string {
  const match = /#([^\s,.!?;:"'()[\]#]+)/.exec(text || '');
  return match ? match[1] : '';
}

export function profilePatch(data: any): Partial<User> {
  const patch: Record<string, any> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.bio !== undefined) patch.bio = data.bio;
  if (data.avatar_url !== undefined) patch.avatar = data.avatar_url;
  if (data.cover_url !== undefined) patch.cover = data.cover_url;
  if (data.location !== undefined) patch.city = data.location;
  if (data.province !== undefined) patch.province = data.province;
  if (data.is_private !== undefined) patch.private = data.is_private;
  if (data.two_step !== undefined) patch.twoStep = data.two_step;
  if (data.notify_email !== undefined) patch.notifyEmail = !!data.notify_email;
  if (data.notify_follow_email !== undefined) patch.notifyFollowEmail = !!data.notify_follow_email;
  if (data.dob !== undefined) patch.dob = data.dob || '';
  if (data.country !== undefined) patch.country = data.country || '';
  if (data.city !== undefined) patch.city = data.city || patch.city;
  if (data.website !== undefined) patch.website = data.website || '';
  if (data.phone !== undefined) patch.phone = data.phone || '';
  if (data.links !== undefined) patch.links = Array.isArray(data.links) ? data.links : [];
  return patch as Partial<User>;
}

/** Client profile fields → ProfileSerializer write payload. */
export function toProfilePayload(patch: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  const keys: Array<[string, string]> = [
    ['name', 'name'], ['bio', 'bio'], ['avatar', 'avatar_url'], ['cover', 'cover_url'],
    ['province', 'province'], ['private', 'is_private'], ['twoStep', 'two_step'],
    ['notifyEmail', 'notify_email'], ['notifyFollowEmail', 'notify_follow_email'],
    ['dob', 'dob'], ['country', 'country'], ['city', 'city'], ['website', 'website'],
    ['phone', 'phone'], ['links', 'links'],
  ];
  for (const [from, to] of keys) {
    if (patch[from] === undefined) continue;
    // An unset birthday is "no date", not an empty string: DRF's DateField refuses ''.
    out[to] = from === 'dob' && !patch[from] ? null : patch[from];
  }
  if (patch.location !== undefined) out.location = patch.location;
  return out;
}
