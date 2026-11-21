'use client';

import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import Comments from '@/components/Comments';
import { useApp } from '@/lib/AppContext';
import { canSeePost, privateIds } from '@/lib/utils';
import { useRemoteRow } from '@/lib/useRemoteRow';
import { IC } from '@/lib/icons';

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, isStaff, t } = useApp();
  const id = String(params.id || '');
  const post = db.posts.find(p => p.id === id);
  const { remote, pull } = useRemoteRow('post', id, !!post);

  const available = !!post && (post.status === 'live' || me?.id === post.uid || isStaff()) && canSeePost(post, me?.id ?? null, db.follows, privateIds(db.users));
  const author = post ? db.users.find(u => u.id === post.uid) : undefined;

  return <AppShell>
    <div className="thread-view">
      <header className="detail-header">
        <button
          type="button"
          className="icon-btn"
          aria-label={t('back')}
          onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
        >
          {IC.back}
        </button>
        <h1>{available && author ? `${author.name}'s post` : 'Post'}</h1>
        <span className="detail-header-spacer"/>
      </header>
      {available && author && post ? (
        <div className="post-page-content">
          <PostCard post={post} author={author} featured/>
          <div className="post-page-comments">
            <Comments postId={post.id}/>
          </div>
        </div>
      ) : remote === 'loading' ? (
        <div className="feed-skeleton" aria-hidden="true">
          <div className="feed-skeleton-head"><span className="sk-avatar" /><span className="sk-lines"><i /><i /></span></div>
          <div className="sk-lines wide"><i /><i /></div>
        </div>
      ) : remote === 'error' ? (
        <p className="feed-empty">
          Could not load this post. <button type="button" className="ghost-btn" onClick={pull}>{t('retry')}</button>
        </p>
      ) : (
        <p className="feed-empty">This post is not available.</p>
      )}
    </div>
  </AppShell>;
}
