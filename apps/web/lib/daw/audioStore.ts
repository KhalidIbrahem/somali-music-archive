/**
 * User audio store (Studio v2) — imports and recordings live in this
 * browser's IndexedDB (DB 'qaraami-studio-audio'), never inside the project
 * document. A region references a blob as `idb:<id>`.
 *
 * Audio never leaves the device from here: nothing in this module uploads.
 */

const DB_NAME = 'qaraami-studio-audio';
const STORE = 'audio';
const PREFIX = 'idb:';

interface StoredAudio {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  blob: Blob;
}

export interface AudioListing {
  source: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

export function isIdbSource(source: string): boolean {
  return source.startsWith(PREFIX) && source.length > PREFIX.length;
}

/** 'idb:<id>' → '<id>' (null for any other source). */
export function idbIdOf(source: string): string | null {
  return isIdbSource(source) ? source.slice(PREFIX.length) : null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    // Resolve on commit so a write is durable before callers rely on it.
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

function newAudioId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Store a blob; returns its region source, 'idb:<id>'. */
export async function putAudio(blob: Blob, name: string): Promise<string> {
  const entry: StoredAudio = {
    id: newAudioId(),
    name,
    type: blob.type,
    size: blob.size,
    createdAt: new Date().toISOString(),
    blob,
  };
  await tx('readwrite', (store) => store.put(entry));
  return `${PREFIX}${entry.id}`;
}

export async function getAudio(source: string): Promise<Blob | null> {
  const id = idbIdOf(source);
  if (id === null) return null;
  const found = await tx(
    'readonly',
    (store) => store.get(id) as IDBRequest<StoredAudio | undefined>,
  );
  return found?.blob ?? null;
}

export async function deleteAudio(source: string): Promise<void> {
  const id = idbIdOf(source);
  if (id === null) return;
  await tx('readwrite', (store) => store.delete(id));
}

/** Every stored blob's metadata, newest first. */
export async function listAudio(): Promise<AudioListing[]> {
  const all = await tx('readonly', (store) => store.getAll() as IDBRequest<StoredAudio[]>);
  return all
    .map((e) => ({
      source: `${PREFIX}${e.id}`,
      name: e.name,
      type: e.type,
      size: e.size,
      createdAt: e.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
