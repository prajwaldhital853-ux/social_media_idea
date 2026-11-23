'use client';

import WalletShell from '@/components/WalletShell';
import { LedgerRows } from '@/components/WalletLists';
import { useApp } from '@/lib/AppContext';

export default function WalletHistoryPage() {
  const { db, me, t } = useApp();
  const rows = me ? db.ledger.filter(l => l.uid === me.id) : [];
  const added = rows.filter(l => l.delta > 0).reduce((sum, l) => sum + l.delta, 0);
  const used = rows.filter(l => l.delta < 0).reduce((sum, l) => sum - l.delta, 0);

  return (
    <WalletShell>
      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('history')}</h2>
          <span className="wallet-sec-note">{t('coinRate', { n: db.settings.coinPrice })}</span>
        </div>
        <div className="wallet-figures">
          <div><b className="in">+{added.toLocaleString('en-US')}</b><span>{t('coins')}</span></div>
          <div><b className="out">−{used.toLocaleString('en-US')}</b><span>{t('spent')}</span></div>
          <div><b>{me?.coins ?? 0}</b><span>{t('balance')}</span></div>
        </div>
        <LedgerRows />
      </section>
    </WalletShell>
  );
}
