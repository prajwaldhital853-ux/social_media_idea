'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import { COUNTRIES, POST_TOPICS } from '@/lib/utils';
import { IC } from '@/lib/icons';
import { Promotion } from '@/lib/types';

interface PromotionEditorProps {
  promo: Promotion;
  onClose: () => void;
}

/**
 * The audience of a campaign that is already bought. The package and the coin
 * figure are read-only: that money left the wallet when the request was made.
 */
export default function PromotionEditor({ promo, onClose }: PromotionEditorProps) {
  const { db, t, updatePromotion } = useApp();
  const [category, setCategory] = useState(promo.category || (promo.targetType === 'listing' ? db.settings.categories[0] : POST_TOPICS[0]));
  const [ageMin, setAgeMin] = useState(promo.ageMin);
  const [ageMax, setAgeMax] = useState(promo.ageMax);
  const [country, setCountry] = useState(promo.country || 'Nepal');
  const [city, setCity] = useState(promo.city || '');
  const [allLoc, setAllLoc] = useState(!promo.country && !promo.city);
  const [error, setError] = useState('');
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ageMin > ageMax) { setError(t('e_age_range')); return; }
    setBusy(true);
    const ok = await updatePromotion(promo.id, {
      category, ageMin, ageMax,
      country: allLoc ? '' : country,
      city: allLoc ? '' : city.trim(),
    });
    setBusy(false);
    if (ok) onClose();
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
            <span>{t('package')}: <b>{pack?.name || promo.packageId || '—'}</b></span>
            <span>{t('spent')}: <b>{promo.coins}</b> {t('coins')}</span>
            <small>{t('coinsSpentFrozen')}</small>
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
                <input type="number" min={13} max={99} value={ageMin} onChange={e => setAgeMin(Math.max(13, Math.min(99, Number(e.target.value) || 13)))} />
              </label>
              <label>
                {t('ageMax')}
                <input type="number" min={13} max={99} value={ageMax} onChange={e => setAgeMax(Math.max(13, Math.min(99, Number(e.target.value) || 99)))} />
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
              <div className="promote-ages">
                <label>
                  {t('country')}
                  <select value={country} onChange={e => setCountry(e.target.value)}>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>
                  {t('city')} ({t('optional')})
                  <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder={t('city')} />
                </label>
              </div>
            )}
          </div>

          {error && <p className="form-error" role="alert">{error}</p>}
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
