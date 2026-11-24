'use client';

import { useState } from 'react';
import { useConfirm } from '@/components/Confirm';
import { ApiError } from '@/lib/api';
import { IC } from '@/lib/icons';
import { useSession } from '@/lib/session';
import { Decision as Verb, Outcome } from '@/lib/types';

interface VerbSpec {
  label: string;
  tone: string;
  icon: keyof typeof IC;
  help: string;
  reason?: 'must' | 'can';
  notice?: 'must' | 'can';
}

/**
 * The five verbs, in the words a moderator uses, with what each one costs
 * written on the button rather than discovered after the click.
 */
const VERBS: Record<Verb, VerbSpec> = {
  dismiss: {
    label: 'Leave it up', tone: 'ghost', icon: 'check',
    help: 'Nothing wrong. Closes every open report on this target at once.',
  },
  remove: {
    label: 'Take it down', tone: 'danger', icon: 'x', reason: 'must', notice: 'can',
    help: 'The author is shown your reason and any campaign on it stops and is refunded.',
  },
  warn: {
    label: 'Warning notice', tone: 'amber', icon: 'mega', notice: 'must', reason: 'can',
    help: 'The content stays up. Choose whether everyone can read this warning or only its author.',
  },
  release: {
    label: 'Release', tone: 'primary', icon: 'go',
    help: 'Content hidden by the report counter goes back in the feed, and the pile behind it is dismissed.',
  },
  restore: {
    label: 'Restore', tone: 'primary', icon: 'refresh',
    help: 'Undo a takedown. The author is told it is back.',
  },
};

const ORDER: Verb[] = ['dismiss', 'remove', 'warn', 'release', 'restore'];

/** Only for the sentence shown before a click; the server's own 403 wording wins once asked. */
const KEY_LABEL: Record<string, string> = {
  content: 'Post and comment review',
  listings: 'Marketplace listing review',
  reports: 'Report queue',
  notices: 'Public warning notices',
};

export default function DecisionBar({
  actions, permission, run, onDone, footnote, target,
}: {
  actions: Verb[];
  permission: string | null;
  run: (verb: Verb, reason: string, notice: string, audience: string) => Promise<Outcome>;
  onDone: (out: Outcome) => void;
  footnote?: string;
  /** What the seat is about to change, named in the confirmation. */
  target?: string;
}) {
  const { can } = useSession();
  const confirm = useConfirm();
  const [open, setOpen] = useState<Verb | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [audience, setAudience] = useState('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Outcome | null>(null);

  const missing = permission && !can(permission)
    ? (KEY_LABEL[permission] || permission)
    : null;

  const ask = (verb: Verb) => {
    if (missing || busy) return;
    setError(null);
    if (VERBS[verb].reason || VERBS[verb].notice) {
      setOpen(verb);
      return;
    }
    submit(verb, '', '');
  };

  const submit = async (verb: Verb, reasonText: string, noticeText: string) => {
    const spec = VERBS[verb];
    // The click that decides is never the click that sends.
    const sure = await confirm({
      title: `${spec.label}${target ? ` — ${target}` : ''}?`,
      body: spec.help,
      confirmLabel: spec.label,
      tone: spec.tone === 'danger' ? 'danger' : 'primary',
    });
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      const out = await run(verb, reasonText.trim(), noticeText.trim(), audience);
      setDone(out);
      setOpen(null);
      setReason('');
      setNotice('');
      setAudience('public');
      onDone(out);
    } catch (err) {
      const failure = err as ApiError;
      // The door closed while this card was open: the shell takes the prompt.
      if (failure.code !== 'two_factor_required') setError(failure.message || 'That did not go through.');
    } finally {
      setBusy(false);
    }
  };

  if (actions.length === 0) {
    return <p className="note">There is nothing to decide on this target — it is no longer here.</p>;
  }

  const active = open ? VERBS[open] : null;

  return (
    <div className="decide">
      <div className="verbs">
        {ORDER.filter(verb => actions.includes(verb)).map(verb => (
          <button
            key={verb} type="button" data-verb={verb}
            className={`btn ${VERBS[verb].tone} tiny`}
            disabled={busy || !!missing}
            onClick={() => ask(verb)}
            title={VERBS[verb].help}
          >
            {IC[VERBS[verb].icon]}
            <span>{VERBS[verb].label}</span>
          </button>
        ))}
      </div>

      {missing && (
        <p className="note row">
          {IC.lock}
          <span>
            Deciding this needs <b>{missing}</b>, which is not on your seat. You can still read the
            reports and what is down.
          </span>
        </p>
      )}

      {active && (
        <div className="ask">
          <p className="note row">{IC.alert}<span>{active.help}</span></p>
          {active.reason && (
            <label className="field">
              <span>Reason {active.reason === 'must' ? '— the author is shown this' : '(optional)'}</span>
              <textarea
                rows={2} name="reason" value={reason} maxLength={500} autoFocus={active.reason === 'must'}
                placeholder={active.notice ? 'Why it came down (private to the author)' : 'What about it breaks the rules'}
                onChange={event => setReason(event.target.value)}
              />
            </label>
          )}
          {active.notice && (
            <>
              <label className="field">
                <span>Warning sentence {active.notice === 'must' ? '' : '(optional — leave blank for no notice)'}</span>
                <textarea
                  rows={2} name="notice" value={notice} maxLength={240} autoFocus={active.notice === 'must'}
                  placeholder="e.g. This listing advertises something the marketplace does not allow."
                  onChange={event => setNotice(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Who can read this warning</span>
                <select name="audience" value={audience} onChange={event => setAudience(event.target.value)}>
                  <option value="public">Public — everyone who opens this content</option>
                  <option value="private">Private — only the account it is about</option>
                </select>
              </label>
            </>
          )}
          <div className="ask-actions">
            <button
              type="button" className={`btn ${active.tone} tiny`} disabled={busy}
              onClick={() => submit(open!, reason, notice)}
            >
              {IC.go}<span>{busy ? 'Deciding…' : `Confirm — ${active.label}`}</span>
            </button>
            <button type="button" className="btn ghost tiny" disabled={busy} onClick={() => setOpen(null)}>
              <span>Cancel</span>
            </button>
          </div>
        </div>
      )}

      {error && <p className="card-error" role="status">{IC.alert}<span>{error}</span></p>}

      {done && <Verdict out={done}/>}

      {!done && footnote && <p className="note">{footnote}</p>}
    </div>
  );
}

/**
 * The answer the server gave, in the server's own words. Refunds are listed
 * because a takedown that stops a paid campaign moves money, and a moderator
 * who cannot see that cannot answer for it later.
 */
export function Verdict({ out }: { out: Outcome }) {
  return (
    <div className="verdict">
      <p className="verdict-line">
        {IC.check}
        <span><b>{out.target}</b> — {out.detail}</span>
      </p>
      {out.campaigns.length > 0 && (
        <ul className="verdict-money">
          {out.campaigns.map(campaign => (
            <li key={campaign.id}>
              Campaign #{campaign.id} ({campaign.package}, {campaign.budget} coins) stopped
              {' '}{Number(campaign.refunded) > 0 ? `· ${campaign.refunded} refunded to @${campaign.owner}` : `· nothing owed back`}
            </li>
          ))}
        </ul>
      )}
      {out.notice && (
        <p className="verdict-note">
          <span>{out.notice.audience === 'private' ? 'Private' : 'Public'} notice on {out.notice.target} about @{out.notice.about}:</span>
          <b>{out.notice.text}</b>
        </p>
      )}
    </div>
  );
}
