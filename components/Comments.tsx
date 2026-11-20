'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import { ago, uid, REACTIONS, reactionMeta } from '@/lib/utils';
import { Comment, ReactionKind } from '@/lib/types';
import { IC } from '@/lib/icons';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import ReactionButton from './ReactionButton';
import ReactionIcon from './ReactionIcon';

const SUGGESTIONS = ['Nice!', 'Beautiful!', 'Congrats!', 'Love this!', 'Amazing!', 'So good!', 'Well done!'];
const EMOJIS = ['😀', '😂', '🥰', '😍', '😎', '🤩', '😢', '😡', '👍', '👏', '🙏', '🔥', '❤️', '💯', '🎉', '✨', '🌸', '🍜', '🏔️', '📸', '🥳', '😴', '🤔', '😅', '😊', '🙌', '👌', '✌️', '💖', '😭', '🤣', '💪', '😇', '🥺', '😤', '🤯', '😋', '😘', '😜', '🤗'];
const PAGE = 4;

function CommentText({ text, replyToName }: { text: string; replyToName?: string }) {
  const nodes: ReactNode[] = [];
  let rest = text;
  if (replyToName && rest.startsWith(`@${replyToName}`)) {
    nodes.push(<span className="comment-mention" key="lead">@{replyToName}</span>);
    rest = rest.slice(replyToName.length + 1);
  }
  rest.split(/(@[\w]+)/g).forEach((part, i) => {
    if (part.startsWith('@')) nodes.push(<span className="comment-mention" key={i}>{part}</span>);
    else if (part) nodes.push(<span key={i}>{part}</span>);
  });
  return <>{nodes}</>;
}

