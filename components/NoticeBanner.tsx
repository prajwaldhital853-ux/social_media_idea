'use client';

import Link from 'next/link';
import { useApp } from '@/lib/AppContext';
import { Notice } from '@/lib/types';

export default function NoticeBanner({ notices, full = false }: { notices?: Notice[]; full?: boolean }) {
  const { t } = useApp();
  if (!notices || notices.length === 0) return null;
  return (
    <div className="notice-banner" role="status">
      {notices.map(notice => (
        <div key={notice.id} className="notice-line">
          <p className="notice-copy">
            <span className="notice-text">{notice.text}</span>
            {full && notice.reason && <span className="notice-reason">{notice.reason}</span>}
            {full && notice.by && <span className="notice-by">@{notice.by}</span>}
          </p>
          {notice.private && (
            <Link href={notice.notificationId ? `/notifications/${notice.notificationId}` : '/notifications'}>
              {t('visitInbox')}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
