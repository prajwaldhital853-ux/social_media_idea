'use client';

import { useEffect, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import { ago, uid, REACTIONS, reactionMeta } from '@/lib/utils';
import { Comment, ReactionKind } from '@/lib/types';
import { IC } from '@/lib/icons';
import { commentsFragment, loadList, loadMoreList, pushListRow, useList } from '@/lib/lists';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';
import { useWindowed } from '@/lib/useWindowed';
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
  const { db, me, addComment, deleteComment, react, myReaction, reactionCount, t, serverMode, showToast } = useApp();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
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
  // Demo mode has no server flag, so the cached post answers who owns it.
  const postAuthorId = db.posts.find(p => p.id === postId)?.uid;

  // Top-level comments are a keyset page of their own; replies live under their
  // parent so one long thread cannot push the rest of the stream off the screen.
  const streamQuery = {
    post: postId,
    top: 1,
    media_index: isMedia ? mediaIndex : undefined,
    order: sort === 'oldest' ? 'oldest' : undefined,
  };
  const stream = useList(
    `comments:${targetId}`,
    { path: '/comments/', frag: commentsFragment(me?.id || null) },
    streamQuery,
    serverMode && !!postId,
  );
  const replyDef = { path: '/comments/', frag: commentsFragment(me?.id || null) };

  const allComments = db.comments.filter(c => c.pid === postId && c.status === 'live' && (isMedia ? c.mediaIndex === mediaIndex : c.mediaIndex === undefined));
  const byId = new Map(allComments.map(c => [c.id, c] as [string, Comment]));
  // The server's rows in the server's order; replies join them from the cache
  // once their own thread has been opened.
  const fromServer = stream.ids.map(id => byId.get(id)).filter((c): c is Comment => !!c);
  const topLevelComments = serverMode
    ? fromServer
    : allComments.filter(c => !c.parentId).sort((a, b) => sort === 'newest' ? b.ts - a.ts : a.ts - b.ts);
  const { limit: commentLimit, pending: commentsPending, sentinel: commentsSentinel, hasMore: moreComments } = useWindowed(
    topLevelComments.length, 10, `${postId}|${mediaIndex}|${sort}`,
    serverMode ? {
      hasMore: stream.hasMore, loading: stream.loading, load: stream.loadMore,
      loaded: stream.loaded, error: stream.error, retry: stream.reload,
    } : undefined,
  );

  const postReactions = serverMode
    ? []
    : db.reactions.filter(r => r.targetType === targetType && r.targetId === targetId);
  const reactionsShown = serverMode ? reactionCount(targetType, targetId) : postReactions.length;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || !me || sending) return;
    const parentId = replyingTo?.id;
    setSending(true);
    let saved: Comment;
    try {
      saved = await addComment({
        id: uid(),
        pid: postId,
        uid: me.id,
        text: text.trim(),
        ts: Date.now(),
        status: 'live',
        parentId,
        mediaIndex
      });
    } catch (err: any) {
      // Keep the draft in the box; a rejected comment must not silently vanish.
      showToast(err?.message || 'Could not send your comment.');
      setSending(false);
      return;
    }
    setSending(false);
    if (serverMode) {
      if (parentId) pushListRow(`replies:${parentId}`, { parent: parentId }, saved.id);
      else pushListRow(`comments:${targetId}`, streamQuery, saved.id);
    }
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

  /** How many replies the server says a comment has — cached rows are only some of them. */
  const replyTotal = (comment: Comment) =>
    serverMode ? Math.max(comment.replies ?? 0, getReplies(comment.id).length) : getReplies(comment.id).length;

  const showThread = (commentId: string, open: boolean) => {
    setOpenThreads(prev => ({ ...prev, [commentId]: open }));
    if (!open) return;
    setThreadLimit(prev => ({ ...prev, [commentId]: prev[commentId] || PAGE }));
    if (serverMode) void loadList(`replies:${commentId}`, replyDef, { parent: commentId });
  };

  const moreThread = (commentId: string) => {
    if (serverMode) {
      void loadMoreList(`replies:${commentId}`, replyDef, { parent: commentId });
      setThreadLimit(prev => ({ ...prev, [commentId]: (prev[commentId] || PAGE) + PAGE }));
      return;
    }
    setThreadLimit(prev => ({ ...prev, [commentId]: (prev[commentId] || PAGE) + PAGE }));
  };

  const renderComment = (comment: Comment, isReply = false) => {
    const author = db.users.find(u => u.id === comment.uid);
    if (!author) return null;
    const commentReactions = db.reactions.filter(r => r.targetType === 'comment' && r.targetId === comment.id);
    const kinds = REACTIONS.map(r => r.kind).filter(k => commentReactions.some(r => r.kind === k));
    const replies = isReply ? [] : getReplies(comment.id);
    const replyCount = isReply ? 0 : replyTotal(comment);
    const threadOpen = !!openThreads[comment.id];
    const limit = threadLimit[comment.id] || PAGE;
    const shownReplies = replies.slice(0, limit);
    const parent = isReply ? allComments.find(c => c.id === comment.parentId) : undefined;
    const replyToName = parent ? db.users.find(u => u.id === parent.uid)?.name : undefined;
    // A reply inherits the flag: an author answering under their own post is
    // still the author, and the server already worked that out per row.
    const isAuthor = comment.isPostAuthor ?? (postAuthorId !== undefined ? comment.uid === postAuthorId : false);

    return (
      <div key={comment.id} data-comment={comment.id} className={`comments-row ${isReply ? 'reply' : ''}`}>
        <Avatar user={author} size={isReply ? 26 : 30} />
        <div className="comments-content">
          <div className="comment-bubble">
            <div><b>{author.name}</b>{author.verified && <VerifiedBadge size={13} />}{isAuthor && <span className="comment-author-badge">{t('author')}</span>}</div>
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
            <button type="button" className="comment-action-btn" onPointerDown={e => e.preventDefault()} onClick={() => handleReply(comment, author.name, isReply)}>
              Reply
            </button>
            {me?.id === comment.uid && (
              <button type="button" className="delete-comment-btn" onClick={() => deleteComment(comment.id)}>
                Delete
              </button>
            )}
          </div>
          {replyCount > 0 && (
            <>
              <button
                type="button"
                className={`view-replies ${threadOpen ? 'open' : ''}`}
                aria-expanded={threadOpen}
                onPointerDown={e => e.preventDefault()}
                onClick={() => showThread(comment.id, !threadOpen)}
              >
                <span className="view-replies-line" />
                {threadOpen ? 'Hide replies' : `View ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {threadOpen && (
                <div className="comment-replies">
                  {shownReplies.map(reply => renderComment(reply, true))}
                  {replyCount > shownReplies.length && (
                    <button type="button" className="view-more-replies" onPointerDown={e => e.preventDefault()} onClick={() => moreThread(comment.id)}>
                      View more replies ({Math.max(0, replyCount - shownReplies.length)})
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
          if (document.querySelector('.reaction-tray')) return;
          e.stopPropagation();
          if (emojiOpen) { setEmojiOpen(false); return; }
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
                  onPointerDown={e => e.preventDefault()}
                  onClick={() => react(targetType, targetId, kind)}
                >
                  <ReactionIcon kind={kind} />
                </button>
              ))}
            </span>
          )}
          <span className="reactions-count">{reactionsShown > 0 ? reactionsShown : ''}</span>
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
        <span>{serverMode && !isMedia ? (db.posts.find(p => p.id === postId)?.comments ?? allComments.length) : allComments.length}</span>
      </div>
      <div className="comments-list" ref={list}>
        {serverMode && stream.error ? (
          <div className="comments-empty">
            <h2>{t('listFailed')}</h2>
            <button type="button" className="ghost-btn" onClick={() => void stream.reload()}>{t('retry')}</button>
          </div>
        ) : !topLevelComments.length && serverMode && !stream.loaded ? (
          <div aria-hidden="true">
            {[0, 1, 2].map(i => (
              <div className="comment-skeleton" key={i}>
                <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
              </div>
            ))}
          </div>
        ) : (!topLevelComments.length && (!serverMode || stream.loaded)) ? (
          <div className="comments-empty">{IC.msg}<h2>No comments yet</h2><p>Be the first to comment.</p></div>
        ) : null}
        {topLevelComments.slice(0, commentLimit).map(c => renderComment(c))}
        {commentsPending && moreComments && (
          <div className="comment-skeleton" aria-hidden="true">
            <span className="sk-avatar" /><span className="sk-lines"><i /><i /></span>
          </div>
        )}
        {moreComments && <div ref={commentsSentinel} className="feed-sentinel" aria-hidden="true" />}
      </div>
      {me ? (
        <form className="comments-compose" autoComplete="off" onSubmit={handleSubmit}>
          {sheet && (
            <div className="comments-suggestions" role="group" aria-label="Quick suggestions">
              {quickKinds.map(kind => (
                <button key={kind} type="button" className="suggest-emoji" aria-label={`Insert ${reactionMeta(kind).label} emoji`} onPointerDown={e => e.preventDefault()} onClick={() => insertEmoji(reactionMeta(kind).emoji)}>
                  <span>{reactionMeta(kind).emoji}</span>
                </button>
              ))}
              {SUGGESTIONS.map(s => (
                <button key={s} type="button" className="suggest-chip" onPointerDown={e => e.preventDefault()} onClick={() => appendToken(s)}>{s}</button>
              ))}
            </div>
          )}
          {replyingTo && (
            <div className="reply-banner">
              <span>Replying to <b>{replyingTo.name}</b></span>
              <button type="button" aria-label="Cancel reply" onPointerDown={e => e.preventDefault()} onClick={() => { setReplyingTo(null); setText(''); inputRef.current?.focus(); }}>{IC.x}</button>
            </div>
          )}
          {emojiOpen && (
            <div className="emoji-picker" role="dialog" aria-label="Choose emoji">
              {EMOJIS.map(em => (
                <button key={em} type="button" aria-label={`Insert ${em}`} onPointerDown={e => e.preventDefault()} onClick={() => insertEmoji(em)}>{em}</button>
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
            <button type="button" className="emoji-btn" aria-label="Emoji" aria-expanded={emojiOpen} onPointerDown={e => e.preventDefault()} onClick={() => { setEmojiOpen(v => !v); inputRef.current?.focus(); }}>{IC.smile}</button>
            <button type="submit" aria-label="Send comment" disabled={!text.trim() || sending} onPointerDown={e => e.preventDefault()}>
              {IC.send}
            </button>
          </div>
        </form>
      ) : (
        <div className="comments-compose">
          {/* Not onClick={closeLayerWithoutBack}: the click event would arrive as
              the layer count, and the counter would stop being a number. */}
          <Link href="/login" onClick={() => closeLayerWithoutBack()}>Sign in to comment</Link>
        </div>
      )}
    </div>
  );

  return sheet ? createPortal(
    <div className={`comments-overlay ${closing ? 'closing' : ''}`} onClick={e => { e.stopPropagation(); requestClose(); }}>{content}</div>,
    document.body
  ) : content;
}