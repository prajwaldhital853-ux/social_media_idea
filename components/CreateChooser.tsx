'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/AppContext';
import { IC } from '@/lib/icons';
import { Media } from '@/lib/types';
import { resizeImage, videoDuration, fileToDataUrl } from '@/lib/utils';
import { setCreateDraft } from '@/lib/draftMedia';
import { useBackClose, closeLayerWithoutBack } from '@/lib/useBackClose';

const MAX_PHOTOS = 10;
const MAX_VIDEOS = 3;

export default function CreateChooser() {
  const { createChooserOpen, closeCreateChooser, me, showToast } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useBackClose(createChooserOpen, closeCreateChooser);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const next: Media[] = [];
    try {
      for (const file of Array.from(files)) {
        const video = file.type.startsWith('video/');
        if (!video && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo, or a video.');
        if (file.size > (video ? 5 : 10) * 1024 * 1024) throw new Error(video ? 'Videos must be under 5 MB.' : 'Photos must be under 10 MB.');
        if (video && next.filter(m => m.type === 'video').length >= MAX_VIDEOS) throw new Error(`Up to ${MAX_VIDEOS} videos per reel — pick fewer clips.`);
        if (!video && next.filter(m => m.type === 'image').length >= MAX_PHOTOS) throw new Error(`You can attach up to ${MAX_PHOTOS} photos.`);
        if (video) {
          const src = await fileToDataUrl(file);
          const dur = await videoDuration(src);
          if (!Number.isFinite(dur) || dur > 60) throw new Error('Choose a video up to 60 seconds long.');
          next.push({ type: 'video', src, dur });
        } else {
          next.push({ type: 'image', src: await resizeImage(file) });
        }
      }
      setCreateDraft({ media: next, kind: next.some(m => m.type === 'video') ? 'reel' : 'post' });
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
      <div className="chooser-card" role="dialog" aria-modal="true" aria-label="Choose what to create" onClick={e => e.stopPropagation()}>
        <div className="chooser-grip" />
        <h2>Create</h2>
        <div className="chooser-options">
          <button type="button" disabled={busy} onClick={() => { closeLayerWithoutBack(); closeCreateChooser(); router.push('/create'); }}>
            <span className="chooser-icon post">{IC.img}</span>
            <span className="chooser-copy"><b>Post</b><small>Photos, videos and text to your feed</small></span>
            <span className="chooser-go">{IC.chev}</span>
          </button>
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
            <span className="chooser-icon reel">{IC.video}</span>
            <span className="chooser-copy"><b>Reels</b><small>Pick from your gallery — clips attach automatically</small></span>
            <span className="chooser-go">{IC.chev}</span>
          </button>
        </div>
        {busy && <p className="chooser-busy" role="status">Preparing your selection…</p>}
        <button type="button" className="chooser-cancel" onClick={closeCreateChooser}>Cancel</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/*"
        multiple
        hidden
        onClick={e => e.stopPropagation()}
        onChange={e => { void pick(e.target.files); e.target.value = ''; }}
      />
    </div>,
    document.body
  );
}