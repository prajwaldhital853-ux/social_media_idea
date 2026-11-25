'use client';

import { useCallback, useEffect, useState } from 'react';
import Banner from '@/components/Banner';
import { useConfirm } from '@/components/Confirm';
import ConsoleShell from '@/components/ConsoleShell';
import { ApiError, api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { useSession } from '@/lib/session';
import { PackageDesk, PromoPackage } from '@/lib/types';

/**
 * Contract 6.8, the package shelf. What a payer is offered when they buy reach is
 * three numbers per package: the Coin price, how many days it runs, and how far it
 * promises to go. They used to be a Python list, so repricing was a deploy; here
 * they are one row in the settings table and the shelf re-quotes the next payer the
 * moment it is saved.
 *
 * A campaign already bought is deliberately untouched. Its row holds the package id
 * it paid for, so rewriting Starter to 150 coins changes what the next person is
 * charged and never what somebody was charged last week.
 */

type Draft = { id: string; name: string; coins: string; days: string; reach_max: string };

const BLANK = (index: number): Draft => ({
  id: `pk_new_${index}`, name: '', coins: '100', days: '7', reach_max: '3000',
});

function toDraft(pack: PromoPackage): Draft {
  return {
    id: pack.id, name: pack.name,
    coins: String(pack.coins), days: String(pack.days ?? ''), reach_max: String(pack.reach_max ?? ''),
  };
}

export default function PackagesScreen() {
  const { noteGate } = useSession();
  const confirm = useConfirm();
  const [desk, setDesk] = useState<PackageDesk | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const back = await api<PackageDesk>('admin/promotions/packages/');
      setDesk(back);
      setDraft(back.packages.map(toDraft));
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const shelf = desk?.packages || [];
  // The row count and the ids are what a bought campaign is matched by, so a shelf
  // is dirty when any number on it moved, not when somebody typed and undid it.
  const dirty = !!desk && JSON.stringify(draft) !== JSON.stringify(desk.packages.map(toDraft));

  const edit = (index: number, field: keyof Draft, value: string) => {
    setDraft(list => list.map((row, position) => (position === index ? { ...row, [field]: value } : row)));
  };

  const save = async () => {
    if (!desk) return;
    // The id is what a campaign already bought is matched by, so a number typed
    // here rewrites the words around a promise people already paid for.
    const moved = desk.packages.filter((row, index) => {
      const next = draft[index];
      return !next || next.id.trim() !== row.id
        || Number(next.coins) !== row.coins || Number(next.days) !== row.days
        || Number(next.reach_max) !== row.reach_max;
    }).length;
    const sure = await confirm({
      title: `Rewrite the package shelf (${moved} package(s) changed)?`,
      body: 'Campaigns already bought keep their own numbers, but this is the price list every payer sees next. A package whose id disappeared is treated as withdrawn, and a campaign pointing at it stops being signable.',
      confirmLabel: 'Save the shelf',
      tone: 'amber',
    });
    if (!sure) return;
    setBusy(true);
    setBanner(null);
    setErrors([]);
    try {
      const out = await api<{ packages: PromoPackage[]; detail: string }>('admin/promotions/packages/', {
        method: 'POST',
        body: {
          packages: draft.map(row => ({
            id: row.id.trim(),
            name: row.name.trim(),
            coins: Number(row.coins) || 0,
            days: Number(row.days) || 0,
            reach_max: Number(row.reach_max) || 0,
          })),
        },
      });
      setDesk({ ...desk, packages: out.packages, is_edited: true });
      setDraft(out.packages.map(toDraft));
      setBanner({ kind: 'ok', text: out.detail });
    } catch (err) {
      const failure = err as ApiError;
      const lines = Array.isArray(failure.data?.errors) ? failure.data.errors as string[] : [];
      setErrors(lines);
      if (!noteGate(err)) setBanner({ kind: 'bad', text: failure.message });
    } finally {
      setBusy(false);
    }
  };

  const total = draft.reduce((sum, row) => sum + (Number(row.coins) || 0), 0);

  return (
    <ConsoleShell
      title="Promotion packages"
      subtitle="The three numbers a payer chooses between, the Coin price, how many days the campaign runs, how far it promises to go, and who has already bought each one."
      actions={(
        <button
          type="button" className={`btn ghost${busy ? ' spinning' : ''}`}
          onClick={() => { load(); setBanner(null); setErrors([]); }} title="Reload the shelf"
        >
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Banner banner={banner} />

      {errors.length > 0 && (
        <section className="panel" data-pkg-errors>
          <p className="line">
            {IC.alert}
            <span><b>{errors.length} problem{errors.length === 1 ? '' : 's'} with this shelf.</b> Nothing was written, the catalog a payer sees is still the one below.</span>
          </p>
          <ul className="pk-problems">
            {errors.map(line => <li key={line}>{line}</li>)}
          </ul>
        </section>
      )}

      {!desk ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : (
        <div className="pkg-grid">
          <section className="panel" data-pkg="shelf">
            <div className="panel-head">
              <div>
                <h2>The shelf a payer chooses from</h2>
                <p>
                  Save and the next person buying reach is quoted these numbers, no deploy, and the
                  campaigns already running keep the price they paid. An empty box reads as zero, and a
                  package priced or timed at zero is refused on the way in.
                </p>
              </div>
            </div>

            <div className="pk-rows">
              <p className="pk-head">
                <span>Package</span><span>What it costs</span><span>What it promises</span><span>Chosen by</span>
              </p>
              {draft.map((row, index) => {
                const bought = desk.bought[row.id.trim()] || 0;
                const paid = shelf.find(pack => pack.id === row.id.trim());
                return (
                  <div className="pk-row" data-pkg-row={row.id || `new-${index}`} key={index}>
                    <label className="field pk-name">
                      <span>Name</span>
                      <input
                        name="name" value={row.name} maxLength={40} placeholder="Prime"
                        data-pkg-field="name"
                        onChange={event => edit(index, 'name', event.target.value)}
                      />
                      <em className="desk-who">
                        <input
                          name="id" value={row.id} maxLength={24} placeholder="pk_prime"
                          data-pkg-field="id" title="The id the site buys against"
                          onChange={event => edit(index, 'id', event.target.value)}
                        />
                      </em>
                    </label>

                    <div className="pk-money">
                      <label className="field">
                        <span>Coins</span>
                        <input
                          name="coins" value={row.coins} inputMode="numeric" maxLength={9}
                          data-pkg-field="coins"
                          onChange={event => edit(index, 'coins', event.target.value.replace(/[^\d]/g, ''))}
                        />
                      </label>
                      <label className="field">
                        <span>Days</span>
                        <input
                          name="days" value={row.days} inputMode="numeric" maxLength={4}
                          data-pkg-field="days"
                          onChange={event => edit(index, 'days', event.target.value.replace(/[^\d]/g, ''))}
                        />
                      </label>
                    </div>

                    <label className="field">
                      <span>Up to this many people</span>
                      <input
                        name="reach_max" value={row.reach_max} inputMode="numeric" maxLength={9}
                        data-pkg-field="reach"
                        onChange={event => edit(index, 'reach_max', event.target.value.replace(/[^\d]/g, ''))}
                      />
                      <em className="desk-who">
                        {paid
                          ? <>quoted today as <b>{paid.reach}</b></>
                          : 'a new package, the site has never sold it'}
                      </em>
                    </label>

                    <div className="pk-bought">
                      <b data-bought={row.id.trim() || 'new'}>{bought}</b>
                      <span>campaign{bought === 1 ? '' : 's'} bought this id</span>
                    </div>

                    <button
                      type="button" className="btn ghost tiny" data-pkg-drop
                      disabled={busy || draft.length <= 1}
                      title={draft.length <= 1 ? 'The last package on the shelf cannot be dropped' : 'Take this one off the shelf'}
                      onClick={() => setDraft(list => list.filter((_, position) => position !== index))}
                    >
                      {IC.x}<span>Drop</span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="ask-actions">
              <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => setDraft(list => [...list, BLANK(list.length + 1)])} data-pkg-add>
                {IC.plus}<span>Add a package</span>
              </button>
              <button
                type="button" className="btn primary" data-pkg-save
                disabled={busy || !dirty} onClick={save}
                title={dirty ? 'Put this shelf up for the next payer' : 'Nothing has changed yet'}
              >
                {IC.check}<span>{busy ? 'Working…' : 'Save the shelf'}</span>
              </button>
              {dirty && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft(desk.packages.map(toDraft))}>
                  <span>Undo my typing</span>
                </button>
              )}
              <span className="pk-sum" data-pkg-sum>
                {draft.length} package{draft.length === 1 ? '' : 's'} · {num(total)} Coins on the shelf
              </span>
            </div>
          </section>

          <section className="panel" data-pkg="reference">
            <div className="panel-head">
              <div>
                <h2>What the site is selling right now</h2>
                <p>
                  Read from <b>GET /api/promotions/config/</b>, the same answer the campaign-buying
                  screen gets, with nobody signed in. {desk.is_edited
                    ? 'This shelf has been rewritten from the console.'
                    : 'Nobody has rewritten it, so these are the three the site shipped with.'}
                </p>
              </div>
            </div>

            <ul className="terms">
              {desk.packages.map(pack => (
                <li className="term" key={pack.id} data-live={pack.id}>
                  <div className="term-body">
                    <b className="term-text">{pack.name} <em>· {pack.coins} Coins / {pack.days} d</em></b>
                    <em className="term-note">{pack.reach} · id <code>{pack.id}</code></em>
                  </div>
                </li>
              ))}
            </ul>

            <h3 className="desk-sub">The three the site shipped with</h3>
            <ul className="terms">
              {desk.shipped.map(pack => (
                <li className="term" key={pack.id}>
                  <div className="term-body">
                    <b className="term-text">{pack.name} <em>· {pack.coins} Coins / {pack.days} d</em></b>
                    <em className="term-note">{pack.reach}</em>
                  </div>
                </li>
              ))}
            </ul>

            <p className="panel-foot">
              {IC.alert}
              <span>
                Dropping a package does not delete anybody&rsquo;s campaign. A row that still carries that
                id keeps running and keeps the price it paid, the desk just shows the id it cannot match,
                so nobody can be sold something off a shelf that no longer exists.
              </span>
            </p>
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