export default function Comments({ postId, onClose, mediaIndex }: { postId: string; onClose?: () => void; mediaIndex?: number }) {
  const { db, me, addComment, deleteComment, react, myReaction, t } = useApp();
  const [text, setText] = useState('');
  const [sort, setSort] = useState('newest');
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [openThreads, setOpenThreads] = useState<Record<string, boolean>>({});
  const [threadLimit, setThreadLimit] = useState<Record<string, number>>({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const sheet = !!onClose;
  const isMedia = mediaIndex !== undefined;
  const targetType = isMedia ? 'media' as const : 'post' as const;
  const targetId = isMedia ? `${postId}#m${mediaIndex}` : postId;

  const allComments = db.comments.filter(c => c.pid === postId && c.status === 'live' && (isMedia ? c.mediaIndex === mediaIndex : c.mediaIndex === undefined));
  const topLevelComments = allComments.filter(c => !c.parentId).sort((a, b) => sort === 'newest' ? b.ts - a.ts : a.ts - b.ts);

  const postReactions = db.reactions.filter(r => r.targetType === targetType && r.targetId === targetId);
  const postKinds = REACTIONS.map(r => r.kind).filter(k => postReactions.some(r => r.kind === k));
  const quickKinds = postKinds.length ? postKinds : REACTIONS.map(r => r.kind);
  const myPostReaction = myReaction(targetType, targetId);

  const requestClose = () => {
    if (!sheet) { close.current?.(); return; }
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => close.current?.(), 210);
  };
  useBackClose(sheet, requestClose);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useEffect(() => {
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [sheet]);

  const appendToken = (token: string) => {
    setText(prev => (prev && !prev.endsWith(' ') ? `${prev} ${token}` : prev + token));
    inputRef.current?.focus();
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) { appendToken(emoji); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { el.focus(); const pos = start + emoji.length; el.setSelectionRange(pos, pos); });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !me) return;
    const parentId = replyingTo?.id;
    addComment({
      id: uid(),
      pid: postId,
      uid: me.id,
      text: text.trim(),
      ts: Date.now(),
      status: 'live',
      parentId,
      mediaIndex
    });
    if (parentId) {
      setOpenThreads(prev => ({ ...prev, [parentId]: true }));
      setThreadLimit(prev => ({ ...prev, [parentId]: Math.max(prev[parentId] || PAGE, PAGE) }));
    }
    setText('');
    setReplyingTo(null);
    setEmojiOpen(false);
    if (list.current) {
      if (parentId) {
        const row = list.current.querySelector(`[data-comment="${parentId}"]`);
        row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        list.current.scrollTop = sort === 'newest' ? 0 : list.current.scrollHeight;
      }
    }
    inputRef.current?.focus();
  };

  const handleReply = (comment: Comment, name: string, isReply: boolean) => {
    setReplyingTo({ id: isReply ? (comment.parentId || comment.id) : comment.id, name });
    setText(`@${name} `);
    if (!isReply) {
      setOpenThreads(prev => ({ ...prev, [comment.id]: true }));
      setThreadLimit(prev => ({ ...prev, [comment.id]: prev[comment.id] || PAGE }));
    }
    inputRef.current?.focus();
  };

  const getReplies = (commentId: string) =>
    allComments.filter(c => c.parentId === commentId).sort((a, b) => a.ts - b.ts);

  const renderComment = (comment: Comment, isReply = false) => {
    const author = db.users.find(u => u.id === comment.uid);
    if (!author) return null;
    const commentReactions = db.reactions.filter(r => r.targetType === 'comment' && r.targetId === comment.id);
    const kinds = REACTIONS.map(r => r.kind).filter(k => commentReactions.some(r => r.kind === k));
    const replies = isReply ? [] : getReplies(comment.id);
    const threadOpen = !!openThreads[comment.id];
    const limit = threadLimit[comment.id] || PAGE;
    const shownReplies = replies.slice(0, limit);
    const parent = isReply ? allComments.find(c => c.id === comment.parentId) : undefined;
    const replyToName = parent ? db.users.find(u => u.id === parent.uid)?.name : undefined;

    return (
      <div key={comment.id} data-comment={comment.id} className={`comments-row ${isReply ? 'reply' : ''}`}>
        <Avatar user={author} size={isReply ? 26 : 30} />
        <div className="comments-content">
          <div className="comment-bubble">
            <div><b>{author.name}</b>{author.verified && <VerifiedBadge size={13} />}</div>
            <p><CommentText text={comment.text} replyToName={replyToName} /></p>
            {kinds.length > 0 && (
              <span className="comment-bubble-reactions">
                {kinds.map(kind => <span key={kind} className="comment-reaction-badge" title={kind}><ReactionIcon kind={kind} /></span>)}
                <em>{commentReactions.length}</em>
              </span>
            )}
          </div>
          <div className="comment-meta">
            <time>{ago(comment.ts, db.lang)}</time>
            <ReactionButton targetType="comment" targetId={comment.id} small kinds={postKinds.length ? postKinds : undefined} />
            <button type="button" className="comment-action-btn" onClick={() => handleReply(comment, author.name, isReply)}>
              Reply
            </button>
            {me?.id === comment.uid && (
              <button type="button" className="delete-comment-btn" onClick={() => deleteComment(comment.id)}>
                Delete
              </button>
            )}
          </div>
          {replies.length > 0 && (
            <>
              <button
                type="button"
                className={`view-replies ${threadOpen ? 'open' : ''}`}
                aria-expanded={threadOpen}
                onClick={() => {
                  setOpenThreads(prev => ({ ...prev, [comment.id]: !threadOpen }));
                  if (!threadOpen) setThreadLimit(prev => ({ ...prev, [comment.id]: prev[comment.id] || PAGE }));
                }}
              >
                <span className="view-replies-line" />
                {threadOpen ? 'Hide replies' : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {threadOpen && (
                <div className="comment-replies">
                  {shownReplies.map(reply => renderComment(reply, true))}
                  {replies.length > limit && (
                    <button type="button" className="view-more-replies" onClick={() => setThreadLimit(prev => ({ ...prev, [comment.id]: limit + PAGE }))}>
                      View more replies ({replies.length - limit})
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  const content = (
    <div
      className={`${sheet ? 'comments-sheet' : 'comments-inline'} ${closing ? 'closing' : ''}`}
      ref={dialog}
      role={sheet ? 'dialog' : undefined}
      aria-modal={sheet || undefined}
      aria-label="Comments"
      tabIndex={sheet ? -1 : undefined}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          if (emojiOpen) { setEmojiOpen(false); return; }
          if (document.querySelector('.reaction-tray')) return;
          if (replyingTo) { setReplyingTo(null); setText(''); }
          else requestClose();
        }
        if (!sheet || e.key !== 'Tab') return;
        const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select');
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }}
    >
      {sheet && <div className="comments-grip" />}
      <div className="comments-heading">
        <div className="comments-reactions-row">
          {postKinds.length > 0 && (
            <span className="comment-reactions-display">
              {postKinds.map(kind => (
                <button
                  key={kind}
                  type="button"
                  className={`comment-reaction-icon ${myPostReaction === kind ? 'on' : ''}`}
                  title={t(kind)}
                  aria-label={t(kind)}
                  aria-pressed={myPostReaction === kind}
                  onClick={() => react(targetType, targetId, kind)}
                >
                  <ReactionIcon kind={kind} />
                </button>
              ))}
            </span>
          )}
          <span className="reactions-count">{postReactions.length > 0 ? postReactions.length : ''}</span>
        </div>
        {sheet && <button type="button" className="icon-btn" aria-label="Close comments" onClick={requestClose}>{IC.x}</button>}
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
        <form className="comments-compose" autoComplete="off" onSubmit={handleSubmit}>
          {sheet && (
            <div className="comments-suggestions" role="group" aria-label="Quick suggestions">
              {quickKinds.map(kind => (
                <button key={kind} type="button" className="suggest-emoji" aria-label={`Insert ${reactionMeta(kind).label} emoji`} onClick={() => insertEmoji(reactionMeta(kind).emoji)}>
                  <span>{reactionMeta(kind).emoji}</span>
                </button>
              ))}
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" className="suggest-chip" onClick={() => appendToken(s)}>{s}</button>
              ))}
            </div>
          )}
          {replyingTo && (
            <div className="reply-banner">
              <span>Replying to <b>{replyingTo.name}</b></span>
              <button type="button" aria-label="Cancel reply" onClick={() => { setReplyingTo(null); setText(''); }}>{IC.x}</button>
            </div>
          )}
          {emojiOpen && (
            <div className="emoji-picker" role="dialog" aria-label="Choose emoji">
              {EMOJIS.map(em => (
                <button key={em} type="button" aria-label={`Insert ${em}`} onClick={() => insertEmoji(em)}>{em}</button>
              ))}
            </div>
          )}
          <div className="compose-row">
            <Avatar user={me} size={30} />
            <input
              ref={inputRef}
              type="text"
              name="comment"
              autoComplete="off"
              autoCapitalize="sentences"
              autoCorrect="on"
              inputMode="text"
              enterKeyHint="send"
              aria-label="Write a comment"
              placeholder={replyingTo ? 'Write a reply…' : `Comment as ${me.name}`}
              maxLength={1000}
              value={text}
              onChange={e => setText(e.target.value)}
            />
            <button type="button" className="emoji-btn" aria-label="Emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(v => !v)}>{IC.smile}</button>
            <button type="submit" aria-label="Send comment" disabled={!text.trim()}>
              {IC.send}
            </button>
          </div>
        </form>
      ) : (
        <div className="comments-compose">
          <Link href="/login" onClick={closeLayerWithoutBack}>Sign in to comment</Link>
        </div>
      )}
    </div>
  );

  return sheet ? createPortal(
    <div className={`comments-overlay ${closing ? 'closing' : ''}`} onClick={e => { e.stopPropagation(); requestClose(); }}>{content}</div>,
    document.body
  ) : content;
}