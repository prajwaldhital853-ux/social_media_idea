'use client';

import { useState } from 'react';
import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { ago } from '@/lib/utils';
import { Conversation } from '@/lib/useInbox';
import { IC } from '@/lib/icons';

interface ConversationRowProps {
  c: Conversation;
  active?: boolean;
  avatarSize?: number;
  onOpen: (username: string) => void;
}

/**
 * One inbox thread, used by the messages column and the top-bar popover, so the
 * unread badge and the "You:" preview are worded and counted the same way. The
 * ⋮ beside the row holds the thread's own action — delete — which is why it is
 * a sibling of the row button, not a child of it.
 */
export default function ConversationRow({ c, active, avatarSize = 52, onOpen }: ConversationRowProps) {
  const { db, me, t, deleteConversation, showToast } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);
  const last = c.last;
  const receipt = last && last.from === me?.id ? last.status || (last.read ? 'read' : 'delivered') : null;

  return (
    <div className={`inbox-row-wrap ${active ? 'active' : ''}`}>
      <button
        type="button"
        className={`inbox-row ${c.unread ? 'unread' : ''} ${active ? 'active' : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onOpen(c.other.username)}
      >
        <Avatar user={c.other} size={avatarSize} />
        <span className="inbox-row-main">
          <span className="inbox-row-top">
            <b>{c.other.name}{c.other.verified && <VerifiedBadge />}</b>
            {c.last && <span className="inbox-row-time">{ago(c.last.ts, db.lang)}</span>}
          </span>
          <span className={`inbox-row-preview ${c.last ? '' : 'hint'}`}>
            {c.last ? `${c.last.from === me?.id ? `${t('you')}: ` : ''}${c.last.text}` : t('mutualHint')}
            {receipt && <span className={`chat-receipt ${receipt}`}>{receipt === 'sent' ? '✓' : '✓✓'}</span>}
          </span>
        </span>
        {c.unread > 0 && <span className="inbox-badge">{c.unread}</span>}
      </button>
      {me && !c.suggested && (
        <div className="inbox-row-menu-wrap">
          <button
            type="button"
            className="icon-btn inbox-row-menu-btn"
            aria-label={t('delChat')}
            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
          >
            {IC.dots}
          </button>
          {menuOpen && (
            <div className="post-menu inbox-row-menu" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                className="post-menu-item danger"
                onClick={e => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  void deleteConversation(c.other.id).then(ok => { if (ok) showToast(t('chatDeleted')); });
                }}
              >
                {t('delChat')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
