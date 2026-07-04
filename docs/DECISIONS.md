# Architecture Decision Record (ADR)

A running log of notable engineering decisions — especially where the
implementation **deviates from or sharpens** `ARCHITECTURE.md`. `ARCHITECTURE.md`
remains the source of truth for *intent*; this file records *how* and *why* the
build differs in practice. Newest entries at the bottom.

Format per entry: **Context → Decision → Consequences.**

---

## ADR-0001 — Shared packages are raw-TypeScript "just-in-time" packages

**Context.** The monorepo has three shared packages (`@sma/constants`, `@sma/types`,
`@sma/validators`) consumed by four very different toolchains (Metro/Expo, Next.js,
Node/tsup, tsc).

**Decision.** Ship them as raw `.ts` with `main`/`types` pointing at `src/index.ts`
and no build step. Each consumer compiles them with its own toolchain
(`transpilePackages` in Next, `noExternal` in tsup, Metro natively).

**Consequences.** No stale compiled artifact can drift from source; a type/validator
change propagates instantly everywhere. Cost: consumers must be told to transpile
them (done in each app's config). `@sma/types` emits nothing at runtime; the other
two do (constants data, Zod schemas).

---

## ADR-0002 — Branded ID types (`Uuid`, `ObjectIdString`, `IsoDateTimeString`)

**Context.** The platform mixes PostgreSQL UUIDs and MongoDB ObjectId strings; both
are `string` at runtime and trivially confusable.

**Decision.** Brand them as compile-time-only nominal types in `@sma/types`. Casts
are confined to the DB↔domain boundary via `apps/api/src/shared/brand.ts`.

**Consequences.** Passing a user id where a recording id is expected is a compile
error, at zero runtime cost. Slight ergonomic tax at the trust boundary (one cast
site), which is exactly where a real runtime validator can later be dropped in.

---

## ADR-0003 — Logging: pino instead of Winston

**Context.** The stack table (`ARCHITECTURE.md` §5, §8) names **Winston** for
"structured JSON logs".

**Decision.** Use **pino** (+ `pino-http`) instead.

**Consequences.** Same goal — structured JSON logs ingestible by Grafana/Loki — with
lower overhead and first-class HTTP request logging and redaction. This is a
deliberate substitution; if a hard Winston requirement emerges, the `logger`
module is the single swap point. Secret/PII redaction is configured centrally.

---

## ADR-0004 — Production bundling with tsup/esbuild (API)

**Context.** The API imports raw-TS workspace packages (ADR-0001). A plain `tsc`
build would emit `import '@sma/types'` that Node cannot resolve at runtime (the
package is `.ts`).

**Decision.** Type-check with `tsc --noEmit`; produce the runtime artifact with
**tsup** (`noExternal: [/@sma\//]`), which inlines the workspace packages into a
self-contained `dist/server.js`. Dev uses `tsx watch`.

**Consequences.** `node dist/server.js` needs no transpiler and no `.js` import
extensions in source. Type safety and runtime packaging are cleanly separated.

---

## ADR-0005 — Repository interfaces with in-memory implementations for Phase 0

**Context.** This session (P0-01) scaffolds the platform before databases are
provisioned. The auth flow and recording endpoints should still run and be tested.

**Decision.** Define `UserRepository` / `RecordingRepository` **interfaces**; ship
in-memory implementations now. Prisma (PostgreSQL, see `apps/api/prisma/schema.prisma`)
and Mongoose (MongoDB) implementations replace them in Phase 1/2 behind the same
interface — no service changes.

**Consequences.** The API boots and passes integration tests with zero
infrastructure (`Principle 6` — extractable later, no rewrite). The in-memory store
is non-persistent by design. Auth-hardening TODOs that need real stores (refresh
token rows, Redis access-token blacklist, login timing-attack mitigation) are
marked in-code where they attach.

---

## ADR-0006 — PostgreSQL via Prisma; content metadata via Mongoose

**Context.** `ARCHITECTURE.md` §17 shows a `prisma/` folder; §9 mixes MongoDB
documents (content) with PostgreSQL tables (users/business) and §11 mentions
"Mongoose strict schema".

**Decision.** Prisma owns the relational PostgreSQL schema; Mongoose owns the
MongoDB content documents. `pgvector`'s `vector(768)` column is added via a raw SQL
migration (Prisma has no native vector type).

**Consequences.** Each database uses the tool best suited to it. The Prisma schema
is the canonical PG definition and mirrors §9 exactly (soft-delete columns, UUID PKs).

---

## ADR-0007 — `validate()` reuses `@sma/validators` schemas on the server

**Context.** CLAUDE.md hard rule: "Zod validation on every single API input." The
mobile/web forms also validate with Zod.

**Decision.** One set of Zod schemas in `@sma/validators` is the single source of
truth, used by the API's `validate()` middleware **and** the client forms (React
Hook Form). The middleware replaces raw request parts with parsed/coerced values.

