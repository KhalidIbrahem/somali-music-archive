/**
 * Studio service (Stage 5) — owner-scoped CRUD over DAW projects. Ownership is
 * enforced here (the repository is ownership-blind): every read/write checks
 * the record's ownerId against the caller.
 */

import { forbidden, notFound } from '@/shared/errors/AppError';
import { asIso } from '@/shared/brand';
import type { StudioProjectSaveInput } from '@sma/validators';
import {
  studioRepository,
  type StudioProjectRecord,
  type StudioRepository,
} from './studio.repository';

export interface StudioProjectSummaryView {
  id: string;
  name: string;
  bpm: number;
  updatedAt: string;
}

export interface StudioProjectView extends StudioProjectSummaryView {
  data: unknown;
  version: number;
}

function toSummary(record: StudioProjectRecord): StudioProjectSummaryView {
  return {
    id: record.id,
    name: record.name,
    bpm: record.bpm,
    updatedAt: asIso(record.updatedAt),
  };
}

function toView(record: StudioProjectRecord): StudioProjectView {
  return { ...toSummary(record), data: record.data, version: record.version };
}

export function createStudioService(deps: { repo: StudioRepository }) {
  const { repo } = deps;

  /** zod's z.unknown() infers `data` as optional — pin it to a concrete value. */
  const toWrite = (input: StudioProjectSaveInput) => ({
    name: input.name,
    bpm: input.bpm,
    data: input.data ?? null,
  });

  async function ownedRecord(userId: string, id: string): Promise<StudioProjectRecord> {
    const record = await repo.findById(id);
    if (!record) throw notFound('NOT_FOUND', 'Project not found');
    if (record.ownerId !== userId) throw forbidden('This project belongs to another member');
    return record;
  }

  async function listProjects(userId: string): Promise<StudioProjectSummaryView[]> {
    return (await repo.listByOwner(userId)).map(toSummary);
  }

  async function getProject(userId: string, id: string): Promise<StudioProjectView> {
    return toView(await ownedRecord(userId, id));
  }

  async function createProject(
    userId: string,
    input: StudioProjectSaveInput,
  ): Promise<StudioProjectView> {
    const record = await repo.create(userId, toWrite(input));
    return toView(record);
  }

  async function updateProject(
    userId: string,
    id: string,
    input: StudioProjectSaveInput,
  ): Promise<StudioProjectView> {
    await ownedRecord(userId, id);
    const updated = await repo.update(id, toWrite(input));
    if (!updated) throw notFound('NOT_FOUND', 'Project not found');
    return toView(updated);
  }

  async function deleteProject(userId: string, id: string): Promise<void> {
    await ownedRecord(userId, id);
    await repo.softDelete(id);
  }

  return { listProjects, getProject, createProject, updateProject, deleteProject };
}

export type StudioService = ReturnType<typeof createStudioService>;

export const studioService: StudioService = createStudioService({ repo: studioRepository });
