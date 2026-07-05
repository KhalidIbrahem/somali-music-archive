# Database setup (enabling `PERSISTENCE=database`)

By default the API runs on in-memory repositories (`PERSISTENCE=memory`) — zero
infrastructure, used by tests and local dev. To switch to the real databases
(Postgres via Prisma, MongoDB via Mongoose, pgvector for embeddings), do the
following. **None of these steps are run automatically; they touch live data.**

## 1. Configure the environment

In `apps/api/.env` (git-ignored — never put real secrets in `.env.example`):

```
PERSISTENCE=database
POSTGRES_URL=postgresql://USER:PASSWORD@HOST:5432/DB
MONGODB_URI=mongodb+srv://USER:PASSWORD@HOST/DB
```

The repositories read `PERSISTENCE` to decide which backend to bind
(`src/shared/db/driver.ts`). Under `NODE_ENV=test` the in-memory repositories are
always used, so the test suite never needs a database.

`npm run dev` (and `npm start`) load `apps/api/.env` automatically at boot
(`src/config/bootstrapEnv.ts`) — no exporting variables by hand. Real shell/CI
environment variables always take precedence over the file.

## 2. Create the Postgres schema

```bash
cd apps/api
npx prisma generate                 # also runs automatically on npm install
npx prisma migrate deploy           # applies prisma/migrations to POSTGRES_URL
```

For a brand-new database with no migration history yet, create the first
migration from `schema.prisma`:

```bash
npx prisma migrate dev --name init
```

Tables created: `users`, `verification_tokens`, `refresh_tokens`, `subscriptions`,
`lesson_progress`, `saved_recordings`, `play_history`, `api_keys`.

## 3. Add the pgvector table (embeddings)

Prisma has no native `vector` type (ADR-0006), so the embeddings table is raw SQL:

```bash
psql "$POSTGRES_URL" -f prisma/sql/008_pgvector.sql
```

This creates the `vector` extension, the `audio_embeddings` table, and the IVFFlat
cosine index used by the pgvector embeddings repository.

## 4. MongoDB

No migration step — the `recordings` collection and its indexes are created by
Mongoose on first write. Just point `MONGODB_URI` at a reachable database.

## 5. Run

```bash
npm run dev
```

On boot the server opens both connections up front (fail-fast) and logs
`Postgres (Prisma) connected` / `MongoDB (Mongoose) connected`.

## Notes

- `npm run seed` / `npm run promote` write to the **dev JSON store**
  (`.data/dev-store.json`), which only feeds the in-memory repositories. They are
  a `PERSISTENCE=memory` convenience; seeding the real databases is a separate
  concern (create the admin via the register endpoint, then `promote` once a
  database-backed promote script exists).
- Not yet database-backed: notification device tokens (no Prisma model yet) and
  play history / API keys (models exist, repositories not built — P3-07).
