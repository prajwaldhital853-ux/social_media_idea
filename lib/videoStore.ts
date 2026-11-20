import { Database, Media } from './types';

const DB_NAME = 'exposing-media';
const STORE = 'videos';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putVideo(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}

async function getVideo(id: string): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as Blob) || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

async function allKeys(): Promise<string[]> {
  const db = await openDb();
  const keys = await new Promise<string[]>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result as string[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return keys;
}

async function removeVideo(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const referenced = (db: Database): Media[] =>
  db.posts.flatMap(p => p.media || []).filter(m => m.blobId);

export async function hydrateVideoSrcs(db: Database): Promise<Map<string, string>> {
  const srcs = new Map<string, string>();
  if (typeof indexedDB === 'undefined') return srcs;
  const refs = referenced(db);
  const kept = new Set(refs.map(m => m.blobId as string));
  const orphans = (await allKeys()).filter(k => !kept.has(k));
  await Promise.all(orphans.map(removeVideo));
  await Promise.all(refs.filter(m => !m.src).map(async m => {
    const blob = await getVideo(m.blobId as string);
    if (blob) srcs.set(m.blobId as string, URL.createObjectURL(blob));
  }));
  return srcs;
}