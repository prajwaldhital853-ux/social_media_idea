'use client';

import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/utils';
import { Report } from '@/lib/types';
import { TranslationKey } from '@/lib/i18n';

const TYPE_KEY = { post: 'dpost', comment: 'dcomment', listing: 'dlisting', profile: 'dprofile' } as const;

export default function AdminReports() {
  const router = useRouter();
  const { db, t, setDb, showToast, logAudit, notify } = useApp();
  const lang = db.lang;
  const open = db.reports.filter(r => r.status === 'open').sort((a, b) => b.ts - a.ts);

  const targetInfo = (r: Report) => {
    if (r.type === 'post') {
      const p = db.posts.find(x => x.id === r.targetId);
      const author = p && db.users.find(u => u.id === p.uid);
      return {
        label: p ? `${t('postBy')} ${author?.name ?? '?'}: ${p.text.slice(0, 90) || t('photo')}` : r.targetId,
        href: p ? `/post/${p.id}` : null,
        status: p?.status
      };
    }
    if (r.type === 'comment') {
      const c = db.comments.find(x => x.id === r.targetId);
      const author = c && db.users.find(u => u.id === c.uid);
      return {
        label: c ? `${t('commentBy')} ${author?.name ?? '?'}: ${c.text.slice(0, 90)}` : r.targetId,
        href: c ? `/post/${c.pid}` : null,
        status: c?.status
      };
    }
    if (r.type === 'listing') {
      const l = db.listings.find(x => x.id === r.targetId);
      const seller = l && db.users.find(u => u.id === l.uid);
      return {
        label: l ? `${seller?.name ?? '?'}: ${l.title}` : r.targetId,
        href: null,
        status: l?.status
      };
    }
    const u = db.users.find(x => x.id === r.targetId);
    return { label: u ? `@${u.username}` : r.targetId, href: u ? `/u/${u.username}` : null, status: u?.susp ? 'suspended' : 'live' };
  };

  const dismiss = (r: Report) => {
    setDb(prev => ({ ...prev, reports: prev.reports.map(x => x.id === r.id ? { ...x, status: 'dismissed' as const } : x) }));
    logAudit('dismiss_report', r.id, `${r.type} ${r.targetId}`);
    showToast(t('savedOk'));
  };

  const remove = (r: Report) => {
    setDb(prev => {
      let next = { ...prev, reports: prev.reports.map(x => x.id === r.id ? { ...x, status: 'actioned' as const } : x) };
      if (r.type === 'post') {
        next = { ...next, posts: next.posts.map(p => p.id === r.targetId ? { ...p, status: 'removed' as const, removedReason: r.reason } : p) };
      } else if (r.type === 'comment') {
        next = { ...next, comments: next.comments.map(c => c.id === r.targetId ? { ...c, status: 'removed' as const } : c) };
      } else if (r.type === 'listing') {
        next = { ...next, listings: next.listings.map(l => l.id === r.targetId ? { ...l, status: 'removed' as const } : l) };
      } else {
        next = {
          ...next,
          users: next.users.map(u => u.id === r.targetId ? { ...u, susp: { until: Date.now() + 7 * 24 * 60 * 60 * 1000, reason: r.reason } } : u)
        };
      }
      return next;
    });
    const ownerUid =
      r.type === 'post' ? db.posts.find(p => p.id === r.targetId)?.uid :
      r.type === 'comment' ? db.comments.find(c => c.id === r.targetId)?.uid :
      r.type === 'listing' ? db.listings.find(l => l.id === r.targetId)?.uid :
      r.targetId;
    if (ownerUid) {
      notify(
        ownerUid,
        'warning',
        r.type === 'profile' ? t('suspNotice') : t('contentRemoved', { type: t(TYPE_KEY[r.type]), reason: t(r.reason as TranslationKey) }),
        '/notifications'
      );
    }
    logAudit('remove_content', `${r.type}:${r.targetId}`, t(r.reason as TranslationKey));
    showToast(t('deleted'));
  };

  if (open.length === 0) {
    return <div className="empty-state"><span className="empty-state-icon">{IC.shield}</span><h2>{t('noReports')}</h2></div>;
  }

  return (
    <div className="admin-list">
      {open.map(r => {
        const info = targetInfo(r);
        const reporter = db.users.find(u => u.id === r.by);
        const count = new Set(db.reports.filter(x => x.type === r.type && x.targetId === r.targetId && x.status === 'open').map(x => x.by)).size;
        return (
          <article key={r.id} className="admin-report">
            <div className="admin-report-chips">
              <span className="status-chip">{t(TYPE_KEY[r.type])}</span>
              <span className="status-chip rejected">{t(r.reason as TranslationKey)}</span>
              <span className="admin-report-count">{t('nReports', { n: count })}</span>
              <span className="admin-report-time">{ago(r.ts, lang)}</span>
            </div>
            <p className="admin-report-target">
              {info.label}
              {info.status === 'suspended' && <span className="status-chip ended">{t('suspended')}</span>}
              {info.status === 'hidden' && <span className="status-chip ended">{t('autoHidden')}</span>}
              {info.status === 'removed' && <span className="status-chip rejected">{t('deleted')}</span>}
            </p>
            {r.note && <p className="admin-report-note">“{r.note}”</p>}
            {reporter && (
              <p className="admin-report-by">
                <Avatar user={reporter} size={22}/>{reporter.name}
              </p>
            )}
            <div className="admin-report-actions">
              {info.href && (
                <button type="button" className="ghost-btn" onClick={() => router.push(info.href!)}>{IC.eye}{t('viewTarget')}</button>
              )}
              <button type="button" className="ghost-btn" onClick={() => dismiss(r)}>{IC.check}{t('dismiss')}</button>
              <button type="button" className="ghost-btn danger" onClick={() => remove(r)}>{IC.x}{t('remove')}</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}