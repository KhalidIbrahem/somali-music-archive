# FABLE 5 SESSION PLAN
## Exact Build Sequence — Somali Music AI Platform
## Use this as your daily build checklist

---

## HOW THIS WORKS

Each session below = one Fable 5 conversation.
Start every session by pasting FABLE_MASTER_CONTEXT.md first.
Then paste the session prompt below.
One session per day maximum — review what was built before continuing.

Cost estimate per session: $2–8 depending on output size.
Total estimated cost for Phase 0 + 1: $50–120.

---

## PHASE 0 — FOUNDATION
### These sessions set up the project before any feature code

---

### SESSION P0-01 — Monorepo initialization

Paste FABLE_MASTER_CONTEXT.md, then:

```
We are starting Phase 0.

Create the complete monorepo structure for the Somali Music AI Platform.

Initialize:
1. Root package.json with Turborepo workspace config
2. turbo.json with build, dev, lint, test pipelines
3. .gitignore (Node, Python, Expo, MacOS)
4. .env.example files for apps/api/ and apps/mobile/
5. The complete folder skeleton from Section 10 of the context document
   — create all folders and empty index files, nothing more yet
6. GitHub Actions CI workflow (.github/workflows/ci.yml)
   — runs: lint, typecheck, test on every PR
   — Node 20, Python 3.11

Do NOT write any feature code yet.
Return: all files with their complete content.
State clearly which files you created.
```

---

### SESSION P0-02 — Expo mobile app skeleton

```
We are in Phase 0. The monorepo structure exists.

Initialize the React Native mobile app in apps/mobile/.

Create:
1. app.json — Expo config with bundle ID com.somalimusicarchive.app
2. eas.json — EAS Build config (development, preview, production profiles)
3. package.json — all dependencies from Section 3 of context document
4. tsconfig.json — strict mode
5. apps/mobile/theme/colors.ts — exact color system from Section 4
6. apps/mobile/theme/typography.ts — Playfair Display + Nunito scale
7. apps/mobile/theme/spacing.ts — 4px base grid
8. apps/mobile/theme/index.ts — re-exports all theme tokens
9. apps/mobile/app/_layout.tsx — root layout with providers,
   font loading (expo-google-fonts), safe area, navigation container
10. apps/mobile/app/(auth)/_layout.tsx — auth stack layout
11. apps/mobile/app/(tabs)/_layout.tsx — tab bar with 5 tabs:
    Discover, Learn, Search, Record (hidden unless role=contributor), Profile

Use the exact colors and typography from Section 4.
Tab bar: amber active color, dark background, Nunito labels.

Return: every file with complete content.
```

---

### SESSION P0-03 — Backend API skeleton

```
We are in Phase 0.

Initialize the Node.js backend in apps/api/.

Create:
1. package.json — all dependencies (Express, TypeScript, bcrypt,
   jsonwebtoken, mongoose, pg, redis, bullmq, zod, helmet, cors,
   express-rate-limit, winston, multer, stripe, resend, sentry)
2. tsconfig.json — strict mode, target ES2022
3. src/config/env.ts — validated env vars using zod (reads from .env)
4. src/config/constants.ts — JWT_ACCESS_EXPIRY='15m', REFRESH_EXPIRY='30d',
   BCRYPT_ROUNDS=12, MAX_UPLOAD_SIZE=524288000
5. src/app.ts — Express app factory with: helmet, cors, rate limiting,
   body parser, request logging (Winston), error handler
6. src/server.ts — starts the server, connects to MongoDB and PostgreSQL
7. src/shared/database/mongodb.ts — Mongoose connection
8. src/shared/database/postgres.ts — pg Pool connection
9. src/shared/database/redis.ts — Redis client (Upstash compatible)
10. src/shared/errors/AppError.ts — custom error class with statusCode
11. src/shared/middleware/authenticate.ts — JWT verification middleware
12. src/shared/middleware/authorize.ts — role-based access middleware

Apply every rule from Section 6 (Security Rules).
Return: every file with complete content.
```

---

### SESSION P0-04 — Database schemas and migrations

```
We are in Phase 0.

Create the complete database layer.

MongoDB (apps/api/src/shared/database/schemas/):
1. recording.schema.ts — full schema from Section 5, with indexes
2. artist.schema.ts — artist document schema
3. session.schema.ts — field recording session schema

PostgreSQL (apps/api/prisma/ or raw SQL migrations/):
1. 001_users.sql — users table from Section 5
2. 002_refresh_tokens.sql
3. 003_subscriptions.sql
4. 004_lesson_progress.sql
5. 005_saved_recordings.sql
6. 006_play_history.sql
7. 007_api_keys.sql
8. 008_pgvector.sql — vector extension + audio_embeddings table + IVFFlat index

Include all indexes specified in the architecture.
Add seed data for: 3 test users, 2 genres, 1 artist (Ahmed Ali Egal placeholder).
Return: every file with complete content.
```

