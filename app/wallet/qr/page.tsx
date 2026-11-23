'use client';

import CoinRequestForm from '@/components/CoinRequestForm';
import WalletShell from '@/components/WalletShell';
import { useApp } from '@/lib/AppContext';

export default function WalletQrPage() {
  const { t } = useApp();
  return (
    <WalletShell>
      <section className="wallet-sec">
        <div className="wallet-sec-head">
          <h2>{t('qrPay')}</h2>
          <span className="wallet-sec-note">{t('chooseMethod')}</span>
        </div>
        <p className="wallet-hint">{t('payQrSub')}</p>
        <CoinRequestForm method="qr" />
      </section>
    </WalletShell>
  );
}
