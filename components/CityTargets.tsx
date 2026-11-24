'use client';

import { useState } from 'react';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';

const LIMIT = 12;

interface CityTargetsProps {
  cities: string[];
  onChange: (next: string[]) => void;
}

/**
 * The cities a campaign is aimed at. Naming any of them makes this a hard filter —
 * people outside the list are never shown the card — so a half-typed name must never
 * be stored as if it were an answer. Everything is committed on Enter or the Add
 * button, and the list stays visible so a payer can see what they actually locked in.
 */
export default function CityTargets({ cities, onChange }: CityTargetsProps) {
  const { t } = useApp();
  const [text, setText] = useState('');
  const full = cities.length >= LIMIT;

  const add = () => {
    const name = text.trim().replace(/,+$/, '').slice(0, 40);
    setText('');
    if (!name || full) return;
    if (cities.some(c => c.toLowerCase() === name.toLowerCase())) return;
    onChange([...cities, name]);
  };

  return (
    <div className="promote-cities">
      <div className="promote-city-add">
        <input
          type="text"
          value={text}
          maxLength={40}
          placeholder={t('cityAdd')}
          autoComplete="off"
          aria-label={t('cities')}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
            else if (e.key === 'Backspace' && !text && cities.length) onChange(cities.slice(0, -1));
          }}
        />
        <button type="button" className="wallet-button" onClick={add} disabled={!text.trim() || full}>
          {t('addCity')}
        </button>
      </div>
      {cities.length > 0 && (
        <ul className="promote-city-list">
          {cities.map(name => (
            <li key={name.toLowerCase()}>
              <span>{name}</span>
              <button
                type="button"
                aria-label={`${t('remove')} ${name}`}
                onClick={() => onChange(cities.filter(c => c !== name))}
              >
                {IC.x}
              </button>
            </li>
          ))}
        </ul>
      )}
      <small className="promote-city-note">{cities.length ? t('citiesOnly') : t('cityMax', { n: LIMIT })}</small>
    </div>
  );
}
