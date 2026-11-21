'use client';

import { api } from './api';

/**
 * Media storage for the API build.
 *
 * The database only ever holds URLs, so bytes are pushed to /api/uploads/ first
 * and the returned URL is what travels inside a post, listing or profile patch.
 */

export interface UploadResult {
  url: string;
  kind: 'image' | 'video';
  bytes: number;
}

export async function uploadFile(source: File | Blob, name?: string): Promise<UploadResult> {
  const file = source instanceof File ? source : toFile(source, name || guessName(source.type));
  const res = await api.upload(file);
  return { url: res.url, kind: res.kind === 'video' ? 'video' : 'image', bytes: Number(res.bytes) || file.size };
}

/** Canvas output arrives as a data URL; the API wants the bytes behind it. */
export async function uploadDataUrl(dataUrl: string, name = 'photo.jpg'): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  return (await uploadFile(blob, name)).url;
}

function toFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

function guessName(type: string): string {
  const sub = (type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/g, '');
  const video = ['mp4', 'webm', 'quicktime', 'mov'].includes(sub);
  return video ? `clip.${sub === 'quicktime' ? 'mov' : sub}` : `photo.${sub === 'jpeg' ? 'jpg' : sub || 'jpg'}`;
}
