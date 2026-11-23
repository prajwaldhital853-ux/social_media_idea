'use client';

import Link from 'next/link';
import WalletShell from '@/components/WalletShell';
import { RequestRows } from '@/components/WalletLists';
import { useApp } from '@/lib/AppContext';

export default function WalletRequestsPage() {
  const { db, me, t } = useApp();
  const waiting = me
    ? db.coinRequests.filter(r => r.uid === me.id && r.status === 'pending').length
    : 0;

  return (
    <WalletShell>
      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('requests')}</h2>
          <Link href="/wallet/bank" className="wallet-sec-note">{t('addCoins')}</Link>
        </div>
        <p className="wallet-hint">
          {waiting > 0 ? `${waiting} · ` : ''}{t('bankHint')}
        </p>
        <RequestRows />
      </section>
    </WalletShell>
  );
}