**Consequences.** Client and server reject exactly the same bad input; a schema
change updates both at once. Validation failures serialize to the shared
`VALIDATION_ERROR` envelope with per-field messages.

---

## ADR-0008 — `docker-compose.yml` at the repository root

**Context.** §17 lists `infrastructure/docker-compose.yml`, but the documented local
workflow (§13) runs `docker compose up -d` from the repo root.

**Decision.** Place the dev compose file at the root so the documented command works
with no `-f` flag. Elasticsearch is behind a `search` profile (heavy; opt-in).

**Consequences.** Frictionless local start (`docker compose up -d` = Mongo + Postgres
+ Redis). A `docker-compose.prod.yml` and `infrastructure/nginx/` are added when
production deployment is set up.

---

## ADR-0009 — Lazy ML model loading in the AI service

**Context.** Whisper/CREPE/MERT + torch are multi-gigabyte and slow to import; the
scale-mapping logic (the research core) is pure Python.

**Decision.** Import heavy libraries **inside** the task/loader functions
(`models/registry.py`, router task bodies), never at module import. Keep
`services/scale.py` stdlib-only.

**Consequences.** The service boots instantly, the health check is cheap, and the
research-critical scale/cents math is unit-tested in CI without installing torch.

---

## ADR-0010 — Singing detection via Whisper's own hallucination signals

**Context.** Whisper was trained on speech. On sung material (heello melisma,
buraanbur metre) it hallucinates fluent text that was never sung; storing that as
a "transcript" would poison the research corpus (P3-01).

**Decision.** Classify each recording as `is_singing` using Whisper's per-segment
self-diagnostics — `no_speech_prob > 0.6`, `compression_ratio > 2.4` (loop
hallucination), `avg_logprob < −1.0` — with a flagged-majority vote across
segments. Thresholds mirror Whisper's own decoder-fallback values and live as
named constants in `services/transcription_service.py`, pure and unit-tested with
synthetic segments. Transcript cleaning is conservative (fixed stage-tag
allowlist; repeats CAPPED at two, never deduplicated — Somali refrains are real).

**Consequences.** Sung recordings ship transcripts marked advisory rather than
silently wrong — itself a citable methodology point for the ISMIR dataset paper.
Thresholds are refined empirically against Ahmed Ali Egal's recordings, the same
governance as the scale table (services/scale.py).

---

## ADR-0011 — Dual-mode job queue: Celery in production, BackgroundTasks in dev

**Context.** Transcription is minutes of GPU/CPU work needing retries, timeouts,
and horizontal scale (§8) — but development should not require Redis.

**Decision.** One sync pipeline function (`run_transcription_job`) with two
dispatchers: `USE_CELERY=true` sends a Celery task (3 retries, exponential
backoff, 10-minute hard limit, acks-late, Sentry on final failure); otherwise the
router runs the same function on Starlette's background thread pool. Celery is
imported lazily so the dev/test import graph never touches it.

**Consequences.** Dev and prod execute identical logic (no behavioural drift);
the event loop is never blocked (sync fn → thread pool); tests exercise the
pipeline pieces with zero infrastructure (ADR-0005 pattern).