---

### SESSION P0-05 — Python AI service skeleton

```
We are in Phase 0.

Initialize the Python FastAPI AI service in apps/ai-service/.

Create:
1. requirements.txt — all dependencies (fastapi, uvicorn, whisper,
   crepe, librosa, torch, torchaudio, transformers, soundfile,
   numpy, scipy, celery, redis, boto3, python-multipart, sentry-sdk)
2. main.py — FastAPI app with CORS, Sentry, health check endpoint,
   router registration
3. config.py — env var loading with pydantic Settings
4. routers/health.py — GET /health returns status + model load status
5. routers/transcribe.py — POST /transcribe (accepts recording_id + audio_url)
   returns job_id immediately, processes async
6. routers/pitch.py — POST /extract-pitch (same pattern)
7. routers/embed.py — POST /generate-embedding (same pattern)
8. models/whisper_model.py — loads whisper large-v3 once at startup
9. models/crepe_model.py — CREPE model loading
10. utils/scale_mapping.py — SOMALI_SCALE_HZ dict + hz_to_somali_note function
    (from Section 9 of context document)
11. utils/audio.py — download_audio, resample, quality_check functions
12. Dockerfile — Python 3.11, installs requirements, runs uvicorn

Return: every file with complete content.
```

---

## PHASE 1 — ARCHIVE CORE
### These sessions build the recording capability

---

### SESSION P1-01 — Authentication screens (mobile)

```
We are in Phase 1. Phase 0 is complete.
The theme system exists in apps/mobile/theme/.
The tab navigation skeleton exists.

Build the complete authentication flow for the mobile app.

Create:
1. apps/mobile/app/(auth)/welcome.tsx
   — 3 slides using React Native Reanimated
   — Slide 1: geometric star animation (5-point, amber color), tagline in Somali + English
   — Slide 2: waveform visual, "5,000 years of Somali musical tradition"
   — Slide 3: community illustration, CTA buttons (Create account / Sign in)
   — Use exact colors from theme

2. apps/mobile/app/(auth)/login.tsx
   — Email + password fields (React Hook Form + Zod)
   — "Forgot password" link
   — Biometric login option (expo-local-authentication)
   — Error states for: invalid credentials, unverified email, rate limit

3. apps/mobile/app/(auth)/register.tsx
   — Display name, email, password, confirm password (Zod validation)
   — Language preference (Somali / Arabic / English)
   — Terms of service checkbox

4. apps/mobile/services/api/auth.ts
   — login(), register(), logout(), refreshToken(), forgotPassword()
   — All call /api/v1/auth/* endpoints

5. apps/mobile/stores/authStore.ts (Zustand)
   — state: user, accessToken, isAuthenticated, isLoading
   — actions: login, logout, refreshToken, updateUser
   — persist accessToken to expo-secure-store (never AsyncStorage)

6. apps/mobile/hooks/useAuth.ts
   — wraps authStore, handles token refresh on 401

Apply Section 6 security rules (SecureStore, no AsyncStorage for tokens).
Return: every file with complete content.
```

---

### SESSION P1-02 — Auth API endpoints (backend)

```
We are in Phase 1.

Build the complete authentication API in apps/api/src/modules/auth/.

Create:
1. auth.routes.ts — all routes from Section 8 (Auth section)
2. auth.controller.ts — handlers for each route
3. auth.service.ts — business logic:
   - register(): hash password (bcrypt 12), create user, send verification email
   - login(): verify password, issue JWT (15min) + refresh token (30 days, stored hashed)
   - refresh(): verify refresh token, rotate (delete old, create new), return new pair
   - logout(): add access token to Redis blacklist, delete refresh token
   - verifyEmail(): validate token, set email_verified=true
   - forgotPassword(): generate reset token, send email via Resend
   - resetPassword(): verify token, update password hash

4. auth.middleware.ts — authenticate() middleware:
   - Extract Bearer token from Authorization header
   - Verify JWT signature and expiry
   - Check Redis blacklist (reject if present)
   - Attach user to req.user

5. auth.validators.ts — Zod schemas for all request bodies

Apply ALL rules from Section 6:
- bcrypt 12 rounds
- JWT 15min access, 30day refresh
- Refresh tokens stored hashed in PostgreSQL
- Redis blacklist for revoked access tokens
- Rate limiting: 5 attempts per 15 min per IP on login endpoint
- Account lockout after 10 failed attempts
- Email verification required before full access

Return: every file with complete content.
Include unit tests for: login success, wrong password, expired token,
blacklisted token, rate limit exceeded.
```

---

### SESSION P1-03 — Record screen (mobile)

