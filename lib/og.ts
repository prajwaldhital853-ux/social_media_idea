import type { Metadata } from 'next';

/**
 * Share-preview metadata for the three routes people paste into WhatsApp,
 * Viber and Facebook. Crawlers arrive without a session, so every read is the
 * anonymous API response and every card falls back to the branded default.
 */

const API_ORIGIN = process.env.EXPOSING_API_ORIGIN || 'http://127.0.0.1:8001';
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://social-media-idea.vercel.app').replace(/\/$/, '');

const DEFAULT_IMAGE = `${SITE_URL}/exposing-icon.png`;
const DESCRIPTION = 'Photos, clips and stories from your corner of the world — on Exposing.';

async function read(path: string): Promise<any> {
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, { signal: AbortSignal.timeout(4000), cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const clip = (value: string | undefined | null, max = 180): string => {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

function card(title: string, description: string, path: string, images: string[], type: 'article' | 'profile'): Metadata {
  const url = `${SITE_URL}${path}`;
  const picture = images.filter(Boolean).slice(0, 2);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type, title, description, url, siteName: 'Exposing',
      images: picture.length ? picture.map(src => ({ url: src })) : [{ url: DEFAULT_IMAGE }],
    },
    twitter: {
      card: picture.length ? 'summary_large_image' : 'summary',
      title, description, images: picture.length ? picture : [DEFAULT_IMAGE],
    },
  };
}

const abs = (src?: string | null): string => (!src ? '' : /^https?:/i.test(src) ? src : `${SITE_URL}${src}`);

export async function postMetadata(id: string): Promise<Metadata> {
  const row = await read(`/api/posts/${id}/`);
  const path = `/post/${id}`;
  if (!row) return card('Post on Exposing', DESCRIPTION, path, [], 'article');
  const who = clip(row.author_name || row.author_username, 60);
  const where = row.place ? ` at ${clip(row.place, 40)}` : '';
  const title = `${who}${where} — Exposing`;
  const pictures = (row.media || []).filter((m: any) => m.kind !== 'video').map((m: any) => abs(m.url || m.file));
  const video = (row.media || []).find((m: any) => m.kind === 'video');
  return card(
    clip(title, 90),
    clip(row.text) || (video ? 'Watch this clip on Exposing.' : 'See this photo on Exposing.'),
    path,
    pictures.length ? pictures : video ? [abs(video.thumbnail_url)] : [],
    'article',
  );
}

/** `/video/<postId>-<index>`: the reel's own card, so a clip pasted into
 *  WhatsApp shows its face rather than the site's default banner. */
export async function reelMetadata(key: string): Promise<Metadata> {
  const id = key.includes('-') ? key.slice(0, key.lastIndexOf('-')) : key;
  const row = await read(`/api/posts/${id}/`);
  const path = `/video/${key}`;
  if (!row) return card('Reel on Exposing', DESCRIPTION, path, [], 'article');
  const who = clip(row.author_name || row.author_username, 50);
  const video = (row.media || []).find((m: any) => m.kind === 'video');
  const picture = (row.media || []).find((m: any) => m.kind !== 'video' && (m.url || m.file));
  const images = video?.thumbnail_url ? [abs(video.thumbnail_url)] : picture ? [abs(picture.url || picture.file)] : [];
  return card(
    clip(`${who} — Reel on Exposing`, 90),
    clip(row.text) || 'Watch this clip on Exposing.',
    path,
    images,
    'article',
  );
}

export async function profileMetadata(username: string): Promise<Metadata> {
  const row = await read(`/api/profiles/${username}/`);
  const path = `/u/${username}`;
  if (!row) return card('@' + username, 'This account does not exist.', path, [], 'profile');
  const name = clip(row.name || username, 60);
  return card(
    `${name} (@${row.username}) — Exposing`,
    clip(row.bio) || `${Number(row.followers) || 0} followers on Exposing.`,
    path,
    [abs(row.cover_url), abs(row.avatar_url)],
    'profile',
  );
}

export async function listingMetadata(id: string): Promise<Metadata> {
  const row = await read(`/api/marketplace/${id}/`);
  const path = `/marketplace/${id}`;
  if (!row) return card('Listing on Exposing', DESCRIPTION, path, [], 'article');
  const price = Number(row.price);
  const title = `${clip(row.title, 60)}${Number.isFinite(price) ? ` · NPR ${price.toLocaleString('en-US')}` : ''} — Exposing`;
  return card(
    clip(title, 95),
    clip(row.description) || `${row.category || 'For sale'}${row.location ? ` in ${row.location}` : ''}.`,
    path,
    (row.images || []).map((image: any) => abs(image.url)),
    'article',
  );
}
