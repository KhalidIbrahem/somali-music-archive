/**
 * Invite-code CLI (SESSION "private access") — mint, list, and revoke the
 * codes that gate registration, without opening the admin panel.
 *
 *   npm run invite -- create --label "University faculty — guest" --uses 1 --days 30
 *   npm run invite -- list
 *   npm run invite -- revoke QG-XXXX-XXXX
 *
 * Like promote.ts, where it acts follows the persistence mode in `.env`:
 * PERSISTENCE=database → Postgres via Prisma (including PRODUCTION when
 * POSTGRES_URL points there); otherwise the local dev store.
 */

import { loadEnvFile } from '@/config/loadEnv';
import {
  InMemoryInviteRepository,
  type InviteRepository,
} from '@/modules/invites/invite.repository';
import { generateInviteCode, inviteStatus } from '@/modules/invites/invites.service';
import { loadDevStore, saveDevStore } from '@/shared/devStore/devStore';

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`✗ ${message}`);
  process.exit(1);
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

interface Cli {
  repo: InviteRepository;
  /** Persist any mutation (dev store writes the JSON file; Prisma is a no-op). */
  flush(): Promise<void>;
  /** The admin user id to attribute created codes to. */
  adminId: string;
  disconnect(): Promise<void>;
}

async function openDatabaseCli(): Promise<Cli> {
  const { getPrisma } = await import('@/shared/db/prisma');
  const { PrismaInviteRepository } = await import('@/modules/invites/invite.prisma.repository');
  const prisma = getPrisma();
  const admin = await prisma.user.findFirst({
    where: { role: 'admin', deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    await prisma.$disconnect();
    fail('No admin user exists in the database — promote one first (npm run promote).');
  }
  return {
    repo: new PrismaInviteRepository(prisma),
    flush: async () => {},
    adminId: admin.id,
    disconnect: () => prisma.$disconnect(),
  };
}

async function openDevStoreCli(): Promise<Cli> {
  const store = loadDevStore();
  if (!store) fail('No dev store found. Run `npm run seed` first.');
  const admin = store.users.find((u) => u.role === 'admin' && !u.deletedAt);
  if (!admin) fail('No admin user in the dev store. Run `npm run seed` first.');
  const repo = new InMemoryInviteRepository();
  repo.hydrate(store.invites ?? [], store.inviteRedemptions ?? []);
  return {
    repo,
    flush: async () => {
      const { codes, redemptions } = repo.snapshot();
      saveDevStore({ ...store, invites: codes, inviteRedemptions: redemptions });
    },
    adminId: admin.id,
    disconnect: async () => {},
  };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !['create', 'list', 'revoke'].includes(command)) {
    fail('Usage: npm run invite -- <create|list|revoke> [--label …] [--uses N] [--days N] [code]');
  }

  loadEnvFile();
  const database = process.env['PERSISTENCE'] === 'database';
  if (database && !process.env['POSTGRES_URL']) {
    fail('PERSISTENCE=database but POSTGRES_URL is not set.');
  }
  const cli = database ? await openDatabaseCli() : await openDevStoreCli();
  const where = database ? 'database' : 'dev store';

  try {
    if (command === 'create') {
      const uses = Number(argValue('--uses') ?? '1');
      const days = argValue('--days');
      if (!Number.isInteger(uses) || uses < 1 || uses > 500) fail('--uses must be 1–500');
      const record = await cli.repo.create({
        code: generateInviteCode(),
        label: argValue('--label') ?? null,
        maxUses: uses,
        expiresAt: days !== undefined ? new Date(Date.now() + Number(days) * 86_400_000) : null,
        createdById: cli.adminId,
      });
      await cli.flush();
      // eslint-disable-next-line no-console
      console.log(
        `✓ Invite created (${where}): ${record.code}` +
          `\n  label: ${record.label ?? '—'}  uses: ${record.maxUses}` +
          `\n  expires: ${record.expiresAt ? record.expiresAt.toISOString() : 'never'}`,
      );
    }

    if (command === 'list') {
      const codes = await cli.repo.list();
      if (codes.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`No invite codes in the ${where}.`);
        return;
      }
      for (const code of codes) {
        // eslint-disable-next-line no-console
        console.log(
          `${code.code}  [${inviteStatus(code)}]  ${code.usedCount}/${code.maxUses} used` +
            `  ${code.label ? `— ${code.label}` : ''}`,
        );
      }
    }

    if (command === 'revoke') {
      const codeArg = process.argv[3];
      if (!codeArg || codeArg.startsWith('--')) fail('Usage: npm run invite -- revoke <code>');
      const record = await cli.repo.findByCode(codeArg);
      if (!record) fail(`No invite code "${codeArg}" in the ${where}.`);
      await cli.repo.revoke(record.id);
      await cli.flush();
      // eslint-disable-next-line no-console
      console.log(`✓ Revoked ${record.code} (${where}).`);
    }
  } finally {
    await cli.disconnect();
  }
}

await main();
