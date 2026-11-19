'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApp, PromoConfig } from '@/lib/AppContext';
import { COUNTRIES, POST_TOPICS } from '@/lib/utils';
import { IC } from '@/lib/icons';

interface PromoteFormProps {
  targetType: 'post' | 'listing';
  defaultCategory?: string;
  confirmLabel: string;
  onConfirm: (cfg: PromoConfig) => void;
}

export default function PromoteForm({ targetType, defaultCategory, confirmLabel, onConfirm }: PromoteFormProps) {
  const { db, me, t } = useApp();
  const packages = db.settings.packages;
  const categories = targetType === 'listing' ? db.settings.categories : POST_TOPICS;

  const [packageId, setPackageId] = useState(packages[0]?.id || '');
  const [category, setCategory] = useState(defaultCategory || categories[0]);
  const [allAges, setAllAges] = useState(false);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(40);
  const [allLoc, setAllLoc] = useState(false);
  const [country, setCountry] = useState(me?.country || 'Nepal');
  const [city, setCity] = useState('');

  const pk = packages.find(p => p.id === packageId);
  const cost = pk?.coins || 0;
  const balance = me?.coins || 0;
  const enough = balance >= cost;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pk || !enough) return;
    onConfirm({
      packageId,
      category,
      ageMin: allAges ? 13 : ageMin,
      ageMax: allAges ? 99 : ageMax,
      country: allLoc ? '' : country,
      city: allLoc ? '' : city.trim()
    });
  };

  return (
    <form className="promote-form" onSubmit={submit}>
      <div className="promote-label">{t('package')}</div>
      <div className="promote-packages">
        {packages.map(p => (
          <button
            key={p.id}
            type="button"
            className={`promote-package ${packageId === p.id ? 'on' : ''}`}
            onClick={() => setPackageId(p.id)}
          >
            <b>{p.name}</b>
            <span>{p.days} days · {p.reach}</span>
            <span className="promote-cost">{IC.coin}{p.coins}</span>
          </button>
        ))}
      </div>

      <label className="promote-field">
        <span>{t('category')}</span>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>

      <div className="promote-field">
        <span>{t('targetAge')}</span>
        <label className="promote-check">
          <input type="checkbox" checked={allAges} onChange={e => setAllAges(e.target.checked)} />
          {t('allAges')}
        </label>
        {!allAges && (
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
        )}
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

      <div className="promote-summary">
        <span className="promote-total">{IC.coin}{cost} {t('coins')}</span>
        <span className="promote-balance">{t('balance')}: {balance}</span>
      </div>
      {!enough && (
        <p className="promote-warn">
          {t('notEnoughCoins')} <Link href="/wallet">{t('buyCoins')}</Link>
        </p>
      )}

      <button type="submit" className="promote-submit" disabled={!enough || !pk}>
        {confirmLabel}
      </button>
    </form>
  );
}