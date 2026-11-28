'use client';

import { createPortal } from 'react-dom';
import { useApp } from '@/lib/AppContext';
import { useBackClose } from '@/lib/useBackClose';
import PromoteForm from './PromoteForm';
import { IC } from '@/lib/icons';

interface PromoteModalProps {
  targetType: 'post' | 'listing';
  targetId: string;
  defaultCategory?: string;
  onClose: () => void;
}

export default function PromoteModal({ targetType, targetId, defaultCategory, onClose }: PromoteModalProps) {
  const { t, db, requestPromotion, showConfirm } = useApp();
  useBackClose(true, onClose);
  // The composer's toggle label was this sheet's title on both doors, so a seller
  // promoting an advert was told it was a post.
  const head = `${t('promote')} ${t(targetType === 'listing' ? 'dlisting' : 'dpost')}`;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="modal-overlay" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="modal-content promote-modal" onClick={e => e.stopPropagation()} role="dialog" aria-label={head}>
        <div className="modal-header">
          <b>{head}</b>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>{IC.x}</button>
        </div>
        <div className="promote-modal-body">
          <p className="promote-hint">{t('promoteHint')}</p>
          <PromoteForm
            targetType={targetType}
            defaultCategory={defaultCategory}
            confirmLabel={t('promote')}
            onConfirm={cfg => {
              const pack = db.settings.packages.find(p => p.id === cfg.packageId);
              showConfirm(t('promoteSpendConfirm', { n: pack?.coins ?? 0 }), async () => {
                if (await requestPromotion(targetType, targetId, cfg)) onClose();
              });
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}