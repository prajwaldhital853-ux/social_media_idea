import { Media } from './types';
import { resizeImage, uid, videoDuration } from './utils';
import { putVideo } from './videoStore';
import { API_ENABLED } from './api';
import { uploadDataUrl, uploadFile } from './upload';

export const MAX_VIDEO_MB = 150;
export const MAX_PHOTO_MB = 10;

const mb = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));

/** One photo, downscaled and stored where this build keeps media: the API or the device. */
export async function imageFromFile(file: File): Promise<Media> {
  const dataUrl = await resizeImageSafe(file);
  if (!API_ENABLED) return { type: 'image', src: dataUrl };
  return { type: 'image', src: await uploadDataUrl(dataUrl) };
}

async function resizeImageSafe(file: File): Promise<string> {
  try {
    return await resizeImage(file);
  } catch {
    throw new Error('This photo could not be read. Try another one.');
  }
}

export async function mediaFromFile(file: File): Promise<Media> {
  const video = file.type.startsWith('video/');
  if (!video && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP photo, or a video.');
  }
  if (!file.size) throw new Error('That file is empty — choose another one.');
  if (video && file.size > MAX_VIDEO_MB * 1024 * 1024) {
    throw new Error(`Video must be under ${MAX_VIDEO_MB} MB — this one is ${mb(file.size)} MB.`);
  }
  if (!video && file.size > MAX_PHOTO_MB * 1024 * 1024) {
    throw new Error(`Photo must be under ${MAX_PHOTO_MB} MB — this one is ${mb(file.size)} MB.`);
  }
  if (!video) return imageFromFile(file);
  const src = URL.createObjectURL(file);
  let dur = 0;
  try {
    const seconds = await videoDuration(src);
    dur = Number.isFinite(seconds) ? seconds : 0;
  } catch {
    throw new Error('This video could not be read. Try another clip.');
  } finally {
    URL.revokeObjectURL(src);
  }
  if (API_ENABLED) return { type: 'video', src: (await uploadFile(file)).url, dur };
  const blobId = uid();
  try {
    await putVideo(blobId, file);
  } catch {
    throw new Error('This video could not be saved on your device. Free up space and try again.');
  }
  return { type: 'video', src: URL.createObjectURL(file), dur, blobId };
}