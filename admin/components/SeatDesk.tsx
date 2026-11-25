'use client';

import Link from 'next/link';
import { IC } from '@/lib/icons';
import { useConfirm } from '@/components/Confirm';
import { Catalogue, Seat } from '@/lib/types';

export type State = 'default' | 'allow' | 'deny';
export const CYCLE: Record<State, State> = { default: 'allow', allow: 'deny', deny: 'default' };

export const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', moderator: 'Moderator',
};

/**
 * One seat, opened as a page of its own: the grant on the left, the screens on
 * the right. Nothing here acts without a second click, because every verb on
 * this desk either takes a door away from a person or hands one back.
 */
export function SeatBody({
  seat, mine, reachable, editable, busy, can, isSuperadmin, catalogue, labelOf,
  valueOf, draftKeys, dirty, onCycle, onSave, onDiscard, onMutate,
}: {
  seat: Seat;
  mine: boolean;
  reachable: boolean;
  editable: boolean;
  busy: boolean;
  can: (key: string) => boolean;
  isSuperadmin: boolean;
  catalogue: Catalogue | null;
  labelOf: (key: string) => string;
  valueOf: (key: string) => State;
  draftKeys: { granted: string[]; denied: string[] };
  dirty: boolean;
  onCycle: (key: string) => void;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onMutate: (path: string, body: Record<string, unknown>, done: string) => Promise<void>;
}) {
  const confirm = useConfirm();

  /** A seat-level verb says what it does to the person holding it before it does it. */
  const ask = async (
    title: string, body: string, label: string, run: () => Promise<void>, onNo?: () => void,
  ) => {
    if (await confirm({ title, body, confirmLabel: label, tone: 'danger', onNo })) await run();
  };

  const saveScreens = async () => {
    const sure = await confirm({
      title: `Rewrite @${seat.username}'s screens?`,
      body: `${draftKeys.granted.length} granted beyond the role and ${draftKeys.denied.length} refused by name. The change lands on their next click, so a page they are reading at this moment changes shape under them.`,
      confirmLabel: 'Save screens',
      tone: 'amber',
    });
    if (sure) await onSave();
  };

  return (
    <div className="seat-body">
      <div className="seat-side">
        <h3>Seat</h3>
        {seat.granted_by && (
          <p className="note">Granted by <b>{seat.granted_by}</b>.</p>
        )}
        {mine && (
          <p className="note">
            Your own role and screens are changed from another staff account, one bad
            click cannot shut the door you are standing in.
          </p>
        )}

        {editable && (
          <label className="field">
            <span>Role</span>
            <select
              defaultValue={seat.role}
              disabled={busy || seat.role === 'superadmin'}
              onChange={event => {
                const next = event.target.value;
                const put = () => onMutate(`admin/staff/${seat.username}/`, { role: next },
                  `${seat.username} is now a ${ROLE_LABEL[next]}.`);
                void ask(`Change @${seat.username} to a ${ROLE_LABEL[next]} seat?`,
                  'The screens they reach move with the role. Nothing else about the account changes, and the next sign-in still needs their authenticator.',
                  `Make it ${ROLE_LABEL[next]}`,
                  put,
                  // An uncontrolled select keeps the picked word after a "no", so it has to be put back.
                  () => { event.target.value = seat.role; });
              }}
            >
              {(isSuperadmin ? ['superadmin', 'admin', 'moderator'] : ['moderator'])
                .map(role => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </select>
            {seat.role === 'superadmin' && (
              <em>A Client seat holds every screen; there is nothing to narrow it to.</em>
            )}
          </label>
        )}

        {can('staff_permissions') && reachable && (
          <button
            type="button"
            className={`btn ${seat.is_enabled ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={() => void (seat.is_enabled
              ? ask(`Switch @${seat.username}'s seat off?`,
                'Their open console stops at the next click and they cannot sign in again until a seat is switched back on. Their member account is untouched.',
                'Switch seat off',
                () => onMutate(`admin/staff/${seat.username}/`, { is_enabled: false },
                  `${seat.username}'s seat is switched off. Their open console stops at the next click.`))
              : ask(`Switch @${seat.username}'s seat back on?`,
                'They can sign in to the console again with the authenticator they already set up, and reach whatever screens this seat holds.',
                'Switch seat on',
                () => onMutate(`admin/staff/${seat.username}/`, { is_enabled: true },
                  `${seat.username} can sign in again.`)))}
          >
            {seat.is_enabled ? IC.x : IC.check}
            <span>{seat.is_enabled ? 'Switch seat off' : 'Switch seat back on'}</span>
          </button>
        )}

        {can('staff_permissions') && reachable && seat.enrolled && (
          <button
            type="button" className="btn ghost" disabled={busy}
            onClick={() => void ask(`Unbind @${seat.username}'s authenticator?`,
              'The code on their phone stops working at once. They must scan a new one at the next sign-in, and the recovery codes you gave them still work until then.',
              'Reset authenticator',
              () => onMutate(`admin/staff/${seat.username}/reset-two-factor/`, {},
                `${seat.username}'s authenticator is unbound. They must scan a new one at the next sign-in.`))}
          >
            {IC.refresh}<span>Reset authenticator</span>
          </button>
        )}

        {can('staff_grant') && reachable && seat.is_enabled && !mine && (
          <button
            type="button" className="btn danger outline" disabled={busy}
            onClick={() => void ask(`End @${seat.username}'s access to the console?`,
              'Every open session is revoked immediately and the seat cannot be signed back in. Their member account, posts and wallet are not touched, this only shuts the console door.',
              'Revoke access',
              () => onMutate(`admin/staff/${seat.username}/revoke/`, {},
                `Access ended for ${seat.username}.`))}
          >
            {IC.logout}<span>Revoke access</span>
          </button>
        )}

        {!seat.is_enabled && can('staff_grant') && reachable && (
          <button
            type="button" className="btn ghost" disabled={busy}
            onClick={() => void ask(`Hand @${seat.username} the same ${ROLE_LABEL[seat.role]} seat back?`,
              'They can sign in again with the authenticator they already set up. The screens stay exactly as they were left.',
              'Hand the seat back',
              () => onMutate('admin/staff/grant/',
                { username: seat.username, role: seat.role },
                `${seat.username} holds a ${ROLE_LABEL[seat.role]} seat again.`))}
          >
            {IC.plus}<span>Hand the same seat back</span>
          </button>
        )}

        <p className="fineprint">
          <Link href={`/people/${seat.username}`}>@{seat.username}&apos;s member record</Link>
        </p>
      </div>

      <div className="seat-keys">
        <h3>Screens</h3>
        {seat.role === 'superadmin' ? (
          <p className="note">A Superadmin is the Client and holds all {seat.permissions.length} screens.</p>
        ) : !editable ? (
          <div className="key-list">
            {seat.permissions.map(key => (
              <span key={key} className="key on">{labelOf(key)}</span>
            ))}
            {seat.permissions.length === 0 && <p className="note">This seat opens nothing but the console itself.</p>}
          </div>
        ) : (
          <>
            <p className="note">
              Click a screen to cycle role default → extra grant → explicit denial. A
              denial always wins, so a screen taken away stays taken away.
            </p>
            <KeyGrid
              catalogue={catalogue} valueOf={valueOf} labelOf={labelOf}
              onChange={onCycle}
            />
            <div className="key-actions">
              <button type="button" className="btn primary" disabled={busy || !dirty} onClick={() => { void saveScreens(); }}>
                {IC.check}<span>Save screens</span>
              </button>
              <button
                type="button" className="btn ghost" disabled={busy || !dirty}
                onClick={onDiscard}
              >
                <span>Discard changes</span>
              </button>
              <span className="key-tally">
                {draftKeys.granted.length} granted · {draftKeys.denied.length} denied
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** What each area of the console is for, said before the person ticks anything. */
const GROUP_BLURBS: Record<string, string> = {
  dashboard: 'Numbers about how the site is doing.',
  moderation: 'Complaints, and the posts, comments and listings they point at.',
  people: 'Find a member and act on their account.',
  payments: 'Coin purchases, the ledger and what coins cost.',
  promotions: 'Paid promotion requests and the settings behind them.',
  safety: 'Spam rules, alerts, the record of what staff did, and exports.',
  platform: 'Settings that change the site itself.',
  staff: 'Other seats: who holds one and what it reaches.',
};

/** The screens the chosen role opens on its own, before anyone ticks a box. */
export function roleKeys(catalogue: Catalogue | null, role: string): string[] {
  return (catalogue?.permissions ?? []).filter(entry => (entry.roles as string[]).includes(role)).map(entry => entry.key);
}

/**
 * The screens a seat opens, as a plain tick list.
 *
 * A grant form used to show every key as a chip that cycled through three hidden
 * states, role default, extra grant, explicit denial, with the role's own set only
 * in a tooltip. Nobody could read it at a glance, and getting it wrong took a
 * screen away from a colleague. Here the answer to "can this person open it" is the
 * box: the role only decides where the ticks start.
 */
export function ScreenPicker({
  catalogue, role, checked, labelOf, onToggle, onSetAll,
}: {
  catalogue: Catalogue | null;
  role: string;
  checked: Record<string, boolean>;
  labelOf: (key: string) => string;
  onToggle: (key: string) => void;
  onSetAll: (kind: 'all' | 'none' | 'role') => void;
}) {
  if (!catalogue) {
    return <div className="skeleton-stack"><div className="skeleton"/><div className="skeleton skeleton-short"/></div>;
  }
  const keys = catalogue.permissions.map(entry => entry.key);
  const open = keys.filter(key => checked[key]).length;
  return (
    <div className="picker">
      <div className="picker-tools">
        <p className="picker-count">
          <b>{open}</b> of {keys.length} screens open
        </p>
        <div className="picker-jumps">
          <button type="button" className="btn tiny" onClick={() => onSetAll('role')} title="Back to what this role gets by default">
            {IC.refresh}<span>{ROLE_LABEL[role] || role} defaults</span>
          </button>
          <button type="button" className="btn tiny" onClick={() => onSetAll('none')} title="They open nothing but the console itself">
            {IC.x}<span>None</span>
          </button>
          <button type="button" className="btn tiny" onClick={() => onSetAll('all')} title="Every screen in the console">
            {IC.check}<span>All</span>
          </button>
        </div>
      </div>
      <div className="picker-body">
        {catalogue.groups.map(group => {
          const entries = catalogue.permissions.filter(entry => entry.group === group.id);
          if (entries.length === 0) return null;
          const picked = entries.filter(entry => checked[entry.key]).length;
          return (
            <div className="picker-group" key={group.id}>
              <div className="picker-group-head">
                <b>{group.label}</b>
                <em>{GROUP_BLURBS[group.id] || ''}</em>
                <span className={`picker-group-count${picked === 0 ? ' none' : ''}`}>{picked}/{entries.length}</span>
              </div>
              {entries.map(entry => (
                <label className={`screen${checked[entry.key] ? ' on' : ''}`} key={entry.key}>
                  <input
                    type="checkbox" checked={!!checked[entry.key]}
                    onChange={() => onToggle(entry.key)}
                  />
                  <span className="screen-name">{labelOf(entry.key)}</span>
                  {(entry.roles as string[]).includes(role) && <em className="screen-tag">with this role</em>}
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function KeyGrid({
  catalogue, valueOf, labelOf, onChange,
}: {
  catalogue: Catalogue | null;
  valueOf: (key: string) => State;
  labelOf: (key: string) => string;
  onChange: (key: string) => void;
}) {
  if (!catalogue) return <div className="skeleton-stack"><div className="skeleton" /></div>;
  return (
    <div className="key-groups">
      {catalogue.groups.map(group => {
        const entries = catalogue.permissions.filter(entry => entry.group === group.id);
        if (entries.length === 0) return null;
        return (
          <div key={group.id} className="key-group">
            <span className="key-group-label">{group.label}</span>
            <div className="key-list">
              {entries.map(entry => {
                const value = valueOf(entry.key);
                return (
                  <button
                    type="button" key={entry.key}
                    className={`key ${value}`} onClick={() => onChange(entry.key)}
                    title={`Role default: ${entry.roles.map(role => ROLE_LABEL[role] || role).join(', ') || 'nobody'}`}
                  >
                    {value === 'allow' ? IC.plus : value === 'deny' ? IC.x : IC.check}
                    <span>{labelOf(entry.key)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
