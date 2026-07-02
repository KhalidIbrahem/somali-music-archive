# SOMALI MUSIC AI PRESERVATION PLATFORM
## Master Context Document — Pre-Fable Build Preparation
### Feed this entire document to Fable 5 at the start of every build session
### Author: Khalid Ibrahim | Version 1.0 | July 2026

---

## HOW TO USE THIS DOCUMENT WITH FABLE 5

This document is your single source of truth.
Every Fable 5 session begins with:
"Read this entire document before writing a single line of code.
Confirm you understand the mission, the stack, the security model,
and the current phase. Then ask ONE clarifying question if needed.
Then build."

Never start a Fable session without this document loaded.
Never ask Fable to "continue from last time" — always reload context.
The 1M token window fits this document + your entire codebase + your question.

---

## SECTION 1 — THE MISSION (read this first, always)

You are building the world's first AI-powered archive and learning platform
for Somali traditional music. This is not a generic music app.

The recordings being collected are from Ahmed Ali Egal — a founding member
of the Waaberi Band, Somalia's national cultural institution (1944–1991).
He is 80 years old and living in Minneapolis, Minnesota.
The songs he carries exist nowhere else on earth.
When he is gone, they are gone.

This platform prevents that.

Three goals — all three must be achieved:
1. PRESERVE — Record, archive, and protect Somali traditional music permanently
2. TEACH — Help Somali diaspora children learn their musical heritage
3. RESEARCH — Build the first labeled Somali music AI dataset for academic use

The platform earns money through subscriptions, institutional licenses,
grant funding, and dataset licensing to AI companies.
The dataset's commercial value is estimated at $500,000–$2,000,000
once it reaches 1,000 high-quality labeled recordings.

---

## SECTION 2 — THE BUILDER

Name: Khalid Ibrahim
Background: Somali-American full stack developer and AI engineer
Location: Minneapolis, Minnesota
Education: BS in Computer Science and Electrical Engineering (Turkey, 2022)
Skills: JavaScript, TypeScript, React Native, Next.js, Node.js, Python,
        MongoDB, PostgreSQL, AI/ML pipelines
Musical background: Formally trained oud player (Turkish tradition),
                    learning Somali traditional music from Ahmed Ali Egal
Role: Founder, lead developer, researcher, cultural liaison
Vision: First Somali researcher to apply AI to Somali traditional music.
        Pioneer of ethical AI preservation methodology for oral traditions.

---

## SECTION 3 — THE COMPLETE TECHNOLOGY STACK

### Mobile App (primary product)
- Framework: React Native 0.74+ with Expo SDK 51+
- Language: TypeScript (strict mode — no `any`, ever)
- Navigation: Expo Router v3 (file-based routing)
- State: Zustand (global) + React Query (server/cache)
- UI: Custom design system — no third-party component libraries
- Styling: StyleSheet API + custom theme tokens
- Audio playback: expo-av
- Audio recording: expo-av + expo-file-system
- Offline: expo-sqlite + expo-file-system (audio cache)
- Push notifications: expo-notifications + Firebase Cloud Messaging
- Animations: React Native Reanimated v3
- Gestures: React Native Gesture Handler
- Forms: React Hook Form + Zod validation
- HTTP: Axios with interceptors + React Query
- Auth tokens: expo-secure-store (hardware keychain — never AsyncStorage)
- Biometrics: expo-local-authentication
- Analytics: PostHog
- Crashes: Sentry
- OTA updates: Expo Updates
- Builds: EAS Build

### Web App (secondary)
- Framework: Next.js 14+ (App Router)
- Language: TypeScript
- Styling: Tailwind CSS
- Auth: NextAuth.js v5
- Hosting: Vercel

### Backend API
- Runtime: Node.js 20 LTS
- Framework: Express.js 4 + express-validator
- Language: TypeScript
- Auth: JWT (15min) + refresh tokens (30 days) + Redis blacklist
- Passwords: bcrypt (rounds: 12)
- Rate limiting: express-rate-limit + Redis
- File uploads: presigned R2 URLs (never through Node.js)
- Email: Resend
- Jobs: BullMQ + Redis
- Logging: Winston (structured JSON)

