'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';

const REASONS = ['r_spam', 'r_abuse', 'r_sexual', 'r_violence', 'r_false', 'r_other'] as const;

interface ReportModalProps {
  type: 'post' | 'comment' | 'listing' | 'profile';
  targetId: string;
  onClose: () => void;
}

export default function ReportModal({ type, targetId, onClose }: ReportModalProps) {
  const { t, addReport, db, me } = useApp();
  const [reason, setReason] = useState<string>('r_spam');
  const [note, setNote] = useState('');

  const already = me && db.reports.some(r => r.type === type && r.targetId === targetId && r.by === me.id);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    addReport(type, targetId, reason, note);
    onClose();
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content report-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('reportTitle')}>
        <div className="modal-header">
          <b>{t('reportTitle')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        {already ? (
          <p className="report-already">{t('alreadyReported')}</p>
        ) : (
          <form className="report-form" onSubmit={submit}>
            {REASONS.map(r => (
              <label key={r} className={`report-option ${reason === r ? 'on' : ''}`}>
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                <span>{t(r)}</span>
              </label>
            ))}
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={t('notePh')}
              maxLength={500}
              rows={3}
            />
            <button type="submit" className="report-submit">{t('sendReport')}</button>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}