'use client';

import { useCallback, useEffect, useState } from 'react';
import ConsoleShell from '@/components/ConsoleShell';
import { api } from '@/lib/api';
import { bytes } from '@/lib/format';
import { IC } from '@/lib/icons';
import { ago } from '@/lib/time';
import { useSession } from '@/lib/session';
import { LimitsConfig, LimitsDesk, SettingLine } from '@/lib/types';

/**
 * Contract 6.10 — the size of one post, as a setting instead of a constant.
 *
 * The defaults the clause names are 2,000 characters, four photos of 5 MB each and
 * one video up to 60 seconds and 150 MB. Until this screen existed those numbers
 * lived in the composer and in the upload endpoint, which meant making a post
 * roomier for a wedding photographer was a pull request. They are six rows now, and
 * they are published at `GET /api/limits/config/`.
 *
 * What the platform refuses *today* is printed beside them, because the two lists
 * are not the same: the upload endpoint has one hard ceiling of its own, and a
 * number typed above it is a real rule the composer will honour and a file the
 * server still turns away. Saying that here is cheaper than a 400 explaining it to
 * a person who had already uploaded the video.
 */

export default function LimitsScreen() {
  const { noteGate } = useSession();
  const [desk, setDesk] = useState<LimitsDesk | null>(null);
  const [quote, setQuote] = useState<LimitsConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [back, open] = await Promise.all([
        api<LimitsDesk>('admin/limits/'),
        api<LimitsConfig>('limits/config/').catch(() => null),
      ]);
      setDesk(back);
      setQuote(open);
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    }
  }, [noteGate]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = (desk?.blocks || []).reduce((all, block) => [...all, ...block.lines], [] as SettingLine[]);
  const baseOf = (item: SettingLine) => String(item.value ?? '');
  const valueOf = (item: SettingLine) => draft[item.key] ?? baseOf(item);
  const touched = lines.filter(item => valueOf(item) !== baseOf(item));
  const dirty = touched.length > 0;
  // The clause names its own numbers as the shipped defaults, so a row that differs
  // from its default is a rule this platform has already moved away from — which is
  // the first thing anybody auditing "the admin must be able to change these" asks.
  const drifted = lines.filter(item => String(item.value) !== String(item.default));

  const save = async () => {
    setBusy(true);
    try {
      const body = touched.reduce((all, item) => ({ ...all, [item.key]: valueOf(item) }), {} as Record<string, string>);
      const out = await api<{ detail: string; warnings: string[]; config: LimitsConfig }>('admin/limits/', {
        method: 'POST', body,
      });
      setBanner({ kind: 'ok', text: out.warnings.length ? `${out.detail} ${out.warnings[0]}` : out.detail });
      setDraft({});
      const [again, open] = await Promise.all([
        api<LimitsDesk>('admin/limits/'),
        api<LimitsConfig>('limits/config/').catch(() => null),
      ]);
      setDesk(again);
      setQuote(open);
    } catch (err) {
      if (!noteGate(err)) setBanner({ kind: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConsoleShell
      title="Post limits"
      subtitle="Characters in one post, how many photos and how big each may be, how long a video may run and how large it may be — six numbers that used to be constants in the site’s code, and are now rows a seat can move."
      actions={(
        <button
          type="button" className={`btn ghost${busy ? ' spinning' : ''}`}
          onClick={() => { load(); setDraft({}); }} title="Reload the desk"
        >
          {IC.refresh}<span>Refresh</span>
        </button>
      )}
    >
      {banner && (
        <p className={`banner banner-${banner.kind}`} role="status">
          {banner.kind === 'ok' ? IC.check : IC.alert}<span>{banner.text}</span>
        </p>
      )}

      {!desk ? (
        <div className="skeleton-stack">
          <div className="skeleton"/><div className="skeleton"/><div className="skeleton skeleton-short"/>
        </div>
      ) : (
        <div className="policy-grid">
          <section className="panel" data-limits="sizes">
            <div className="panel-head">
              <div>
                <h2>The six numbers</h2>
                <p>
                  Each box says what it is measured in, and the range this desk will accept — a limit of
                  zero photos is not a stricter rule, it is a composer nobody can post with.
                </p>
              </div>
            </div>

            {desk.blocks.map(block => (
              <div className="algo-block" data-block={block.id} key={block.id}>
                <h3 className="desk-sub">{block.label}</h3>
                <div className="desk-grid">
                  {block.lines.map(item => (
                    <label className="field" data-knob={item.key} key={item.key}>
                      <span>{item.label}</span>
                      <input
                        name={item.key} value={valueOf(item)} autoComplete="off" maxLength={7}
                        inputMode="numeric" placeholder={String(item.default)}
                        disabled={!desk.can_write || busy}
                        data-default={String(item.default)}
                        onChange={event => setDraft({ ...draft, [item.key]: event.target.value.replace(/[^\d]/g, '') })}
                      />
                      <em className="desk-who">
                        {item.set
                          ? <>written by <b>{item.by}</b> {ago(item.at || '')} — {item.help}</>
                          : <>the number the clause names, still untouched — {item.help}</>}
                        {' '}Accepts {item.range[0]} to {item.range[1]}.
                      </em>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {desk.oversized.length > 0 && (
              <p className="note row" data-oversized>
                {IC.alert}
                <span>
                  <b>One of these the server cannot honour yet.</b> {desk.oversized[0]}
                </span>
              </p>
            )}

            <div className="ask-actions">
              <button
                type="button" className="btn primary" data-limits-save
                disabled={busy || !dirty || !desk.can_write} onClick={save}
                title={dirty ? 'Write these to the platform' : 'Nothing has changed yet'}
              >
                {IC.check}<span>{busy ? 'Working…' : 'Save the limits'}</span>
              </button>
              {dirty && (
                <button type="button" className="btn ghost" disabled={busy} onClick={() => setDraft({})}>
                  <span>Undo my typing</span>
                </button>
              )}
            </div>

            {!desk.can_write && (
              <p className="note row">
                {IC.lock}
                <span>
                  This seat may read the limits but not move them. The door is the <b>Post limits</b>{' '}
                  permission, and it is granted from Staff and access.
                </span>
              </p>
            )}
          </section>

          <section className="panel" data-limits="live">
            <div className="panel-head">
              <div>
                <h2>What a composer is told</h2>
                <p>
                  This is the answer <b>GET /api/limits/config/</b> gives with nobody signed in — the
                  numbers a person attaching a file is held to the next time the site reads them.
                </p>
              </div>
            </div>

            {quote ? (
              <ul className="terms" data-live-config>
                <li className="term" data-live="text">
                  <div className="term-body">
                    <b className="term-text">One post, typed</b>
                    <em className="term-note">{quote.text.characters} characters</em>
                  </div>
                </li>
                <li className="term" data-live="photo">
                  <div className="term-body">
                    <b className="term-text">Photos</b>
                    <em className="term-note">
                      {quote.photo.per_post} per post, each up to {quote.photo.each_mb} MB ({bytes(quote.photo.each_bytes)})
                    </em>
                  </div>
                </li>
                <li className="term" data-live="video">
                  <div className="term-body">
                    <b className="term-text">Videos</b>
                    <em className="term-note">
                      {quote.video.per_post} per post, up to {quote.video.seconds} s, each up to{' '}
                      {quote.video.each_mb} MB ({bytes(quote.video.each_bytes)})
                    </em>
                  </div>
                </li>
                <li className="term" data-live="server">
                  <div className="term-body">
                    <b className="term-text">What the upload endpoint refuses today</b>
                    <em className="term-note">
                      any file over {quote.server_upload_mb} MB, whichever box it was measured against
                    </em>
                  </div>
                </li>
              </ul>
            ) : (
              <p className="empty-note">
                {IC.x}<span>The open door did not answer, so nothing can be promised about what a composer is told.</span>
              </p>
            )}

            <h3 className="desk-sub">Against the numbers the clause names</h3>
            <ul className="terms">
              {lines.map(item => (
                <li className={`term${String(item.value) === String(item.default) ? '' : ' moved'}`} key={item.key} data-contract={item.key}>
                  <div className="term-body">
                    <b className="term-text">{item.label}</b>
                    <em className="term-note">
                      the clause says {item.default}
                      {String(item.value) === String(item.default)
                        ? ' · this platform runs the same'
                        : <> · this platform runs <b>{item.value}</b></>}
                    </em>
                  </div>
                </li>
              ))}
            </ul>
            {drifted.length > 0 && (
              <p className="note" data-drifted>
                <b>{drifted.length}</b> of the six {drifted.length === 1 ? 'is' : 'are'} no longer what the
                clause’s defaults were:{' '}
                {drifted.map(item => `${item.label.toLowerCase()} (${item.default} → ${item.value})`).join(', ')}.
              </p>
            )}

            <p className="panel-foot">
              {IC.disk}
              <span>
                The ceiling is a single site-wide one — {desk.server.upload_mb} MB per file, whatever the
                file turns out to be ({desk.server.kinds.slice(0, 4).join(', ')}…). Raising a number above
                it changes what a person is allowed to attach and does not change what the endpoint accepts.
              </span>
            </p>
          </section>
        </div>
      )}
    </ConsoleShell>
  );
}