### Python AI Service
- Runtime: Python 3.11+
- Framework: FastAPI
- Audio analysis: librosa 0.10+
- Pitch detection: CREPE (viterbi=True, step_size=10ms)
- Speech transcription: OpenAI Whisper large-v3 (runs locally on M4 Pro)
- Audio ML: PyTorch 2.0 + HuggingFace Transformers
- Foundation model: MERT-v1-95M (768-dimensional embeddings)
- Vector search: FAISS + pgvector
- Jobs: Celery + Redis
- Experiment tracking: Weights & Biases

### Databases
- Metadata: MongoDB 7+ (Atlas) — flexible cultural metadata
- Users/subscriptions: PostgreSQL 16 (Supabase)
- Vector embeddings: pgvector on PostgreSQL
- Search: Elasticsearch 8+ (or Typesense budget option)
- Cache/sessions: Redis 7+ (Upstash)
- Audio storage: Cloudflare R2 (zero egress fees — critical for audio)
- CDN: Cloudflare

### Infrastructure
- Mobile builds: EAS Build
- API: Railway (early) → AWS ECS (scale)
- AI service: Modal.com GPU inference → AWS GPU (scale)
- CI/CD: GitHub Actions
- Containers: Docker + Docker Compose
- Secrets: Doppler
- Monitoring: Sentry + BetterUptime

---

## SECTION 4 — DESIGN SYSTEM (implement exactly as specified)

### Colors
```typescript
export const colors = {
  bg: {
    primary:   '#0C0B14',  // near-black with warm purple undertone
    secondary: '#161524',  // card surfaces
    tertiary:  '#201E33',  // elevated elements
    inverse:   '#EDE9DC',  // onboarding
  },
  amber: {
    primary:   '#C89B5F',  // oud-wood amber — the signature color
    light:     '#E5C48A',
    dim:       '#7A5C2E',
    subtle:    '#2A1F0E',
  },
  blue: {
    primary:   '#4189D4',  // Somali flag blue
    light:     '#6BABEC',
    dim:       '#1A4B82',
    subtle:    '#0A1E38',
  },
  success: '#5AB88A',
  warning: '#E8B84B',
  error:   '#E05A5A',
  info:    '#5A9BE0',
  text: {
    primary:   '#EDE9DC',  // warm white
    secondary: '#9B97B0',
    tertiary:  '#5C5A74',
    inverse:   '#0C0B14',
  },
  border: {
    primary:   '#2D2B45',
    secondary: '#1E1D30',
    focus:     '#C89B5F',  // always amber on focus
  },
} as const;
```

### Typography
- Display font: Playfair Display (song titles, artist names, hero text)
- Body font: Nunito (all UI chrome and content)
- Display large: PlayfairDisplay_700Bold, 32px, lineHeight 40
- Body medium: Nunito_400Regular, 14px, lineHeight 22
- Label: Nunito_600SemiBold, 11px, lineHeight 14

### Spacing (base 4px grid)
- xs: 4 | sm: 8 | md: 12 | base: 16 | lg: 20 | xl: 24 | xxl: 32

---

## SECTION 5 — DATABASE SCHEMAS