```
We are in Phase 1. Auth is complete.

Build the field recording screen — the most important screen in the app.
This is what Khalid uses at Ahmed Ali Egal's home to capture recordings.

File: apps/mobile/app/(tabs)/record.tsx
(Role-gated: only visible to users with role 'contributor' or 'admin')

The screen has 3 states:
STATE 1 — Ready to record
  - Large centered record button (pulsing amber circle)
  - Session info at top (artist name pre-filled, date, location)
  - Instructions: "Each recording = one song. Press to begin."
  - Recording timer (00:00) below button

STATE 2 — Recording in progress
  - Button changes to stop button (red, pulsing animation via Reanimated)
  - Live timer counting up
  - Waveform visualization (animated bars reacting to audio level)
  - Warning if recording exceeds 15 minutes

STATE 3 — Post-recording (metadata form)
  - Audio playback (expo-av player with waveform)
  - Duration badge
  - Metadata form (React Hook Form + Zod):
    * Song title in Somali (required)
    * Singer name (pre-filled: "Ahmed Ali Egal")
    * Original poet name
    * Genre (dropdown: heello, qaraami, dhaanto, buraanbur, gabay, jiifto, instrumental, other)
    * Occasion (dropdown: love song, wedding, lullaby, national, protest, religious, funeral)
    * Region of origin (dropdown: Mogadishu, Hargeisa, Kismaayo, etc.)
    * Era (text: "1970s")
    * Instruments (multi-select chips: voice, oud, kaban, violin, percussion)
    * Field notes (textarea)
  - "Save to archive" button → triggers upload flow
  - "Re-record" option

Also create:
- apps/mobile/hooks/useAudioRecorder.ts
  - start(): request microphone permission, begin recording (expo-av)
  - stop(): end recording, return audio URI + duration
  - Uses WAV format at highest quality available
- apps/mobile/services/api/recordings.ts
  - getUploadUrl(): POST /api/v1/recordings/upload-url
  - uploadToR2(): PUT to presigned URL with audio blob
  - notifyComplete(): POST /api/v1/recordings/upload-complete
  - saveMetadata(): saves JSON metadata alongside

Use exact colors and typography from theme.
Use amber for all active/recording states.
Handle: microphone permission denied, upload failure, network loss.

Return: every file with complete content.
```

---

### SESSION P1-04 — Upload API + R2 integration (backend)

```
We are in Phase 1.

Build the recording upload system in apps/api/src/modules/recordings/.

Create:
1. recordings.routes.ts
2. recordings.controller.ts
3. recordings.service.ts:
   - getUploadUrl(): generate presigned R2 PUT URL
     * Random UUID filename (never original)
     * Restrict content-type to audio/* only
     * Max size: 500MB enforced at CDN level
     * Expiry: 15 minutes
     * Returns: { uploadUrl, fileKey, recordingId }
   - uploadComplete(): called after direct R2 upload
     * Verify file exists in R2
     * Enqueue BullMQ job: audio:process
     * Set recording status to "processing"
   - getRecording(): return recording with signed playback URL (1hr expiry)
   - listRecordings(): paginated, filtered by genre/region/artist/era

4. apps/api/src/shared/storage/r2.ts:
   - R2 client (boto3-compatible, S3 interface)
   - generateUploadUrl(fileKey, contentType): presigned PUT URL
   - generatePlaybackUrl(fileKey): presigned GET URL (1hr)
   - deleteFile(fileKey): soft delete (mark as deleted, don't actually delete)
   - verifyExists(fileKey): confirm file exists before processing

5. apps/api/src/shared/queue/jobs/audio.jobs.ts:
   - defineAudioProcessJob(): BullMQ job definition
   - 3 retry attempts with exponential backoff
   - 5 minute timeout
   - On failure: Sentry error + dead letter queue

Apply Section 6:
- Never accept file uploads through Node.js
- UUID filenames only
- Signed URLs expire in 1 hour
- ClamAV scan before processing
- Soft delete only

Return: every file with complete content.
```

---

### SESSION P1-05 — Archive browser (Discover tab)

