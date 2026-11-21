'use client';

import Avatar from './Avatar';
import VerifiedBadge from './VerifiedBadge';
import { useApp } from '@/lib/AppContext';
import { ago } from '@/lib/utils';
import { Conversation } from '@/lib/useInbox';

interface ConversationRowProps {
  c: Conversation;
  active?: boolean;
  avatarSize?: number;
  onOpen: (username: string) => void;
}

/**
 * One inbox thread, used by the messages column and the top-bar popover, so the
 * unread badge and the "You:" preview are worded and counted the same way.
 */
export default function ConversationRow({ c, active, avatarSize = 52, onOpen }: ConversationRowProps) {
  const { db, me, t } = useApp();

  return (
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
        </span>
      </span>
      {c.unread > 0 && <span className="inbox-badge">{c.unread}</span>}
    </button>
  );
}
