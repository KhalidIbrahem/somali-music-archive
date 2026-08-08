/**
 * Local dev seed (SESSION "seed data"). Run with `npm run seed`.
 *
 * Populates the dev store (shared/devStore) with the accounts and sample archive a
 * developer needs to click through the app before the real databases are wired.
 * The server loads this on boot (shared/devStore/bootstrap). Re-runnable — it
 * overwrites the store each time.
 *
 * Env-free by construction: it drives the in-memory repository classes directly
 * and never imports `@/config/env`, so it runs without a populated `.env`.
 *
 * Lessons are NOT seeded here — the curriculum ships as authored content in
 * lessons.repository.ts (§7 tracks), so it already exists without a seed step.
 */

import type { RecordingCompleteMetadata } from '@sma/validators';
import { hashPassword } from '@/modules/auth/password.service';
import {
  InMemoryUserRepository,
  type CreateUserInput,
  type UserRecord,
} from '@/modules/auth/user.repository';
import { InMemoryInviteRepository } from '@/modules/invites/invite.repository';
import { InMemoryRecordingRepository } from '@/modules/recordings/recordings.repository';
import { randomUUID } from '@/shared/crypto';
import { saveDevStore } from '@/shared/devStore/devStore';

const SHARED_PASSWORD = 'SomaliArchive2024!';
/** Fixed dev invite so registering locally never needs the admin panel first. */
const DEV_INVITE_CODE = 'QG-DEV-WELCOME';

const USERS: ReadonlyArray<Omit<CreateUserInput, 'passwordHash'>> = [
  {
    email: 'admin@somalimusicarchive.com',
    username: 'admin',
    displayName: 'Archive Admin',
    language: 'so',
    role: 'admin',
  },
  {
    email: 'khalid@somalimusicarchive.com',
    username: 'khalid',
    displayName: 'Khalid Ibrahim',
    language: 'so',
    role: 'contributor',
  },
];

/** Five published sample recordings — mid-century Somali repertoire. */
const RECORDINGS: readonly RecordingCompleteMetadata[] = [
  {
    title: { somali: 'Kaana Siib Kaana Saar' },
    singerName: 'Fanaan (name withheld)',
    poetName: 'Cabdullahi Qarshe',
    genre: 'heello',
    occasion: 'Independence-era nationalist heello',
    region: 'banaadir',
    era: '1960s',
    instruments: ['oud', 'voice'],
    fieldNotes: 'Radio Mogadishu transcription; among the earliest recorded heello.',
  },
  {
    title: { somali: 'Balwo Hobalka' },
    singerName: 'Fanaan (name withheld)',
    poetName: 'Cabdi Deeqsi (Sinimo)',
    genre: 'qaraami',
    occasion: 'Balwo love lyric',
    region: 'woqooyi-galbeed',
    era: '1950s',
    instruments: ['oud', 'voice'],
    fieldNotes: 'Short balwo form; oud-led, single voice.',
  },
  {
    title: { somali: 'Hooyo Macaan' },
    singerName: 'Fanaan (name withheld)',
    genre: 'heello',
    occasion: 'Praise of the mother',
    region: 'banaadir',
    era: '1970s',
    instruments: ['oud', 'violin', 'voice'],
    fieldNotes: 'Mid-century ensemble arrangement with adopted violin.',
  },
  {
    title: { somali: 'Dhulkayaga' },
    singerName: 'Fanaan (name withheld)',
    poetName: 'Cabdullahi Qarshe',
    genre: 'qaraami',
    occasion: 'Homeland qaraami',
    region: 'banaadir',
    era: '1960s',
    instruments: ['oud', 'accordion', 'voice'],
    fieldNotes: 'Accordion doubling the melodic line, typical of the era.',
  },
  {
    title: { somali: 'Jacayl Dhiig Ma Lagu Qoray' },
    singerName: 'Fanaan (name withheld)',
    genre: 'heello',
    occasion: 'Love heello',
    region: 'woqooyi-galbeed',
    era: '1970s',
    instruments: ['oud', 'voice'],
    fieldNotes: 'Well-known love heello; poem widely attributed in oral tradition.',
  },
];

async function seedUsers(): Promise<UserRecord[]> {
  const repo = new InMemoryUserRepository();
  const passwordHash = await hashPassword(SHARED_PASSWORD);
  for (const user of USERS) {
    const record = await repo.create({ ...user, passwordHash });
    // Seed accounts are trusted — mark verified so they get full access (§11).
    await repo.markEmailVerified(record.id);
  }
  return repo.snapshot();
}

async function seedRecordings(): Promise<InMemoryRecordingRepository> {
  const repo = new InMemoryRecordingRepository();
  for (const metadata of RECORDINGS) {
    const { recordingId } = await repo.createDraft({
      fileKey: `recordings/seed/${randomUUID()}.wav`,
      format: 'wav',
      sessionId: 'seed',
    });
    await repo.complete(recordingId, metadata);
    // Publish so they appear in the public archive + search (§12).
    await repo.updateModeration(recordingId, { status: 'published', visibility: 'public' });
  }
  return repo;
}

async function seedInvites(adminId: string): Promise<InMemoryInviteRepository> {
  const repo = new InMemoryInviteRepository();
  await repo.create({
    code: DEV_INVITE_CODE,
    label: 'Local development — shared invite',
    maxUses: 100,
    expiresAt: null,
    createdById: adminId,
  });
  return repo;
}

async function main(): Promise<void> {
  const users = await seedUsers();
  const recordingsRepo = await seedRecordings();
  const recordings = recordingsRepo.snapshot();
  const admin = users.find((u) => u.role === 'admin');
  const inviteRepo = await seedInvites(admin?.id ?? users[0]?.id ?? 'seed-admin');
  const { codes: invites, redemptions: inviteRedemptions } = inviteRepo.snapshot();

  saveDevStore({ users, recordings, invites, inviteRedemptions });

  // eslint-disable-next-line no-console
  console.log(
    [
      '✓ Seeded dev store:',
      `  ${users.length} users:`,
      ...users.map(
        (u) => `    • ${u.email} (${u.username ?? '—'}, ${u.role}) — password: ${SHARED_PASSWORD}`,
      ),
      `  ${recordings.length} published sample recordings (artist name withheld)`,
      `  1 invite code for local registration: ${DEV_INVITE_CODE} (100 uses)`,
      '  (lessons ship as authored content in lessons.repository.ts — not seeded here)',
      '',
      '  Start the API (npm run dev) to load this data.',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('✗ Seed failed:', error);
  process.exit(1);
});