### MongoDB — Recording document (the core data unit)
```javascript
{
  _id: ObjectId,
  id: String,              // "2024-01-15-AAE-001"
  fileKey: String,         // R2 object key (UUID — never original filename)
  fileUrl: String,         // CDN URL
  waveformUrl: String,
  duration: Number,        // seconds (extracted, not trusted from client)
  fileSize: Number,
  format: String,          // "wav" | "webm" | "flac"
  sampleRate: Number,
  title: {
    somali: String,
    transliteration: String,
    english: String,
  },
  artist: { id: ObjectId, name: String },
  poet: { name: String, notes: String },
  genre: String,   // "heello"|"qaraami"|"dhaanto"|"buraanbur"|"gabay"|"jiifto"|"instrumental"|"other"
  occasion: String,
  instruments: [String],
  language: String,        // "so"|"ar"|"sw"
  region: String,
  era: String,
  session: {
    id: String,
    date: Date,
    location: String,
    recorder: String,
    consentFileKey: String,
  },
  ai: {
    status: String,        // "pending"|"processing"|"complete"|"failed"
    transcriptSomali: String,
    transcriptEnglish: String,
    musicDescription: String,
    pitchData: [{ timeSec, frequencyHz, noteLabel, centsDeviation }],
    embeddingId: String,
    genre_predicted: String,
    quality: String,
    processedAt: Date,
  },
  visibility: String,      // "public"|"restricted"|"private"
  license: String,         // "CC-BY-4.0"|"CC-BY-NC-4.0"|"all-rights-reserved"
  status: String,          // "draft"|"review"|"published"|"archived"
  playCount: Number,
  createdAt: Date,
  updatedAt: Date,
  deletedAt: Date,         // SOFT DELETE ONLY — recordings are never hard deleted
}
```

