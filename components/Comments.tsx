'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import { ago, uid } from '@/lib/utils';
import { IC } from '@/lib/icons';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import ReactionButton from './ReactionButton';

export default function Comments({ postId, onClose }: { postId: string; onClose?: () => void }) {
  const { db, me, addComment, deleteComment } = useApp();
  const [text, setText] = useState('');
  const [sort, setSort] = useState('newest');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLFormElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const sheet = !!onClose;
  
  const allComments = db.comments.filter(c => c.pid === postId && c.status === 'live');
  const topLevelComments = allComments.filter(c => !c.parentId).sort((a, b) => sort === 'newest' ? b.ts - a.ts : a.ts - b.ts);
  
  // Get post reactions to show only reaction icons that exist on the post
  const post = db.posts.find(p => p.id === postId);
  const postReactions = db.reactions.filter(r => r.targetType === 'post' && r.targetId === postId);
  const reactionKindsSet = new Set(postReactions.map(r => r.kind));
  const reactionKinds = Array.from(reactionKindsSet).filter(kind => kind); // Only existing reactions
  
  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [sheet]);

  // Fix keyboard covering input - scroll input into view
  useEffect(() => {
    if (!inputRef.current) return;
    
    const handleFocus = () => {
      setTimeout(() => {
        if (composeRef.current) {
          composeRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'end',
            inline: 'nearest'
          });
        }
      }, 300); // Delay for keyboard animation
    };
    
    const input = inputRef.current;
    input.addEventListener('focus', handleFocus);
    return () => input.removeEventListener('focus', handleFocus);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !me) return;
    
    addComment({ 
      id: uid(), 
      pid: postId, 
      uid: me.id, 
      text: text.trim(), 
      ts: Date.now(), 
      status: 'live',
      parentId: replyingTo || undefined
    });
    
    setText('');
    setReplyingTo(null);
    
    // Scroll to top for newest, bottom for oldest
    if (list.current) {
      if (sort === 'newest') {
        list.current.scrollTop = 0;
      } else {
        list.current.scrollTop = list.current.scrollHeight;
      }
    }
  };

  const handleReply = (commentId: string, authorName: string) => {
    setReplyingTo(commentId);
    setText(`@${authorName} `);
    inputRef.current?.focus();
  };

  const getReplies = (commentId: string) => {
    return allComments.filter(c => c.parentId === commentId).sort((a, b) => a.ts - b.ts);
  };

  const renderComment = (comment: any, isReply = false) => {
    const author = db.users.find(u => u.id === comment.uid);
    if (!author) return null;

    const commentReactions = db.reactions.filter(r => r.targetType === 'comment' && r.targetId === comment.id);
    const commentReactionKindsSet = new Set(commentReactions.map(r => r.kind));
    const commentReactionKinds = Array.from(commentReactionKindsSet);
    const replies = getReplies(comment.id);

    return (
      <div key={comment.id} className={`comments-row ${isReply ? 'reply' : ''}`}>
        <Avatar user={author} size={isReply ? 28 : 30}/>
        <div className="comments-content">
          <div className="comment-bubble">
            <div><b>{author.name}</b>{author.verified && <VerifiedBadge size={13}/>}</div>
            <p>{comment.text}</p>
            {commentReactionKinds.length > 0 && (
              <div className="comment-bubble-reactions">
                {commentReactionKinds.map(kind => (
                  <span key={kind} className="comment-reaction-badge" title={kind}>
                    {kind === 'like' && '👍'}
                    {kind === 'love' && '❤️'}
                    {kind === 'haha' && '😂'}
                    {kind === 'wow' && '😮'}
                    {kind === 'sad' && '😢'}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="comment-meta">
            <time>{ago(comment.ts, db.lang)}</time>
            <ReactionButton targetType="comment" targetId={comment.id} small/>
            <button 
              className="comment-action-btn" 
              onClick={() => handleReply(comment.id, author.name)}
            >
              Reply
            </button>
            {me?.id === comment.uid && (
              <button className="delete-comment-btn" onClick={() => deleteComment(comment.id)}>
                Delete
              </button>
            )}
          </div>
          {replies.length > 0 && (
            <div className="comment-replies">
              {replies.map(reply => renderComment(reply, true))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const content = <div className={sheet ? 'comments-sheet' : 'comments-inline'} ref={dialog} role={sheet ? 'dialog' : undefined} aria-modal={sheet || undefined} aria-label="Comments" tabIndex={sheet ? -1 : undefined} onClick={e => e.stopPropagation()} onKeyDown={e => {
    if (e.key === 'Escape') {
      if (replyingTo) {
        setReplyingTo(null);
        setText('');
      } else {
        close.current?.();
      }
    }
    if (!sheet || e.key !== 'Tab') return;
    const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select');
    if (!nodes?.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }}>
    {sheet && <div className="comments-grip"/>}
    <div className="comments-heading">
      <div className="comments-reactions-row">
        {reactionKinds.length > 0 && (
          <div className="comment-reactions-display">
            {reactionKinds.map(kind => (
              <span key={kind} className="comment-reaction-icon" title={kind}>
                {kind === 'like' && '👍'}
                {kind === 'love' && '❤️'}
                {kind === 'haha' && '😂'}
                {kind === 'wow' && '😮'}
                {kind === 'sad' && '😢'}
              </span>
            ))}
          </div>
        )}
        <span className="reactions-count">{postReactions.length ? `${postReactions.length}` : ''}</span>
      </div>
      {sheet && <button className="icon-btn" aria-label="Close comments" onClick={onClose}>{IC.x}</button>}
    </div>
    <div className="comments-sort">
      <label>Comments 
        <select aria-label="Sort comments" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </label>
      <span>{allComments.length}</span>
    </div>
    <div className="comments-list" ref={list}>
      {!topLevelComments.length && <div className="comments-empty">{IC.msg}<h2>No comments yet</h2><p>Be the first to comment.</p></div>}
      {topLevelComments.map(c => renderComment(c))}
    </div>
    {me ? (
      <form className="comments-compose" ref={composeRef} onSubmit={handleSubmit}>
        <Avatar user={me} size={30}/>
        {replyingTo && (
          <button 
            type="button" 
            className="cancel-reply" 
            onClick={() => { setReplyingTo(null); setText(''); }}
            aria-label="Cancel reply"
          >
            {IC.x}
          </button>
        )}
        <input 
          ref={inputRef} 
          aria-label="Write a comment" 
          placeholder={replyingTo ? 'Write a reply...' : `Comment as ${me.name}`}
          maxLength={1000} 
          value={text} 
          onChange={e => setText(e.target.value)}
        />
        <button type="submit" aria-label="Send comment" disabled={!text.trim()}>
          {IC.send}
        </button>
      </form>
    ) : (
      <div className="comments-compose">
        <Link href="/login">Sign in to comment</Link>
      </div>
    )}
  </div>;
  
  return sheet ? createPortal(<div className="comments-overlay" onClick={onClose}>{content}</div>, document.body) : content;
}
