'use client';

import { useApp } from '@/lib/AppContext';
import { I18N } from '@/lib/i18n';
import Wordmark from './Wordmark';
import { IC } from '@/lib/icons';

export default function TopBar() {
  const { db, me, logout, updateLang } = useApp();
  const t = (key: keyof typeof I18N.en) => I18N[db.lang][key] || I18N.en[key];

  return (
    <header className="topbar">
      <Wordmark />
      <div className="right">
        <button className="lnk" onClick={() => updateLang(db.lang === 'en' ? 'ne' : 'en')}>
          {t('langName')}
        </button>
        {me ? (
          <button className="lnk" onClick={logout}>
            {t('logout')}
          </button>
        ) : (
          <a href="/login" className="btn gold" style={{ padding: '7px 16px' }}>
            {t('login')}
          </a>
        )}
      </div>
    </header>
  );
}
