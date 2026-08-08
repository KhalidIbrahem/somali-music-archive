import { describe, it, expect, beforeEach } from 'vitest';
import { createStudioService, type StudioService } from './studio.service';
import { InMemoryStudioRepository } from './studio.repository';

let service: StudioService;

const doc = { formatVersion: 1, tracks: [{ id: 't1', regions: [] }] };

beforeEach(() => {
  service = createStudioService({ repo: new InMemoryStudioRepository() });
});

describe('studio projects', () => {
  it('creates, lists (newest first), reads, updates, and soft-deletes', async () => {
    const a = await service.createProject('owner-1', {
      name: 'Dhaanto sketch',
      bpm: 104,
      data: doc,
    });
    const b = await service.createProject('owner-1', { name: 'Heello idea', bpm: 96, data: doc });

    const list = await service.listProjects('owner-1');
    expect(list.map((p) => p.name)).toEqual(['Heello idea', 'Dhaanto sketch']);

    const read = await service.getProject('owner-1', a.id);
    expect(read.data).toEqual(doc);
    expect(read.version).toBe(1);

    const updated = await service.updateProject('owner-1', a.id, {
      name: 'Dhaanto sketch 2',
      bpm: 110,
      data: { ...doc, bpm: 110 },
    });
    expect(updated.version).toBe(2);
    expect(updated.name).toBe('Dhaanto sketch 2');

    await service.deleteProject('owner-1', b.id);
    expect((await service.listProjects('owner-1')).map((p) => p.id)).toEqual([a.id]);
  });

  it('enforces ownership on read, write, and delete', async () => {
    const mine = await service.createProject('owner-1', { name: 'Private', bpm: 100, data: doc });
    await expect(service.getProject('intruder', mine.id)).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    await expect(
      service.updateProject('intruder', mine.id, { name: 'x', bpm: 100, data: doc }),
    ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    await expect(service.deleteProject('intruder', mine.id)).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    // The stranger never learns whether the id existed after deletion either.
    await service.deleteProject('owner-1', mine.id);
    await expect(service.getProject('intruder', mine.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