```
We are in Phase 1.

Build the Discover tab — the main archive browsing experience.

Files to create:
1. apps/mobile/app/(tabs)/discover.tsx
   - Header: "Discover" in Playfair Display
   - Featured artist horizontal scroll (RecordingCard components)
   - Filter bar: All / Heello / Qaraami / Dhaanto / Instrumental
   - Vertical list of recent recordings (infinite scroll via React Query)
   - Empty state if no recordings yet

2. apps/mobile/components/archive/RecordingCard.tsx
   - Card: dark surface, amber accent
   - Title in Playfair Display
   - Artist name, duration, genre badge
   - Waveform thumbnail (static image)
   - Tap → navigate to /archive/[id]

3. apps/mobile/components/archive/ArtistCard.tsx
   - Horizontal card for featured artists section
   - Photo/avatar (geometric placeholder if no photo)
   - Name in Playfair Display
   - Recording count, era badge

4. apps/mobile/app/archive/[id].tsx — Recording detail screen
   - Title large (Playfair Display)
   - Artist name in amber
   - Metadata chips (genre, region, era, instruments)
   - Waveform visualization with audio player (expo-av)
   - Play/pause centered
   - AI transcript section (Somali + English, shows when available)
   - "About this song" (field notes from metadata)
   - "Similar recordings" (6 thumbnails from pgvector search)
   - Save/unsave button

5. apps/mobile/hooks/useAudioPlayer.ts
   - load(url): load audio from signed URL
   - play(), pause(), seek(position)
   - State: isPlaying, position, duration, isLoading

6. apps/mobile/stores/playerStore.ts (Zustand)
   - Global mini-player state
   - currentRecording, isPlaying, position

Return: every file with complete content.
```

---

## PHASE 2 SESSIONS (brief — expand same pattern)

SESSION P2-01: Learn tab + lesson module list
SESSION P2-02: Individual lesson player with audio examples
SESSION P2-03: Search screen (full-text + filter)
SESSION P2-04: User profile + settings screen
SESSION P2-05: Stripe subscription integration (checkout + webhook)
SESSION P2-06: Push notifications setup (Expo + Firebase)
SESSION P2-07: Offline audio caching (expo-file-system)
SESSION P2-08: Admin web dashboard (Next.js) — basic content management

---

## PHASE 3 SESSIONS (AI pipeline)

SESSION P3-01: Whisper transcription service (FastAPI endpoint + Celery job)
SESSION P3-02: CREPE pitch extraction + Somali scale mapping
SESSION P3-03: MERT embedding generation + pgvector storage
SESSION P3-04: Elasticsearch indexing + search API
SESSION P3-05: Similarity search ("similar recordings" feature)
SESSION P3-06: AI results display in mobile app
SESSION P3-07: Research API (API key auth, rate limiting, dataset export)
SESSION P3-08: ISMIR paper draft (give Fable your pitch data + methodology)

---

## TOKEN BUDGET GUIDE

Session type          | Estimated tokens | Estimated cost
--------------------- | ---------------- | ---------------
Simple screen         | 8,000–15,000     | $0.40–$0.75
Complex feature       | 15,000–30,000    | $0.75–$1.50
Full module (5+ files)| 30,000–60,000    | $1.50–$3.00
AI pipeline session   | 40,000–80,000    | $2.00–$4.00
Academic paper draft  | 60,000–120,000   | $3.00–$6.00

Total Phase 0 + 1: ~$40–80
Total Phase 2:     ~$30–60
Total Phase 3:     ~$40–80
Total project:     ~$110–220 with smart routing

Compare to: one Lambda Labs A100 training run = $3–6
            One McKnight Foundation grant = $25,000–150,000 income

---

## DAILY WORKFLOW

Morning:
1. Review what Fable built yesterday (read all files)
2. Test it manually (run the app, click through the feature)
3. Note any bugs or missing pieces

Afternoon (build session):
1. Open new Fable 5 conversation
2. Paste FABLE_MASTER_CONTEXT.md
3. Note current phase + task at top
4. List files that exist, files to create
5. Paste the session prompt
6. Review output carefully before accepting

Evening:
1. Commit to git (git add . && git commit -m "Phase X: [feature]")
2. Update the "current phase" line in FABLE_MASTER_CONTEXT.md
3. Check off the completed item in SECTION 11

---

## THE MASTER PROMPT TEMPLATE
## Use this every single time — fill in the blanks

```
[PASTE FABLE_MASTER_CONTEXT.md CONTENT HERE]

---

CURRENT SESSION:
Phase: [0 / 1 / 2 / 3]
Session: [P0-01 / P1-03 / etc.]
Date: [today's date]

FILES THAT ALREADY EXIST (do not recreate):
- apps/mobile/theme/colors.ts ✓
- apps/mobile/theme/typography.ts ✓
- [list everything built so far]

FILES TO CREATE THIS SESSION:
- [list from the session plan above]

TASK:
[paste the exact session prompt from above]

CONSTRAINTS:
- TypeScript strict mode — no `any`
- Apply security rules from Section 6
- Use exact colors from Section 4
- Follow folder structure from Section 10
- Include Zod validation on all inputs
- Write unit tests for all service functions

OUTPUT FORMAT:
For each file, output:
--- FILE: path/to/file.ts ---
[complete file content]
--- END FILE ---

Then: list any dependencies to install.
Then: list any env vars needed.
Then: list what to test manually.
```

---

*Khalid Ibrahim — Somali Music AI Preservation Platform*
*This document is the daily build guide. Update after each session.*