### PostgreSQL — Core tables
```sql
-- Users
CREATE TABLE users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  language     TEXT DEFAULT 'so',
  role         TEXT DEFAULT 'listener', -- 'listener'|'contributor'|'admin'
  email_verified BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

-- Subscriptions (mirrors Stripe)
CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID REFERENCES users(id),
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan                   TEXT NOT NULL,   -- 'free'|'premium'|'institutional'
  status                 TEXT NOT NULL,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- Lesson progress
CREATE TABLE lesson_progress (
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  lesson_id    TEXT NOT NULL,
  completed    BOOLEAN DEFAULT false,
  progress_pct SMALLINT DEFAULT 0,
  UNIQUE(user_id, lesson_id)
);

-- Vector embeddings (pgvector)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE audio_embeddings (
  recording_id TEXT NOT NULL UNIQUE,
  embedding    vector(768),
  model_version TEXT NOT NULL DEFAULT 'mert-v1-95m'
);
CREATE INDEX ON audio_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## SECTION 6 — SECURITY RULES (non-negotiable, apply to every endpoint)

1. Passwords: bcrypt (12 rounds) — never store plaintext
2. JWT: 15-minute access tokens, 30-day refresh tokens (stored hashed)
3. Refresh token rotation on every use
4. Redis blacklist for revoked access tokens
5. Rate limiting: 5 login attempts per 15 min per IP
6. NEVER upload files through Node.js — always presigned R2 URLs
7. Presigned URLs expire in 1 hour, restricted to audio/* content type
8. ClamAV scan on every uploaded file before processing
9. All inputs validated with Zod — no raw user data in queries
10. Parameterized queries everywhere — no string concatenation
11. Tokens stored in expo-secure-store on mobile — never AsyncStorage
12. HTTPS only — all HTTP redirected
13. Helmet.js security headers on all responses
14. CORS restricted to known origins only
15. Soft delete only — no hard deletes on any content
16. All file keys are UUIDs — never original filenames in storage

---

## SECTION 7 — MOBILE APP SCREEN LIST

### Tab screens (main navigation)
- /discover    — browse archive, featured artists, recent recordings
- /learn       — lesson modules, progress tracking
- /search      — search by title, artist, genre, region
- /record      — field recording (role-gated: contributor + admin only)
- /profile     — account, subscription, settings, progress stats

### Stack screens (push navigation)
- /archive/[id]  — recording detail: audio player, waveform, AI transcript,
                   cultural context, similar recordings
- /artist/[id]   — artist profile: photo, biography, all recordings, era
- /lesson/[id]   — lesson player: content, audio examples, pitch feedback
- /search        — search with filters

### Auth screens (shown when not logged in)
- /welcome       — 3-slide onboarding with geometric animation
- /login
- /register
- /forgot-password

---

## SECTION 8 — API ENDPOINTS

### Auth
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
POST /api/v1/auth/verify-email
POST /api/v1/auth/forgot-password
POST /api/v1/auth/reset-password

### Recordings
GET    /api/v1/recordings              — paginated list, filters
GET    /api/v1/recordings/:id          — single recording
GET    /api/v1/recordings/:id/audio    — signed playback URL (1hr expiry)
GET    /api/v1/recordings/:id/pitch    — pitch data array
GET    /api/v1/recordings/similar/:id  — pgvector similarity search
POST   /api/v1/recordings/upload-url   — get presigned R2 upload URL
POST   /api/v1/recordings/upload-complete — notify after direct upload
PATCH  /api/v1/recordings/:id          — admin only

### Artists
GET /api/v1/artists
GET /api/v1/artists/:id
GET /api/v1/artists/:id/recordings

### Lessons
GET  /api/v1/lessons/modules
GET  /api/v1/lessons/:id
POST /api/v1/lessons/:id/progress

### Users
GET    /api/v1/users/me
PATCH  /api/v1/users/me
GET    /api/v1/users/me/saved
POST   /api/v1/users/me/saved/:id
DELETE /api/v1/users/me/saved/:id
DELETE /api/v1/users/me              — GDPR erasure

### Subscriptions
GET  /api/v1/subscriptions/plans
POST /api/v1/subscriptions/checkout  — Stripe checkout session
GET  /api/v1/subscriptions/status
POST /api/v1/subscriptions/webhook   — Stripe webhook

### Research API (API key auth, not JWT)
GET  /research/v1/recordings
GET  /research/v1/recordings/:id/audio
POST /research/v1/similarity
GET  /research/v1/embeddings

---

## SECTION 9 — AI PIPELINE (Python FastAPI)

### Processing chain (triggered on upload-complete)
Job 1: Audio validation
  → verify format (WAV/WEBM/FLAC only)
  → check duration (10sec min, 60min max)
  → virus scan (ClamAV)
  → extract sample rate, channels, bit depth

Job 2: Whisper transcription (parallel with Job 3)
  → model: large-v3, language: "so", task: "transcribe"
  → also run task: "translate" for English version
  → word_timestamps: True (for subtitle generation)

Job 3: CREPE pitch extraction (parallel with Job 2)
  → resample to 16kHz mono
  → model_capacity: "full", viterbi: True, step_size: 10ms
  → filter: confidence > 0.80
  → map to Somali pentatonic scale:
    do=293.66Hz, re=329.63Hz, mi=369.99Hz, sol=440.00Hz, la=493.88Hz
  → calculate cents_deviation (microtonality data — the research contribution)

Job 4: MERT embedding
  → model: m-a-p/MERT-v1-95M
  → output: 768-dimensional vector
  → store in pgvector for similarity search

Job 5: Genre classification
  → Phase 1: rule-based from metadata
  → Phase 3+: fine-tuned Wav2Vec2 classifier

Job 6: Elasticsearch indexing
  → index: title, artist, genre, region, era, transcript, instruments

### Somali scale note mapping
```python
SOMALI_SCALE_HZ = {
    "do":  293.66,  # D4 — most common oud root
    "re":  329.63,  # E4
    "mi":  369.99,  # F#4 — slightly variable (microtonal)
    "sol": 440.00,  # A4
    "la":  493.88,  # B4
}
# NOTE: Scale varies by mode/root (Beerdilacshe uses C-root pentatonic)
# Update these values empirically from Ahmed Ali Egal's recordings
# His ear is the ground truth — not this table
```

---

## SECTION 10 — MONOREPO FOLDER STRUCTURE

```
somali-music-archive/
├── apps/
│   ├── mobile/          # React Native — Expo (PRIMARY)
│   │   ├── app/         # Expo Router screens
│   │   │   ├── (auth)/  # login, register, welcome
│   │   │   ├── (tabs)/  # discover, learn, search, record, profile
│   │   │   ├── archive/ # [id].tsx
│   │   │   ├── artist/  # [id].tsx
│   │   │   └── lesson/  # [id].tsx
│   │   ├── components/
│   │   │   ├── ui/      # Button, Text, Card, Input, Badge, Skeleton
│   │   │   ├── audio/   # AudioPlayer, RecordButton, WaveformDisplay
│   │   │   ├── archive/ # RecordingCard, ArtistCard, MetadataForm
│   │   │   └── learn/   # LessonCard, ProgressBar, ScaleVisualizer
│   │   ├── hooks/       # useAudioPlayer, useAudioRecorder, useAuth
│   │   ├── stores/      # authStore, playerStore, offlineStore
│   │   ├── services/    # api/, audio/, storage/
│   │   ├── theme/       # colors, typography, spacing, shadows
│   │   ├── types/       # recording, lesson, user, api
│   │   └── utils/       # formatters, validators, permissions
│   ├── web/             # Next.js
│   ├── api/             # Node.js + Express
│   │   └── src/
│   │       ├── modules/ # auth, users, recordings, lessons, subscriptions
│   │       └── shared/  # middleware, database, storage, queue
│   └── ai-service/      # Python + FastAPI
│       ├── routers/     # transcribe, pitch, embed, classify
│       ├── models/      # model loading (Whisper, CREPE, MERT)
│       └── utils/       # scale mapping, audio helpers
├── packages/
│   ├── types/           # shared TypeScript types
│   ├── validators/      # shared Zod schemas
│   └── constants/       # genres, regions, languages
└── docs/
    └── ARCHITECTURE.md  # the full architecture document
