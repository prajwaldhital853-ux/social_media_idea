'use client';

import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import PromoteForm from './PromoteForm';
import { IC } from '@/lib/icons';

interface PromoteModalProps {
  targetType: 'post' | 'listing';
  targetId: string;
  defaultCategory?: string;
  onClose: () => void;
}

export default function PromoteModal({ targetType, targetId, defaultCategory, onClose }: PromoteModalProps) {
  const { t, requestPromotion } = useApp();
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="modal-content promote-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('promoteSection')}>
        <div className="modal-header">
          <b>{t('promoteSection')}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="promote-modal-body">
          <p className="promote-hint">{t('promoteHint')}</p>
          <PromoteForm
            targetType={targetType}
            defaultCategory={defaultCategory}
            confirmLabel={t('promote')}
            onConfirm={cfg => {
              if (requestPromotion(targetType, targetId, cfg)) onClose();
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}