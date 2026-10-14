'use client';

import { useApp } from '@/lib/AppContext';
import { I18N } from '@/lib/i18n';
import Wordmark from './Wordmark';
import Avatar from './Avatar';
import { IC } from '@/lib/icons';

interface SideRailProps {
  currentRoute: string;
}

export default function SideRail({ currentRoute }: SideRailProps) {
  const { db, me, isAdmin, logout, updateLang } = useApp();
  const t = (key: keyof typeof I18N.en) => I18N[db.lang][key] || I18N.en[key];

  return (
    <aside className="rail">
      <Wordmark />
      <nav className="nav" aria-label="Main">
        <a href="/" className={currentRoute === 'feed' ? 'on' : ''}>
          {t('home')}
        </a>
        {isAdmin() && (
          <a href="/admin" className={currentRoute === 'admin' ? 'on' : ''}>
            {t('admin')}
          </a>
        )}
      </nav>
      <button className="btn gold railpost">{t('post')}</button>
      <div className="grow" />
      <button className="lnk lang" onClick={() => updateLang(db.lang === 'en' ? 'ne' : 'en')}>
        {t('langName')}
      </button>
      {me ? (
        <>
          <div className="me">
            <Avatar user={me} size={40} />
            <div>
              <b>{me.name || me.username}</b>
              <span>@{me.username}</span>
            </div>
          </div>
          <button className="lnk lang" onClick={logout}>
            {t('logout')}
          </button>
        </>
      ) : (
        <a href="/login" className="btn ghost">
          {t('login')}
        </a>
      )}
    </aside>
  );
}
