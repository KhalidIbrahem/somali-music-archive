/**
 * Project persistence (Stage 5 Tier 1) — offline-safe by design.
 *
 * IndexedDB is the editing source of truth (autosave lands here, works with
 * no network); the server copy (/api/v1/studio/projects) syncs in the
 * background so compositions follow the member and feed the dashboard.
 * Conflict rule (single-author platform): newest updatedAt wins.
 * Server ids: a project created offline keeps its local uuid; the server
 * assigns its own id on first push, which we adopt and remap locally.
 */

import {
  deleteStudioProject,
  getStudioProject,
  listStudioProjects,
  saveStudioProject,
} from '@/lib/api';
import type { DawProject } from './types';

const DB_NAME = 'qaraami-studio';
const STORE = 'projects';

interface StoredProject {
  /** Local key — equals the server id once the project has synced. */
  id: string;
  project: DawProject;
  /** Server id when known; absent while the project is local-only. */
  serverId?: string | undefined;
  /** Set when a local change has not reached the server yet. */
  dirty: boolean;
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
    request.onerror = () => reject(request.error as Error);
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as Error);
    transaction.oncomplete = () => db.close();
  });
}

export async function localList(): Promise<StoredProject[]> {
  return tx('readonly', (store) => store.getAll() as IDBRequest<StoredProject[]>);
}

export async function localGet(id: string): Promise<StoredProject | null> {
  const found = await tx(
    'readonly',
    (store) => store.get(id) as IDBRequest<StoredProject | undefined>,
  );
  return found ?? null;
}

export async function localPut(entry: StoredProject): Promise<void> {
  await tx('readwrite', (store) => store.put(entry));
}

export async function localDelete(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

/** Save an edit locally (instant, offline-safe); marks it dirty for sync. */
export async function saveLocal(project: DawProject, serverId?: string): Promise<void> {
  const existing = await localGet(project.id);
  await localPut({
    id: project.id,
    project,
    dirty: true,
    ...((serverId ?? existing?.serverId) ? { serverId: serverId ?? existing?.serverId } : {}),
  });
}

/**
 * Push one dirty project to the server. Returns the (possibly re-keyed)
 * local id. Network failures leave the entry dirty — sync retries later.
 */
export async function pushToServer(localId: string): Promise<string> {
  const entry = await localGet(localId);
  if (!entry) return localId;
  const { project } = entry;
  const saved = await saveStudioProject({
    ...(entry.serverId !== undefined ? { id: entry.serverId } : {}),
    name: project.name,
    bpm: project.bpm,
    data: project,
  });
  if (saved.id !== entry.id) {
    // Adopt the server id as the canonical key everywhere.
    const rekeyed: DawProject = { ...project, id: saved.id };
    await localDelete(entry.id);
    await localPut({ id: saved.id, project: rekeyed, serverId: saved.id, dirty: false });
    return saved.id;
  }
  await localPut({ ...entry, serverId: saved.id, dirty: false });
  return entry.id;
}

export interface ProjectListing {
  id: string;
  name: string;
  bpm: number;
  updatedAt: string;
  location: 'local' | 'synced' | 'server';
}

/** Union of local and server projects for the open dialog. */
export async function combinedList(): Promise<ProjectListing[]> {
  const locals = await localList();
  let server: { id: string; name: string; bpm: number; updatedAt: string }[] = [];
  try {
    server = await listStudioProjects();
  } catch {
    // Offline — local list still works.
  }
  const byId = new Map<string, ProjectListing>();
  for (const remote of server) {
    byId.set(remote.id, { ...remote, location: 'server' });
  }
  for (const local of locals) {
    const key = local.serverId ?? local.id;
    byId.set(key === local.id ? local.id : key, {
      id: local.id,
      name: local.project.name,
      bpm: local.project.bpm,
      updatedAt: local.project.updatedAt,
      location: local.serverId ? 'synced' : 'local',
    });
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Open by id: prefer the newest of local/server copies. */
export async function openProject(id: string): Promise<DawProject | null> {
  const local = await localGet(id);
  let remote: { data: unknown } | null = null;
  try {
    remote = await getStudioProject(local?.serverId ?? id);
  } catch {
    remote = null;
  }
  const remoteProject =
    remote && typeof remote.data === 'object' && remote.data !== null
      ? (remote.data as DawProject)
      : null;
  if (local && remoteProject) {
    return local.project.updatedAt >= remoteProject.updatedAt ? local.project : remoteProject;
  }
  if (local) return local.project;
  if (remoteProject) {
    await localPut({ id: remoteProject.id, project: remoteProject, serverId: id, dirty: false });
    return remoteProject;
  }
  return null;
}

export async function removeProject(localId: string): Promise<void> {
  const entry = await localGet(localId);
  await localDelete(localId);
  if (entry?.serverId) {
    try {
      await deleteStudioProject(entry.serverId);
    } catch {
      // Offline — the server copy outlives; acceptable for Tier 1.
    }
  }
}
