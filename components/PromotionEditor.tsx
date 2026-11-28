'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { COUNTRIES, POST_TOPICS } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { Promotion } from '@/lib/types';
import CityTargets from './CityTargets';

interface PromotionEditorProps {
  promo: Promotion;
  onClose: () => void;
}

const ageOf = (text: string, fallback: number) => Math.max(13, Math.min(100, Math.round(Number(text) || fallback)));

/**
 * The audience of a campaign the payer still holds. The package and the coin figure
 * are read-only: on an approved run that money has left the wallet, and on one still
 * waiting for a seat the desk is reading the price it was asked to approve.
 */
export default function PromotionEditor({ promo, onClose }: PromotionEditorProps) {
  const { db, t, updatePromotion, showConfirm } = useApp();
  const [category, setCategory] = useState(promo.category || (promo.targetType === 'listing' ? db.settings.categories[0] : POST_TOPICS[0]));
  const [ageMin, setAgeMin] = useState(String(promo.ageMin));
  const [ageMax, setAgeMax] = useState(String(promo.ageMax));
  const [country, setCountry] = useState(promo.country || 'Nepal');
  const [cities, setCities] = useState<string[]>(promo.cities || []);
  const [allLoc, setAllLoc] = useState(!promo.country && !(promo.cities || []).length);
  const [busy, setBusy] = useState(false);

  useBackClose(true, onClose);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const had = document.body.classList.contains('noscroll');
    document.body.classList.add('noscroll');
    return () => { if (!had) document.body.classList.remove('noscroll'); };
  }, []);

  if (typeof document === 'undefined') return null;

  const pack = db.settings.packages.find(p => p.id === promo.packageId);
  const settleAges = () => {
    let lo = ageOf(ageMin, 18);
    let hi = ageOf(ageMax, 40);
    if (lo > hi) [lo, hi] = [hi, lo];
    setAgeMin(String(lo));
    setAgeMax(String(hi));
  };

  const send = async (lo: number, hi: number) => {
    setBusy(true);
    const ok = await updatePromotion(promo.id, {
      category, ageMin: lo, ageMax: hi,
      country: allLoc ? '' : country,
      cities: allLoc ? [] : cities,
    });
    setBusy(false);
    if (ok) onClose();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const lo = ageOf(ageMin, 18);
    const hi = Math.max(ageOf(ageMax, 40), lo);
    setAgeMin(String(lo));
    setAgeMax(String(hi));
    showConfirm(t('saveAudienceConfirm'), () => void send(lo, hi));
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content promo-edit" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('editTargeting')}>
        <div className="modal-header">
          <b>{t('editTargeting')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <form className="promote-form" onSubmit={submit}>
          <div className="promo-edit-frozen">
            <span>{t('package')}: <b>{pack?.name || promo.packageId || '-'}</b></span>
            {promo.status === 'pending' ? (
              <>
                <span className="wallet-status pending">{t('awaitingApproval')}</span>
                <span>{t('costsCoins', { n: promo.budget ?? promo.coins })}</span>
              </>
            ) : (
              <span>{t('spent')}: <b>{promo.coins}</b> {t('coins')}</span>
            )}
            <small>{promo.status === 'pending' ? t('chargedOnApproval') : t('coinsSpentFrozen')}</small>
          </div>

          <label className="promote-field">
            <span>{t('category')}</span>
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {(promo.targetType === 'listing' ? db.settings.categories : POST_TOPICS).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <div className="promote-field">
            <span>{t('targetAge')}</span>
            <div className="promote-ages">
              <label>
                {t('ageMin')}
                <input type="text" inputMode="numeric" value={ageMin} onChange={e => setAgeMin(e.target.value.replace(/[^0-9]/g, ''))} onBlur={settleAges} />
              </label>
              <label>
                {t('ageMax')}
                <input type="text" inputMode="numeric" value={ageMax} onChange={e => setAgeMax(e.target.value.replace(/[^0-9]/g, ''))} onBlur={settleAges} />
              </label>
            </div>
          </div>

          <div className="promote-field">
            <span>{t('targetLocation')}</span>
            <label className="promote-check">
              <input type="checkbox" checked={allLoc} onChange={e => setAllLoc(e.target.checked)} />
              {t('allLocations')}
            </label>
            {!allLoc && (
              <>
                <div className="promote-ages">
                  <label>
                    {t('country')}
                    <select value={country} onChange={e => setCountry(e.target.value)}>
                      {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                </div>
                <span className="promote-sublabel">{t('cities')}</span>
                <CityTargets cities={cities} onChange={setCities} />
              </>
            )}
          </div>

          <div className="promo-edit-actions">
            <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>{t('cancel')}</button>
            <button type="submit" className="promote-submit" disabled={busy}>{t('save')}</button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
