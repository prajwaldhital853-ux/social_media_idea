import { Media } from './types';

export interface CreateDraft {
  media: Media[];
  kind: 'post' | 'reel';
}

let pending: CreateDraft | null = null;

export const setCreateDraft = (draft: CreateDraft) => { pending = draft; };

export const takeCreateDraft = (): CreateDraft | null => {
  const draft = pending;
  pending = null;
  return draft;
};