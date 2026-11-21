'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { Media } from '@/lib/types';
import { mediaFromFile } from '@/lib/mediaFile';
import { setCreateDraft } from '@/lib/draftMedia';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';

const MAX_VIDEOS = 3;

export default function CreateChooser() {
  const { createChooserOpen, closeCreateChooser, me, showToast } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  useBackClose(createChooserOpen, closeCreateChooser);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setPct(0);
    const next: Media[] = [];
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('video/')) throw new Error('Reels need a video — choose a video file.');
        if (next.length >= MAX_VIDEOS) throw new Error(`Up to ${MAX_VIDEOS} videos per reel — pick fewer clips.`);
        next.push(await mediaFromFile(file, (sent, total) => setPct(total > 0 ? Math.min(99, Math.round((sent / total) * 100)) : 0)));
      }
      setCreateDraft({ media: next, kind: 'reel' });
      closeLayerWithoutBack();
      closeCreateChooser();
      router.push('/create');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'This file could not be opened. Try another one.');
    } finally {
      setBusy(false);
    }
  };

  if (!createChooserOpen || !me) return null;

  return createPortal(
    <div className="chooser-overlay" onClick={closeCreateChooser}>
      <div className="chooser-card compact" role="dialog" aria-modal="true" aria-label="Choose what to create" onClick={e => e.stopPropagation()}>
        <div className="chooser-head">
          <b>Create</b>
          <button type="button" className="icon-btn chooser-x" onClick={closeCreateChooser} aria-label="Close">{IC.x}</button>
        </div>
        <div className="chooser-options">
          <button type="button" disabled={busy} onClick={() => { closeLayerWithoutBack(); closeCreateChooser(); router.push('/create'); }}>
            <span className="chooser-icon post">{IC.img}</span>
            <span className="chooser-copy"><b>Post</b><small>Share a thought or a photo</small></span>
            <span className="chooser-plus" aria-hidden="true">{IC.plus}</span>
          </button>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
            <span className="chooser-icon reel">{IC.video}</span>
            <span className="chooser-copy"><b>Reel</b><small>Choose a video or photo</small></span>
            <span className="chooser-plus" aria-hidden="true">{IC.plus}</span>
          </button>
        </div>
        {busy && <p className="chooser-busy" role="status">{pct ? `Uploading your clip… ${pct}%` : 'Reading your clip…'}</p>}
        <button type="button" className="chooser-cancel" onClick={closeCreateChooser}>Cancel</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        multiple
        hidden
        onClick={e => e.stopPropagation()}
        onChange={e => { void pick(e.target.files); e.target.value = ''; }}
      />
    </div>,
    document.body
  );
}