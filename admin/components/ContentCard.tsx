'use client';

import { ReactNode } from 'react';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { ContentKind, ContentPreview } from '@/lib/types';

const KIND_LABEL: Record<ContentKind, string> = {
  post: 'Post', comment: 'Comment', listing: 'Listing', user: 'Account',
};

/**
 * Each app calls its visible state something else, so one table reads them all
 * the way a person on shift says it.
 */
const STATE_LABEL: Record<string, string> = {
  live: 'In the feed',
  active: 'Live',
  hidden: 'Hidden pending review',
  removed: 'Taken down',
  suspended: 'Suspended',
  deactivated: 'Closed by the person',
};

const STATE_TONE: Record<string, 'good' | 'warn' | 'dead' | 'mute'> = {
  live: 'good', active: 'good', hidden: 'warn', removed: 'dead',
  suspended: 'dead', deactivated: 'mute',
};

// An account is not "live" the way a post is; the same column reads differently.
const USER_STATE: Record<string, string> = {
  active: 'Active', suspended: 'Suspended', deactivated: 'Closed by the person',
};

export function statePill(state: string, kind: ContentKind = 'post') {
  const label = (kind === 'user' && USER_STATE[state]) || STATE_LABEL[state] || state;
  return <span className={`pill ${STATE_TONE[state] || 'mute'}`}>{label}</span>;
}

/**
 * Blocked words are shown where they sit in the sentence. A moderator who has to
 * scroll down to a list of flags to work out which one matched reads the flag
 * twice as often and trusts it half as much.
 */
function mark(text: string, terms: string[]): ReactNode {
  if (!text || terms.length === 0) return text;
  const pattern = terms
    .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean)
    .join('|');
  if (!pattern) return text;
  const hits = new Set(terms.map(term => term.toLowerCase()));
  return text.split(new RegExp(`(${pattern})`, 'ig')).map((part, index) => (
    hits.has(part.toLowerCase())
      ? <mark key={index} className="hit">{part}</mark>
      : <span key={index}>{part}</span>
  ));
}

function who(author: ContentPreview['author']) {
  if (!author) return null;
  return (
    <span className="who">
      {author.avatar_url
        ? <img className="avatar" src={author.avatar_url} alt="" loading="lazy"/>
        : <span className="avatar blank">{(author.name || author.username).slice(0, 1).toUpperCase()}</span>}
      <span className="who-name">
        <b>{author.name}</b>
        <em>@{author.username}</em>
        {author.verified && <span className="verified" title="Verified account">✓</span>}
      </span>
    </span>
  );
}

/**
 * The thing itself. Every screen that decides content, the report queue and the
 * takedown shelf, paints this from the same server payload, so a moderator sees
 * exactly what a person posted no matter which door they came through.
 */
export default function ContentCard({ content, matched = [] }: {
  content: ContentPreview | null;
  matched?: string[];
}) {
  if (!content) {
    return (
      <p className="empty-note">
        {IC.x}<span>The reported thing is no longer on the platform, so there is nothing here to look at.</span>
      </p>
    );
  }

  const photos = (content.media || []).filter(item => item.kind !== 'video');
  const films = (content.media || []).filter(item => item.kind === 'video');
  const listingImages = content.images?.length ? content.images : content.image ? [content.image] : [];

  return (
    <article className="cwrap">
      <div className="cbar">
        <span className={`kind kind-${content.kind}`}>{KIND_LABEL[content.kind]}</span>
        {statePill(content.state, content.kind)}
        <span className="cmeta">#{content.id}</span>
        <span className="cwhen">{ago(content.created_at)}</span>
        {content.audience && content.audience !== 'public' && (
          <span className="pill mute">{content.audience}</span>
        )}
        {content.category && <span className="pill mute">{content.category}</span>}
        {matched.length > 0 && (
          <span className="pill warn">{matched.length} on the blocked list</span>
        )}
      </div>

      <div className="cbody">
        {content.kind === 'user' ? (
          <dl className="facts">
            <div><dt>Account</dt><dd>{who(content.author)}</dd></div>
            <div><dt>Email</dt><dd>{content.email || 'none on file'}</dd></div>
            <div><dt>Joined</dt><dd>{ago(content.created_at)}</dd></div>
            <div>
              <dt>Suspension</dt>
              <dd>{content.suspended_until ? `until ${new Date(content.suspended_until).toLocaleString()}` : 'none'}</dd>
            </div>
            {content.is_staff && <div><dt>Console seat</dt><dd>Yes, decide from Staff and access</dd></div>}
          </dl>
        ) : (
          <>
            <header className="cwho">
              {who(content.author)}
              {content.kind === 'listing' && (
                <span className="price">{content.currency || 'NPR'} {num(Number(content.price || 0))}</span>
              )}
            </header>

            {content.kind === 'listing' && (
              <div className="clisting">
                {listingImages[0]
                  ? <img className="cthumb" src={listingImages[0]} alt="" loading="lazy"/>
                  : <span className="cthumb blank">{IC.store}</span>}
                <div>
                  <h3>{content.title}</h3>
                  {content.text && <p className="ctext">{mark(content.text, matched)}</p>}
                  <p className="cfoot">
                    {content.condition && <span>{content.condition}</span>}
                    {content.location && <span>{content.location}</span>}
                  </p>
                </div>
              </div>
            )}

            {content.kind === 'listing' && listingImages.length > 1 && (
              <div className={`cmedia n${Math.min(4, listingImages.length - 1)}`}>
                {listingImages.slice(1).map((url, index) => (
                  <img key={index} className="cphoto" src={url} alt="" loading="lazy"/>
                ))}
              </div>
            )}

            {content.kind === 'post' && (
              <>
                {content.text && <p className="ctext">{mark(content.text, matched)}</p>}
                {(photos.length > 0 || films.length > 0) && (
                  <div className={`cmedia n${Math.min(4, photos.length + films.length)}`}>
                    {photos.map((item, index) => (
                      item.url
                        ? <img key={index} className="cphoto" src={item.url} alt="" loading="lazy"/>
                        : <span key={index} className="cphoto blank" />
                    ))}
                    {films.map((item, index) => (
                      item.url
                        ? (
                          <span key={`v${index}`} className="cfilm">
                            <video src={item.url} preload="metadata" controls playsInline/>
                            {item.duration ? <em>{Math.round(item.duration)}s</em> : null}
                          </span>
                        )
                        : <span key={`v${index}`} className="cfilm blank"/>
                    ))}
                  </div>
                )}
                <p className="cfoot">
                  <span>{num(content.likes)} likes</span>
                  <span>{num(content.comments)} comments</span>
                </p>
              </>
            )}

            {content.kind === 'comment' && (
              <>
                {content.text && <p className="ctext">{mark(content.text, matched)}</p>}
                {content.on_post && (
                  <p className="conpost">
                    <span className="pill mute">on a post by @{content.on_post.author}</span>
                    <span>{content.on_post.text || '(no caption)'}</span>
                    {statePill(content.on_post.state)}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </article>
  );
}
