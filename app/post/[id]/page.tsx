'use client';

import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/PostCard';
import Comments from '@/components/Comments';
import { useApp } from '@/lib/AppContext';
import { canSeePost } from '@/lib/utils';
import { IC } from '@/lib/icons';

export default function PostPage() {
  const params = useParams();
  const router = useRouter();
  const { db, me, isStaff } = useApp();
  const post = db.posts.find(p => p.id === params.id);
  const available = post && (post.status === 'live' || me?.id === post.uid || isStaff()) && canSeePost(post, me?.id ?? null, db.follows);
  const author = post && db.users.find(u => u.id === post.uid);
  
  return <AppShell>
    <div className="thread-view">
      <header className="detail-header">
        <button 
          type="button" 
          className="icon-btn" 
          aria-label="Back" 
          onClick={() => window.history.length > 1 ? router.back() : router.push('/')}
        >
          {IC.back}
        </button>
        <h1>{available && author ? `${author.name}'s post` : 'Post'}</h1>
        <span className="detail-header-spacer"/>
      </header>
      {available && author ? (
        <div className="post-page-content">
          <PostCard post={post} author={author} featured/>
          <div className="post-page-comments">
            <Comments postId={post.id}/>
          </div>
        </div>
      ) : (
        <p className="feed-empty">This post is not available.</p>
      )}
    </div>
  </AppShell>;
}
