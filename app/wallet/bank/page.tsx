'use client';

import CoinRequestForm from '@/components/CoinRequestForm';
import WalletShell from '@/components/WalletShell';
import { useApp } from '@/lib/AppContext';

export default function WalletBankPage() {
  const { t } = useApp();
  return (
    <WalletShell>
      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('bankTransfer')}</h2>
          <span className="wallet-sec-note">{t('chooseMethod')}</span>
        </div>
        <p className="wallet-hint">{t('payBankSub')}</p>
        <CoinRequestForm method="bank" />
      </section>
    </WalletShell>
  );
}
