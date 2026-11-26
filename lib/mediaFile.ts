import { Media } from './types';
import { resizeImage, uid, videoDuration } from './utils';
import { putVideo } from './videoStore';
import { API_ENABLED } from './api';
import { uploadDataUrl, uploadFile, Progress } from './upload';

export const MAX_VIDEO_MB = 150;
export const MAX_PHOTO_MB = 10;

const mb = (bytes: number) => Math.max(1, Math.round(bytes / (1024 * 1024)));

/** What a photo must already be before a picker spends time reading it. */
export function checkPhoto(file: File, maxMb = MAX_PHOTO_MB): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP image.');
  }
  if (!file.size) throw new Error('That file is empty — choose another one.');
  if (file.size > maxMb * 1024 * 1024) {
    throw new Error(`Photo must be under ${maxMb} MB — this one is ${mb(file.size)} MB.`);
  }
}

/** One photo, downscaled and stored where this build keeps media: the API or the device. */
export async function imageFromFile(file: File, onProgress?: Progress): Promise<Media> {
  const dataUrl = await resizeImageSafe(file);
  if (!API_ENABLED) return { type: 'image', src: dataUrl };
  return { type: 'image', src: await uploadDataUrl(dataUrl, file.name || 'photo.jpg', onProgress) };
}

/**
 * Profile pictures and covers, downscaled to the frame that shows them. In API mode
 * the bytes go to /api/uploads/ and only the returned URL is kept: the database
 * validates these columns as URLs, so a data URL would be refused at write time.
 */
export async function profileImage(file: File, max: number, onProgress?: Progress): Promise<string> {
  checkPhoto(file);
  const dataUrl = await resizeImageSafe(file, max);
  if (!API_ENABLED) return dataUrl;
  return uploadDataUrl(dataUrl, file.name || 'photo.jpg', onProgress);
}

async function resizeImageSafe(file: File, max = 2560): Promise<string> {
  try {
    return await resizeImage(file, max);
  } catch {
    throw new Error('This photo could not be read. Try another one.');
  }
}

/**
 * The caps a post composer holds its attachments to, straight from the console's
 * post limits desk. Left out, the shipped ceilings stand — proof screenshots,
 * listing photos and avatars are not posts and keep those.
 */
export interface MediaLimits {
  photoMb?: number;
  videoMb?: number;
  videoSeconds?: number;
}

export async function mediaFromFile(
  file: File,
  onProgress?: Progress,
  limits?: MediaLimits,
): Promise<Media> {
  const video = file.type.startsWith('video/');
  const photoMb = limits?.photoMb || MAX_PHOTO_MB;
  const videoMb = limits?.videoMb || MAX_VIDEO_MB;
  if (!video && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP photo, or a video.');
  }
  if (!file.size) throw new Error('That file is empty — choose another one.');
  if (video && file.size > videoMb * 1024 * 1024) {
    throw new Error(`Video must be under ${videoMb} MB — this one is ${mb(file.size)} MB.`);
  }
  if (!video && file.size > photoMb * 1024 * 1024) {
    throw new Error(`Photo must be under ${photoMb} MB — this one is ${mb(file.size)} MB.`);
  }
  if (!video) return imageFromFile(file, onProgress);
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
  if (limits?.videoSeconds && dur > limits.videoSeconds) {
    throw new Error(`Choose a video up to ${limits.videoSeconds} seconds long — this one runs ${Math.round(dur)}.`);
  }
  if (API_ENABLED) return { type: 'video', src: (await uploadFile(file, undefined, onProgress)).url, dur };
  const blobId = uid();
  try {
    await putVideo(blobId, file);
  } catch {
    throw new Error('This video could not be saved on your device. Free up space and try again.');
  }
  return { type: 'video', src: URL.createObjectURL(file), dur, blobId };
}