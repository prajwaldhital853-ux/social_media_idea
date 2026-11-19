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
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const sheet = !!onClose;
  const comments = db.comments.filter(c => c.pid === postId && c.status === 'live').sort((a, b) => sort === 'newest' ? b.ts - a.ts : a.ts - b.ts);
  const reactions = db.reactions.filter(r => r.targetType === 'post' && r.targetId === postId).length;
  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [sheet]);
  const content = <div className={sheet ? 'comments-sheet' : 'comments-inline'} ref={dialog} role={sheet ? 'dialog' : undefined} aria-modal={sheet || undefined} aria-label="Comments" tabIndex={sheet ? -1 : undefined} onClick={e => e.stopPropagation()} onKeyDown={e => {
    if (e.key === 'Escape') close.current?.();
    if (!sheet || e.key !== 'Tab') return;
    const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select');
    if (!nodes?.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }}>
    {sheet && <div className="comments-grip"/>}
    <div className="comments-heading"><span>{reactions ? `${reactions} ${reactions === 1 ? 'reaction' : 'reactions'}` : 'Be the first to like this'}</span><ReactionButton targetType="post" targetId={postId}/>{sheet && <button className="icon-btn" aria-label="Close comments" onClick={onClose}>{IC.x}</button>}</div>
    <div className="comments-sort"><label>Comments <select aria-label="Sort comments" value={sort} onChange={e => setSort(e.target.value)}><option value="newest">Newest</option><option value="oldest">Oldest</option></select></label><span>{comments.length}</span></div>
    <div className="comments-list" ref={list}>
      {!comments.length && <div className="comments-empty">{IC.msg}<h2>No comments yet</h2><p>Be the first to comment.</p></div>}
      {comments.map(c => { const author = db.users.find(u => u.id === c.uid); return author && <div className="comments-row" key={c.id}><Avatar user={author} size={30}/><div className="comments-content"><div className="comment-bubble"><div><b>{author.name}</b>{author.verified && <VerifiedBadge size={13}/>}</div><p>{c.text}</p></div><div className="comment-meta"><time>{ago(c.ts, db.lang)}</time><ReactionButton targetType="comment" targetId={c.id} small/>{me?.id === c.uid && <button onClick={() => deleteComment(c.id)}>Delete</button>}</div></div></div>; })}
    </div>
    {me ? <form className="comments-compose" onSubmit={e => {
      e.preventDefault(); if (!text.trim()) return;
      addComment({ id: uid(), pid: postId, uid: me.id, text: text.trim(), ts: Date.now(), status: 'live' });
      setText(''); list.current?.scrollTo({ top: sort === 'newest' ? 0 : list.current.scrollHeight });
    }}><Avatar user={me} size={30}/><input aria-label="Write a comment" placeholder={`Comment as ${me.name}`} maxLength={1000} value={text} onChange={e => setText(e.target.value)}/><button type="submit" aria-label="Send comment" disabled={!text.trim()}>{IC.send}</button></form> : <div className="comments-compose"><Link href="/login">Sign in to comment</Link></div>}
  </div>;
  return sheet ? createPortal(<div className="comments-overlay" onClick={onClose}>{content}</div>, document.body) : content;
}
