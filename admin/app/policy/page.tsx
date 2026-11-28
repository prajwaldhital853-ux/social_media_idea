'use client';

import { useCallback, useEffect, useState } from 'react';
import Banner from '@/components/Banner';
import ConsoleShell from '@/components/ConsoleShell';
import { useConfirm } from '@/components/Confirm';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { CategoryRow, PolicyPage, TermRow } from '@/lib/types';

const KIND_LABEL: Record<TermRow['kind'], string> = {
  word: 'Blocked word', item: 'Prohibited item',
};

/** What each list is used for, since one of them now stops a write and the other one
 *  only judges what somebody is already selling. */
const ADD_BODY: Record<TermRow['kind'], string> = {
  word: 'From the next save, a post or comment carrying it is refused as it is written, '
    + 'its author is told which word stopped them, and the attempt is logged. Anything '
    + 'already published is only marked for a person, nothing comes down by itself.',
  item: 'From the next save, a listing carrying it is marked for a person to look at. '
    + 'It is a flag, not a takedown, nothing comes down by itself.',
};

export default function PolicyPageView() {
  const { can, noteGate } = useSession();
  const [data, setData] = useState<PolicyPage | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<PolicyPage>('admin/policy/'));
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  /** Every write here ends with a fresh read, so the lists shown are the stored ones. */
  const mutate = useCallback(async (
    path: string, body: Record<string, unknown>, done: string, method = 'POST',
  ) => {
    setBusy(true);
    setBanner(null);
    try {
      const out = await api<{ detail?: string }>(path, { method, body });
      setBanner({ kind: 'ok', text: out.detail || done });
      await load();
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }, [load, noteGate]);

  const words = (data?.terms || []).filter(term => term.kind === 'word');
  const items = (data?.terms || []).filter(term => term.kind === 'item');

  return (
    <ConsoleShell
      title="Platform rules"
      subtitle="The vocabulary a decision is made against: what may not be said, what may not be sold, and which shelves the marketplace is allowed to stand on."
      actions={(
        <button type="button" className={`btn ghost${busy ? ' spinning' : ''}`} onClick={() => load()} title="Reload the lists">
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      <Banner banner={banner} />

      {!data ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : (
        <>
          <div className="policy-grid">
            <TermPanel
              kind="word" rows={words} busy={busy} can={can('blocked_words')}
              heading="Blocked words"
              blurb="A post or comment carrying one of these is refused as it is written, and reported text containing one is marked in the queue. It is matched inside words on purpose, so a person typing around the filter is still caught."
              onAdd={(text, note) => mutate('admin/policy/terms/', { kind: 'word', text, note }, `“${text.toLowerCase()}” is on the blocked list.`)}
              onSave={(id, body, label) => mutate(`admin/policy/terms/${id}/`, body, `Saved ${label}.`)}
              onDelete={(id, label) => mutate(`admin/policy/terms/${id}/`, {}, `${label} is off the list.`, 'DELETE')}
            />
            <TermPanel
              kind="item" rows={items} busy={busy} can={can('blocked_words')}
              heading="Prohibited items"
              blurb="Things the marketplace does not allow at all. These do not mark a post: they are what a listing decision is written against."
              onAdd={(text, note) => mutate('admin/policy/terms/', { kind: 'item', text, note }, `“${text.toLowerCase()}” is a prohibited item.`)}
              onSave={(id, body, label) => mutate(`admin/policy/terms/${id}/`, body, `Saved ${label}.`)}
              onDelete={(id, label) => mutate(`admin/policy/terms/${id}/`, {}, `${label} is off the list.`, 'DELETE')}
            />
          </div>

          <CategoryTable
            rows={data.categories} busy={busy} can={can('categories')}
            onAdd={name => mutate('admin/policy/categories/', { name }, `${name} is a category.`)}
            onSave={(id, body, label) => mutate(`admin/policy/categories/${id}/`, body, `Saved ${label}.`)}
            onDelete={(id, label) => mutate(`admin/policy/categories/${id}/`, {}, `${label} is off the list.`, 'DELETE')}
          />

          <p className="note row">
            {IC.alert}
            <span>
              A post is pulled out of the feed automatically at <b>{data.auto_hide_at} different
              reporters</b>. That number is a threshold, not a verdict, it is changed with the spam
              controls, and every one of these lists is written to the audit log.
            </span>
          </p>
        </>
      )}
    </ConsoleShell>
  );
}

function TermPanel({
  kind, rows, heading, blurb, busy, can, onAdd, onSave, onDelete,
}: {
  kind: TermRow['kind'];
  rows: TermRow[];
  heading: string;
  blurb: string;
  busy: boolean;
  can: boolean;
  onAdd: (text: string, note: string) => Promise<void>;
  onSave: (id: number, body: Record<string, unknown>, label: string) => Promise<void>;
  onDelete: (id: number, label: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ text: '', note: '' });
  const confirm = useConfirm();

  const remove = async (title: string, body: string, run: () => Promise<void>) => {
    if (await confirm({ title, body, confirmLabel: 'Remove', tone: 'danger' })) await run();
  };

  const put = async (title: string, body: string, run: () => Promise<void>) => {
    if (await confirm({ title, body, confirmLabel: 'Save', tone: 'amber' })) await run();
  };

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const sure = await confirm({
      title: `Put “${text.trim()}” on the ${KIND_LABEL[kind]} list?`,
      body: ADD_BODY[kind],
      confirmLabel: 'Add it',
      tone: 'amber',
    });
    if (!sure) return;
    await onAdd(text.trim(), note.trim());
    setText('');
    setNote('');
  };

  return (
    <section className="panel" data-list={kind}>
      <div className="panel-head">
        <div>
          <h2>{heading} <em>{rows.length}</em></h2>
          <p>{blurb}</p>
        </div>
      </div>

      {can ? (
        <form className="term-add" onSubmit={add}>
          <label className="field grow">
            <span>{KIND_LABEL[kind]}</span>
            <input
              name="text" value={text} onChange={event => setText(event.target.value)}
              placeholder={kind === 'word' ? 'one word or phrase, up to 80 characters' : 'the thing that may not be sold'}
              maxLength={80} autoComplete="off"
            />
          </label>
          <label className="field grow">
            <span>Why it is on the list (optional)</span>
            <input
              name="note" value={note} onChange={event => setNote(event.target.value)}
              placeholder="shown to whoever has to explain the rule" maxLength={200} autoComplete="off"
            />
          </label>
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
            {IC.plus}<span>Add</span>
          </button>
        </form>
      ) : (
        <p className="note row">
          {IC.lock}
          <span>Reading this list is part of the queue; changing it is not. An Admin can give
            <b> Blocked words and items</b> to a seat.</span>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="empty-note">{IC.x}<span>Nothing on this list yet.</span></p>
      ) : (
        <ul className="terms">
          {rows.map(row => {
            const opens = editing === row.id;
            return (
              <li key={row.id} data-term={row.text} className={`term${row.is_active ? '' : ' off'}`}>
                {opens ? (
                  <div className="term-edit">
                    <label className="field grow">
                      <span>Text</span>
                      <input
                        name="text" value={draft.text} maxLength={80} autoComplete="off"
                        onChange={event => setDraft({ ...draft, text: event.target.value })}
                      />
                    </label>
                    <label className="field grow">
                      <span>Note</span>
                      <input
                        name="note" value={draft.note} maxLength={200} autoComplete="off"
                        onChange={event => setDraft({ ...draft, note: event.target.value })}
                      />
                    </label>
                    <div className="term-edit-actions">
                      <button
                        type="button" className="btn primary tiny" disabled={busy || !draft.text.trim()}
                        onClick={() => {
                          void put(`Rewrite “${row.text}”?`,
                            'What is already marked keeps its record. From the next scan this is the phrase the filter looks for.',
                            async () => {
                              await onSave(row.id, { text: draft.text.trim(), note: draft.note.trim() }, `“${draft.text.trim().toLowerCase()}”`);
                              setEditing(null);
                            });
                        }}
                      >
                        {IC.check}<span>Save</span>
                      </button>
                      <button type="button" className="btn ghost tiny" onClick={() => setEditing(null)}>
                        <span>Cancel</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="term-body">
                      <b className="term-text">{row.text}</b>
                      {row.note && <em className="term-note">{row.note}</em>}
                      <span className="term-meta">
                        {row.created_by ? `added by ${row.created_by}` : 'added by the Client'} {ago(row.created_at)}
                      </span>
                    </div>
                    <div className="term-acts">
                      {row.is_active
                        ? <span className="pill good">Enforced</span>
                        : <span className="pill mute">Switched off</span>}
                      {can && (
                        <>
                          <button type="button" className="btn ghost tiny" onClick={() => setEditing(row.id)}>
                            <span>Change</span>
                          </button>
                          <button
                            type="button" className="btn ghost tiny" disabled={busy}
                            onClick={() => void put(
                              row.is_active ? `Stop enforcing “${row.text}”?` : `Enforce “${row.text}” again?`,
                              row.is_active
                                ? 'The phrase stops marking anything new from the next scan. Posts already flagged keep their record.'
                                : 'From the next scan, anything carrying it is pulled aside for a person to read.',
                              () => onSave(row.id, { is_active: !row.is_active }, row.text),
                            )}
                            title={row.is_active ? 'Stop marking the queue, keep the entry' : 'Start enforcing it again'}
                          >
                            <span>{row.is_active ? 'Turn off' : 'Turn on'}</span>
                          </button>
                          <button
                            type="button" className="btn danger outline tiny" disabled={busy}
                            onClick={() => {
                              void remove(`Remove “${row.text}” from the list?`,
                                'Past decisions keep their audit row, but the phrase stops marking anything new.',
                                () => onDelete(row.id, `“${row.text}”`));
                            }}
                          >
                            {IC.x}<span>Remove</span>
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CategoryTable({
  rows, busy, can, onAdd, onSave, onDelete,
}: {
  rows: CategoryRow[];
  busy: boolean;
  can: boolean;
  onAdd: (name: string) => Promise<void>;
  onSave: (id: number, body: Record<string, unknown>, label: string) => Promise<void>;
  onDelete: (id: number, label: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: '', sort_order: 10 });
  const confirm = useConfirm();

  const del = async (row: CategoryRow) => {
    const sure = await confirm({
      title: `Delete the ${row.name} shelf?`,
      body: 'Listings already filed under it keep their text but stop being categorised, and nobody can file a new one there. Hide it instead if sellers still use it.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (sure) await onDelete(row.id, row.name);
  };

  const put = async (title: string, body: string, run: () => Promise<void>) => {
    if (await confirm({ title, body, confirmLabel: 'Save', tone: 'amber' })) await run();
  };

  return (
    <section className="panel" data-list="categories">
      <div className="panel-head">
        <div>
          <h2>Marketplace categories <em>{rows.length}</em></h2>
          <p>
            The shelves sellers choose from, ahead of the ones the site ships with. Switching one off
            leaves the listings that already sit there; the count is what that label is worth today.
          </p>
        </div>
        <span className="panel-count">order is how the marketplace shows them</span>
      </div>

      {can && (
        <form
          className="term-add"
          onSubmit={async event => {
            event.preventDefault();
            if (!name.trim()) return;
            const sure = await confirm({
              title: `Add “${name.trim()}” to the shelves?`,
              body: 'Sellers can file a new listing there from the next page load. Nothing already filed under another category moves.',
              confirmLabel: 'Add the category',
              tone: 'amber',
            });
            if (!sure) return;
            await onAdd(name.trim());
            setName('');
          }}
        >
          <label className="field grow">
            <span>New category</span>
            <input
              name="name" value={name} onChange={event => setName(event.target.value)}
              placeholder="e.g. Bicycles" maxLength={80} autoComplete="off"
            />
          </label>
          <button type="submit" className="btn primary" disabled={busy || !name.trim()}>
            {IC.plus}<span>Add category</span>
          </button>
        </form>
      )}

      {!can && (
        <p className="note row">
          {IC.lock}
          <span>Only a seat with <b>Marketplace categories</b> can change this list.</span>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="empty-note">{IC.x}<span>No categories of your own yet, so the site is selling on the default shelves it ships with.</span></p>
      ) : (
        <div className="table-scroll">
          <table className="cats">
            <thead>
              <tr><th>Category</th><th>Order</th><th>Live listings</th><th>State</th><th/></tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const opens = editing === row.id;
                return (
                  <tr key={row.id} data-cat={row.name} className={row.is_active ? '' : ' off'}>
                    <td data-label="Category">
                      {opens ? (
                        <input
                          name="name" value={draft.name} maxLength={80} autoComplete="off" aria-label="Category name"
                          onChange={event => setDraft({ ...draft, name: event.target.value })}
                        />
                      ) : <b>{row.name}</b>}
                    </td>
                    <td data-label="Order">
                      {opens ? (
                        <input
                          className="order" type="number" min={0} max={9999} value={draft.sort_order}
                          aria-label="Display order"
                          onChange={event => setDraft({ ...draft, sort_order: Number(event.target.value) })}
                        />
                      ) : row.sort_order}
                    </td>
                    <td data-label="Live listings">{row.listings === null ? '-' : num(row.listings)}</td>
                    <td data-label="State">
                      {row.is_active ? <span className="pill good">On the shelf</span> : <span className="pill mute">Hidden</span>}
                    </td>
                    <td data-label="Actions" className="cat-acts">
                      {can && !opens && (
                        <button
                          type="button" className="btn ghost tiny"
                          onClick={() => {
                            setEditing(row.id);
                            setDraft({ name: row.name, sort_order: row.sort_order });
                          }}
                        >
                          <span>Change</span>
                        </button>
                      )}
                      {opens && (
                        <>
                          <button
                            type="button" className="btn primary tiny" disabled={busy || !draft.name.trim()}
                            onClick={() => {
                              void put(`Rename the ${row.name} shelf?`,
                                'Listings already filed there follow the new word. Nothing is moved to a different shelf, and the order decides where buyers see it.',
                                async () => {
                                  await onSave(row.id, { name: draft.name.trim(), sort_order: draft.sort_order }, draft.name.trim());
                                  setEditing(null);
                                });
                            }}
                          >
                            {IC.check}<span>Save</span>
                          </button>
                          <button type="button" className="btn ghost tiny" onClick={() => setEditing(null)}>
                            <span>Cancel</span>
                          </button>
                        </>
                      )}
                      {can && (
                        <button
                          type="button" className={`btn ${row.is_active ? 'ghost' : 'primary'} tiny`} disabled={busy}
                          onClick={() => void put(
                            row.is_active ? `Hide the ${row.name} shelf?` : `Show the ${row.name} shelf again?`,
                            row.is_active
                              ? 'Sellers can no longer file here, but the listings already on it stay exactly where buyers found them.'
                              : 'It goes back on the category list sellers choose from when they file something.',
                            () => onSave(row.id, { is_active: !row.is_active }, row.name),
                          )}
                        >
                          <span>{row.is_active ? 'Hide' : 'Show'}</span>
                        </button>
                      )}
                      {can && (
                        <button
                          type="button" className="btn danger outline tiny" disabled={busy}
                          onClick={() => { void del(row); }}
                        >
                          {IC.x}<span>Delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
