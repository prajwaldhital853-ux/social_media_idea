'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApp, PromoConfig } from '@/lib/AppContext';
import { COUNTRIES, POST_TOPICS } from '@/lib/utils';
import { IC } from '@/lib/icons';
import CityTargets from './CityTargets';

interface PromoteFormProps {
  targetType: 'post' | 'listing';
  defaultCategory?: string;
  confirmLabel: string;
  onConfirm: (cfg: PromoConfig) => void;
}

/** The two boxes are ages, so they are only ever judged as a pair. */
const ageOf = (text: string, fallback: number) => Math.max(13, Math.min(100, Math.round(Number(text) || fallback)));

export default function PromoteForm({ targetType, defaultCategory, confirmLabel, onConfirm }: PromoteFormProps) {
  const { db, me, t } = useApp();
  const packages = db.settings.packages;
  const categories = targetType === 'listing' ? db.settings.categories : POST_TOPICS;

  const [packageId, setPackageId] = useState(packages[0]?.id || '');
  const [category, setCategory] = useState(defaultCategory || categories[0]);
  const [allAges, setAllAges] = useState(false);
  // The numbers are kept as typed text: clamping on every keystroke turned "40" into
  // "4" and then into the floor, so the box the payer was writing in fought them.
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('40');
  const [allLoc, setAllLoc] = useState(false);
  const [country, setCountry] = useState(me?.country || 'Nepal');
  const [cities, setCities] = useState<string[]>([]);

  const pk = packages.find(p => p.id === packageId);
  const cost = pk?.coins || 0;
  const balance = me?.coins || 0;
  const enough = balance >= cost;

  // Settled on blur, and low/high swap rather than vanish: a payer who types 40 into
  // the bottom box means 40, they do not mean 13.
  const settleAges = () => {
    let lo = ageOf(ageMin, 18);
    let hi = ageOf(ageMax, 40);
    if (lo > hi) [lo, hi] = [hi, lo];
    setAgeMin(String(lo));
    setAgeMax(String(hi));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pk || !enough) return;
    const lo = allAges ? 13 : ageOf(ageMin, 18);
    const hi = Math.max(allAges ? 99 : ageOf(ageMax, 40), lo);
    onConfirm({
      packageId,
      category,
      ageMin: lo,
      ageMax: hi,
      country: allLoc ? '' : country,
      cities: allLoc ? [] : cities,
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
              <input type="text" inputMode="numeric" value={ageMin} onChange={e => setAgeMin(e.target.value.replace(/[^0-9]/g, ''))} onBlur={settleAges} />
            </label>
            <label>
              {t('ageMax')}
              <input type="text" inputMode="numeric" value={ageMax} onChange={e => setAgeMax(e.target.value.replace(/[^0-9]/g, ''))} onBlur={settleAges} />
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

      <div className="promote-summary">
        <span className="promote-total">{IC.coin}{cost} {t('coins')}</span>
        <span className="promote-balance">{t('balance')}: {balance}</span>
      </div>
      <p className="promote-charge-note">{t('chargedOnApproval')}</p>
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