```

---

## SECTION 11 — BUILD PHASES (current phase is always noted at top of session)

### Phase 0 — Foundation (weeks 1–2)
- [ ] GitHub monorepo with Turborepo
- [ ] EAS project setup (Expo Application Services)
- [ ] MongoDB Atlas (free tier)
- [ ] Supabase (free tier)
- [ ] Cloudflare R2 bucket (private)
- [ ] Doppler secrets management
- [ ] GitHub Actions CI (lint + typecheck)
- [ ] Register bundle IDs: com.somalimusicarchive.app
- [ ] Sentry error tracking

### Phase 1 — Archive Core (months 1–3)
Goal: Record Ahmed Ali Egal and store everything securely
- [ ] React Native skeleton (Expo Router, TypeScript, theme system)
- [ ] Auth screens (register, login, biometric)
- [ ] JWT + refresh token backend
- [ ] Record screen (expo-av + Web Audio API)
- [ ] Metadata form (all fields from MongoDB schema)
- [ ] Presigned R2 upload flow
- [ ] MongoDB recording schema
- [ ] Consent recording flow
- [ ] Basic admin dashboard (web)
- [ ] FIRST SESSION WITH AHMED ALI EGAL

### Phase 2 — Platform MVP (months 3–6)
Goal: Public app diaspora communities can download
- [ ] Discover tab (archive browser, featured artists)
- [ ] Artist profile screens
- [ ] Audio player with waveform visualization
- [ ] Offline audio caching
- [ ] Learn tab (first 10 lessons)
- [ ] Search (MongoDB text search)
- [ ] User profiles + lesson progress
- [ ] Stripe subscription (free + premium + institutional)
- [ ] Push notifications
- [ ] App Store + Google Play submission

### Phase 3 — Intelligence (months 7–12)
Goal: AI pipeline running, first academic paper submitted
- [ ] Whisper transcription service (FastAPI)
- [ ] CREPE pitch extraction + Somali scale mapping
- [ ] MERT embedding generation
- [ ] pgvector similarity search
- [ ] Elasticsearch full-text search
- [ ] AI content displayed in app
- [ ] "Similar recordings" feature
- [ ] Research API (API key auth)
- [ ] Dataset export for academic review
- [ ] ISMIR paper submission

### Phase 4 — Scale (months 12–18)
Goal: $8,000+ MRR, 10,000+ users
- [ ] Institutional license system
- [ ] Full admin content management
- [ ] Multilingual UI (Somali, Arabic, English)
- [ ] Advanced lessons
- [ ] Community features
- [ ] McKnight Foundation grant submission
- [ ] First university partnership

---

## SECTION 12 — FABLE 5 PROMPTING RULES

When using this document with Fable 5, follow these rules:

RULE 1 — Always load this full document first
Never start without it. Paste the entire file as the first message.

RULE 2 — State the current phase clearly
"We are in Phase 1. The current task is: [specific task]."

RULE 3 — One task per session
Do not ask Fable to build multiple features at once.
"Build the Record screen" is correct.
"Build the whole app" is waste.

RULE 4 — Specify exactly what you want back
"Return: (1) the complete TypeScript file, (2) any new types needed,
(3) unit test file, (4) any changes needed to existing files."

RULE 5 — Tell Fable which files already exist
"These files already exist: [list]. Do not recreate them.
Only create: [new files needed]."

RULE 6 — Use Claude Code for implementation
For Phase 1 and beyond, use Claude Code CLI with this document as context.
Fable reads your actual files and writes code directly.
More efficient than copy-paste.

RULE 7 — Security check every module
After building any backend module, add:
"Now audit this against Section 6 (Security Rules).
List every issue. Fix each one."

RULE 8 — Use Sonnet for everything else
Questions, debugging, planning, quick fixes = Sonnet 4.6.
Full feature builds = Fable 5.
Token cost is 5× higher on Fable. Use it only where it matters.

---

## SECTION 13 — THE DATASET STRATEGY (brief version for context)

Target: 500 primary recordings → 3,000 augmented clips
Source 1: Ahmed Ali Egal (primary — irreplaceable)
Source 2: Other Minneapolis Somali musicians (community outreach)
Source 3: BBC Somali Service archive (licensing)
Source 4: UCLA Ethnomusicology Archive (research access)

File naming standard:
{YYYY-MM-DD}_{ArtistSlug}_{SessionID}_{TrackNum}_{Genre}_{TitleSlug}.wav
Example: 2024-01-15_ahmed-ali-egal_S001_T01_heello_caasimada-jacaylka.wav

Every audio file has a matching .json metadata file (same name).
Every session begins with a consent recording (00_consent.wav).

Licensing tiers:
- Research: CC BY-NC 4.0 (free with attribution)
- Commercial research: $5,000–$25,000/year
- Full commercial (AI companies): $100,000–$500,000+ negotiated

Dataset milestone unlocks:
- 50 recordings  → McKnight Foundation grant application
- 200 recordings → ISMIR dataset paper submission
- 500 recordings → First commercial licensing pitch
- 1,000 recordings → Dataset value $500k–$1M

---

## SECTION 14 — ACADEMIC STRATEGY

Target publications:
1. ISMIR dataset paper (year 1) — "SomaliMusicCorpus: A Labeled Dataset..."
2. ISMIR/ICASSP model paper (year 2) — "AMT for Non-Western Oral Traditions..."
3. NeurIPS/ICML framework paper (year 3) — "Toward Culturally Equitable Music AI..."

Target institutions for partnership:
- MIT Media Lab (Prof. Eran Egozy — contacted)
- Stanford CCRMA
- UC Berkeley CNMAT
- McGill CIRMMT

The PhD application narrative:
"I am the only person alive who is a Somali-American AI engineer,
formally trained oud player, and collaborator of a founding member
of the Waaberi Band — building the first AI system to understand
music that machines have never heard."

---

## QUICK REFERENCE — USE AT TOP OF EVERY FABLE SESSION

Current phase: _______________
Task this session: _______________
Files that already exist: _______________
Files to create this session: _______________
Token budget for this session: _______________

Stack: React Native (Expo 51) + Node.js + MongoDB + PostgreSQL
       + Python FastAPI + Cloudflare R2 + Redis
Language: TypeScript strict (mobile + backend) + Python 3.11 (AI)
Design: Amber #C89B5F accent, dark bg #0C0B14, Playfair Display + Nunito
Security: Section 6 applies to every backend function
Never: hard delete, AsyncStorage for tokens, file uploads through Node.js

---

*End of master context document.*
*Khalid Ibrahim — Somali Music AI Preservation Platform*
*Update this document after every major architectural decision.*
