'use client';

import { useApp } from '@/lib/AppContext';
import { Notice } from '@/lib/types';
import { ago } from '@/lib/utils';
import { IC } from '@/lib/icons';

/**
 * The sentence a seat put over this content.
 *
 * It reads above the thing it is about, not under it: the point of a public
 * notice is that a person sees it before they share what it warns about. The
 * reason stays with the audit record and is only printed where there is room.
 */
export default function NoticeBanner({ notices, full = false }: { notices?: Notice[]; full?: boolean }) {
  const { db } = useApp();
  if (!notices || notices.length === 0) return null;
  return (
    <div className="notice-banner" role="status">
      {notices.map(notice => (
        <p key={notice.id} className="notice-line">
          <span className="notice-mark">{IC.shield}</span>
          <span className="notice-body">
            <b>{notice.text}</b>
            {full && notice.reason && <em>{notice.reason}</em>}
            {full && (
              <span className="notice-by">
                Exposing staff{notice.by ? ` · @${notice.by}` : ''}
                {notice.ts ? ` · ${ago(notice.ts, db.lang)}` : ''}
              </span>
            )}
          </span>
        </p>
      ))}
    </div>
  );
}
