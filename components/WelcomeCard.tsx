'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/lib/AppContext';

/** The card is a first-load thing, so the browser remembers it read it. */
const SEEN = 'exposing-welcomed';

/**
 * The wording the console's desk writes, shown the first time this browser opens the site
 * *signed in* — it is a welcome to the account, so the signin and signup screens stay clean
 * and the card only comes up once somebody is actually in.
 *
 * Nothing on the desk means no card: an empty box is not a welcome.
 */
export default function WelcomeCard() {
  const { db, me, ready } = useApp();
  const [open, setOpen] = useState(false);
  const wording = db.settings.wording;

  useEffect(() => {
    if (!ready || !me) return;
    if (!((wording?.message || '').trim() || (wording?.tagline || '').trim())) return;
    try {
      if (localStorage.getItem(SEEN)) return;
    } catch { /* a blocked store only means the card is shown again */ }
    setOpen(true);
  }, [ready, me, wording]);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN, '1');
    } catch { /* nothing to remember it with */ }
  };

  if (!open || !wording) return null;
  const contacts = wording.contact || [];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Exposing" onClick={close}>
      <div className="modal-content welcome-card" onClick={event => event.stopPropagation()}>
        <div className="welcome-body">
          <img src="/exposing-icon.png" alt="" className="welcome-mark" />
          {wording.message && <p className="welcome-message">{wording.message}</p>}
          {wording.tagline && <p className="welcome-tagline">{wording.tagline}</p>}
          {contacts.length > 0 && (
            <ul className="welcome-contact">
              {contacts.map(item => (
                <li key={item.label}>
                  <span>{item.label}</span>
                  <Contact item={item}/>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="button" className="welcome-go" onClick={close}>Got it</button>
      </div>
    </div>
  );
}

/** A line the seat typed as free text, opened the way the value actually reads. */
function Contact({ item }: { item: { label: string; value: string } }) {
  const value = (item.value || '').trim();
  if (!value) return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) {
    return <a href={value} target="_blank" rel="noreferrer">{value.replace(/^(https?:|mailto:|tel:|\/\/)/i, '')}</a>;
  }
  if (item.label === 'Email') return <a href={`mailto:${value}`}>{value}</a>;
  if (item.label === 'Phone') return <a href={`tel:${value.replace(/[^+\d]/g, '')}`}>{value}</a>;
  return <span>{value}</span>;
}
