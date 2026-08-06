# Somali Music AI Preservation Platform
## Complete Project Architecture — Zero to Production
### Prepared for: Khalid Ibrahim | React Native Mobile-First | 2024–2026

---

> **Document purpose:** This is the single source of truth for the entire platform — architecture, security, infrastructure, AI pipeline, mobile UI/UX direction, data models, API contracts, and production deployment. Written for consumption by AI coding assistants and human engineers. Every decision is explained. Every tradeoff is named. Nothing is assumed.

---

## TABLE OF CONTENTS

1. [Project Vision and Goals](#1-project-vision-and-goals)
2. [Who This Is Built For](#2-who-this-is-built-for)
3. [Core Principles](#3-core-principles)
4. [System Overview — The Three Tiers](#4-system-overview--the-three-tiers)
5. [Technology Stack — Every Layer](#5-technology-stack--every-layer)
6. [Mobile App Architecture (React Native)](#6-mobile-app-architecture-react-native)
7. [UI/UX Design Direction](#7-uiux-design-direction)
8. [Backend Architecture](#8-backend-architecture)
9. [Database Architecture](#9-database-architecture)
10. [AI and ML Pipeline](#10-ai-and-ml-pipeline)
11. [Security Architecture](#11-security-architecture)
12. [API Design and Contracts](#12-api-design-and-contracts)
13. [Infrastructure and DevOps](#13-infrastructure-and-devops)
14. [Scalability Strategy](#14-scalability-strategy)
15. [Data Privacy and Cultural Governance](#15-data-privacy-and-cultural-governance)
16. [Build Sequence — Phase by Phase](#16-build-sequence--phase-by-phase)
17. [File and Folder Structure](#17-file-and-folder-structure)
18. [Environment Variables and Secrets](#18-environment-variables-and-secrets)
19. [Testing Strategy](#19-testing-strategy)
20. [MIT Portfolio and Academic Strategy](#20-mit-portfolio-and-academic-strategy)

---

## 1. PROJECT VISION AND GOALS

### What This Platform Is

The Somali Music AI Preservation Platform is a permanent digital home for Somali traditional music. It captures audio recordings from living elder musicians, transcribes and analyzes them with AI, teaches the tradition to diaspora learners worldwide, and provides a research-grade dataset to universities and ethnomusicologists.

### Why It Exists

Somali traditional music — heello, qaraami, dhaanto, gabay, buraanbur — exists almost entirely as an oral tradition. There are no written scores, no structured archives, no digitized collections of meaningful scale. The musicians who carry this knowledge are aging. When they pass, the music passes with them. This is the last window.

### The Three Goals — All Must Be Achieved Simultaneously

**Goal 1 — Cultural preservation (mission)**
Build the world's first structured, AI-annotated archive of Somali traditional music. Make it permanent, open-access at the metadata level, and mirrored by institutions like the Smithsonian so it survives regardless of the company's fate.

**Goal 2 — Revenue generation (sustainability)**
Generate real income through consumer subscriptions, institutional licenses, research API access, and grant funding. This is not a charity project. It must fund itself within 18 months of launch to survive.

**Goal 3 — Academic reputation (legacy)**
Produce peer-reviewed research publications. Build the labeled dataset that becomes the standard reference corpus for Somali music AI research. Establish Khalid Ibrahim as the founding researcher of this field. Target ISMIR, NeurIPS, and ICASSP publications.

### Success Metrics at Year 2

- 500+ high-quality labeled recordings in the archive
- 10,000+ registered users across diaspora communities globally
- 3+ institutional licenses (universities, cultural schools)
- $8,000+ monthly recurring revenue
- 1 published academic paper with dataset
- Partnership with 1 major institution (Smithsonian, NEA, or equivalent)

---

## 2. WHO THIS IS BUILT FOR

### Primary Users

**Somali diaspora learners** — aged 15–45, living in Minnesota, Seattle, London, Oslo, Dubai, Toronto, Nairobi. Want to connect to their heritage. Many were born outside Somalia and have limited exposure to traditional music. They use smartphones exclusively. Many live in countries with slower internet.

**Elder musicians and knowledge holders** — aged 60–90, living in diaspora communities. Limited tech literacy. They are contributors, not learners. The app must never put them in a position of confusion. Their role is to be recorded and honored.

**Non-Somali musicians and researchers** — ethnomusicologists, world music students, composers, oud players from Arab and Turkish traditions, AI music researchers. They come for the archive and the research API. They are global, tech-savvy, and willing to pay for access.

**Institutional users** — Somali cultural schools, mosques, universities, community centers. They buy annual licenses for multiple seats. Decision made by one administrator, used by many students.

### What Each User Needs

| User type | Primary need | Secondary need | Will pay? |
|---|---|---|---|
| Diaspora learner | Learn songs, hear heritage | Connect with community | Yes — $9–15/month |
| Elder musician | Be recorded with dignity | Know their legacy is preserved | No — they contribute |
| Researcher | Dataset access, API | Citation-ready documentation | Yes — $200–1000/month |
| Institution | Group access, curriculum | Admin controls | Yes — $500–2000/year |
| Non-Somali musician | Archive access, oud lessons | Contextual information | Yes — $9/month |

---

## 3. CORE PRINCIPLES

These principles govern every decision. When in doubt, return to these.

**Principle 1 — Mobile first, always**
The Somali diaspora is mobile-native. Most users in East Africa, the Gulf, and European cities access the internet primarily or exclusively via smartphone. Every feature is designed for mobile first. Desktop is secondary.

**Principle 2 — Offline capability**
Diaspora users in Somalia, Ethiopia, and Kenya face unreliable internet. Learners on long flights or in rural areas must be able to access core features offline. Audio content, lesson text, and metadata must be cacheable locally.

**Principle 3 — Security before features**
The archive contains irreplaceable cultural material and personal data about elder musicians. A breach that leaks private session data or allows content theft would be catastrophic and community-destroying. Security is non-negotiable at every layer.

**Principle 4 — The archive is sacred**
Recordings made with elders are not user-generated content. They are primary cultural documents. They are never deleted. They are versioned. They are governed by a cultural advisory board, not by a product team alone.

**Principle 5 — Dignity of contributors**
Every elder musician who contributes receives named credit in the archive, in publications, and in the app. Their name appears on every recording they contributed. They are not subjects — they are co-creators.

**Principle 6 — Build for millions, start with one**
The data architecture, the API design, and the infrastructure choices must support 1 million concurrent users from day one in their design — even though only 10 users exist at first. Scaling up should never require a rewrite.

---

## 4. SYSTEM OVERVIEW — THE THREE TIERS

```
┌─────────────────────────────────────────────────────────────┐
│                        TIER 1 — ARCHIVE                      │
│  Field recording app → Cloud storage → Metadata database     │
│  The raw irreplaceable material. Built first. Never deleted.  │
└──────────────────────────┬──────────────────────────────────┘
                           │ feeds
┌──────────────────────────▼──────────────────────────────────┐
│                      TIER 2 — PLATFORM                        │
│  React Native mobile app + Next.js web + Admin dashboard      │
│  What users interact with. Lessons, discovery, community.     │
└──────────────────────────┬──────────────────────────────────┘
                           │ powered by
┌──────────────────────────▼──────────────────────────────────┐
│                    TIER 3 — INTELLIGENCE                      │
│  Python AI pipeline: transcription, pitch detection,          │
│  classification, similarity search, generative models         │
│  The research layer. Builds on top of the archive.            │
└─────────────────────────────────────────────────────────────┘
```

### Tier 1 — Archive (build months 1–3)

The archive is the foundation. It collects audio files from field recording sessions with elder musicians and stores them with rich metadata. This tier must be operational before any other work begins. Every recording made before the app exists is still preserved using this system.

Components: field recording mobile app (React Native), cloud audio storage (Cloudflare R2), metadata database (MongoDB), consent management system.

### Tier 2 — Platform (build months 3–9)

The platform is what users interact with. It includes the mobile app (primary), a web app (secondary), and an admin dashboard for managing content and users.

Components: React Native mobile app (iOS + Android), Next.js web app, Node.js + Express API, PostgreSQL for user data, Stripe for payments, Push notifications via Expo.

### Tier 3 — Intelligence (build months 7–18)

The intelligence layer applies AI and ML to the archive. It transcribes spoken language, extracts musical features, classifies recordings, and enables semantic search. This layer is also where academic research happens.

Components: Python FastAPI service, Whisper for speech transcription, CREPE for pitch detection, Wav2Vec2/MERT for audio embeddings, pgvector for similarity search, PyTorch for custom model training.

---

## 5. TECHNOLOGY STACK — EVERY LAYER

### Mobile App (Primary Product)

```
Framework:        React Native 0.74+ with Expo SDK 51+
Language:         TypeScript (strict mode, no any)
Navigation:       Expo Router v3 (file-based, like Next.js App Router)
State management: Zustand (global) + React Query (server state)
UI components:    Custom design system — NO third-party component library
Styling:          StyleSheet API + custom theme tokens (no NativeWind in v1)
Audio playback:   expo-av
Audio recording:  expo-av + expo-file-system
Offline storage:  expo-sqlite (structured) + expo-file-system (audio cache)
Push notifications: expo-notifications + Firebase Cloud Messaging
Animations:       React Native Reanimated v3
Gestures:         React Native Gesture Handler
Icons:            @expo/vector-icons (Ionicons set)
Forms:            React Hook Form + Zod validation
HTTP client:      Axios with interceptors + React Query
Auth tokens:      expo-secure-store (hardware-backed keychain)
Biometrics:       expo-local-authentication
Analytics:        PostHog (self-hosted option available)
Crash reporting:  Sentry
OTA updates:      Expo Updates
Build service:    EAS Build (Expo Application Services)
```

### Web App (Secondary)

```
Framework:        Next.js 14+ (App Router)
Language:         TypeScript
Styling:          Tailwind CSS
Auth:             NextAuth.js v5
Hosting:          Vercel
```

### Backend API

```
Runtime:          Node.js 20 LTS
Framework:        Express.js 4 + express-validator
Language:         TypeScript
Auth:             JWT (access) + refresh tokens + Redis blacklist
Password hashing: bcrypt (rounds: 12)
Rate limiting:    express-rate-limit + Redis store
File uploads:     Multer + direct S3/R2 presigned URLs
Email:            Resend (transactional email)
Job queue:        BullMQ + Redis
WebSockets:       Socket.io (for live session features)
Logging:          Winston + structured JSON logs
API docs:         Swagger/OpenAPI 3.0 auto-generated
Process manager:  PM2
```

### Python AI Service

```
Runtime:          Python 3.11+
Framework:        FastAPI
ASGI server:      Uvicorn + Gunicorn
Audio analysis:   librosa 0.10+
Pitch detection:  CREPE
Speech-to-text:   OpenAI Whisper (large-v3, self-hosted)
Audio ML models:  PyTorch 2.0 + HuggingFace Transformers
Foundation model: MERT (Music undERstanding model with large-scale self-supervised Training)
Vector search:    FAISS + pgvector
Task queue:       Celery + Redis
Model serving:    TorchServe (production) / direct FastAPI (development)
Experiment tracking: Weights & Biases (wandb)
```

### Databases

```
Primary metadata:     MongoDB 7+ (Atlas)
User/subscription:    PostgreSQL 16 (Supabase or RDS)
Vector embeddings:    pgvector extension on PostgreSQL
Full-text search:     Elasticsearch 8+ (or Typesense for budget)
Cache / sessions:     Redis 7+ (Upstash for serverless)
Audio file storage:   Cloudflare R2 (S3-compatible, zero egress fees)
CDN:                  Cloudflare (audio streaming to global users)
```

### Infrastructure

```
Mobile builds:        EAS Build (Expo)
API hosting:          Railway or Render (early) → AWS ECS (scale)
Python AI service:    Modal.com (GPU inference, pay-per-use) → AWS GPU instances
Database hosting:     MongoDB Atlas + Supabase (managed PostgreSQL)
Audio storage:        Cloudflare R2
CDN / edge:           Cloudflare
CI/CD:                GitHub Actions
Container:            Docker + Docker Compose (local dev)
Secrets management:   Doppler or AWS Secrets Manager
Monitoring:           Grafana + Prometheus
Error tracking:       Sentry (both mobile and backend)
Uptime monitoring:    BetterUptime
```

---

## 6. MOBILE APP ARCHITECTURE (REACT NATIVE)

### Why React Native Over Flutter

React Native is chosen because: Khalid already knows JavaScript and TypeScript deeply. The web app (Next.js) shares business logic, validation schemas, and type definitions. The Expo ecosystem dramatically reduces mobile-specific complexity. The React Native community is larger with more audio-specific libraries. Expo's EAS Build handles App Store and Google Play submission without macOS dependency.

### Project Structure Inside the Mobile App

```
apps/mobile/
├── app/                          # Expo Router — every file = a screen
│   ├── (auth)/                   # Auth screens — not in tab bar
│   │   ├── welcome.tsx           # Splash / onboarding
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   └── forgot-password.tsx
│   ├── (tabs)/                   # Main tab navigation
│   │   ├── _layout.tsx           # Tab bar definition
│   │   ├── discover.tsx          # Browse the archive
│   │   ├── learn.tsx             # Lesson modules
│   │   ├── record.tsx            # Field recording (admin/contributor only)
│   │   └── profile.tsx           # User profile and settings
│   ├── archive/
│   │   ├── [id].tsx              # Individual recording detail
│   │   └── index.tsx             # Archive list
│   ├── artist/
│   │   └── [id].tsx              # Artist profile page
│   ├── lesson/
│   │   └── [id].tsx              # Individual lesson
│   ├── search.tsx                # Search screen
│   └── _layout.tsx               # Root layout — providers, fonts
├── components/
│   ├── ui/                       # Base design system components
│   │   ├── Button.tsx
│   │   ├── Text.tsx
│   │   ├── Card.tsx
│   │   ├── Input.tsx
│   │   ├── Badge.tsx
│   │   ├── Avatar.tsx
│   │   └── Skeleton.tsx          # Loading states
│   ├── audio/
│   │   ├── AudioPlayer.tsx       # Core waveform player
│   │   ├── RecordButton.tsx      # Pulsing record button
│   │   ├── WaveformDisplay.tsx   # Visual audio waveform
│   │   └── PitchMeter.tsx        # Real-time pitch visualization
│   ├── archive/
│   │   ├── RecordingCard.tsx
│   │   ├── ArtistCard.tsx
│   │   └── MetadataForm.tsx
│   ├── learn/
│   │   ├── LessonCard.tsx
│   │   ├── ProgressBar.tsx
│   │   └── ScaleVisualizer.tsx
│   └── shared/
│       ├── ScreenHeader.tsx
│       ├── LoadingState.tsx
│       ├── ErrorState.tsx
│       └── EmptyState.tsx
├── hooks/
│   ├── useAudioPlayer.ts         # Audio playback logic
│   ├── useAudioRecorder.ts       # Recording logic
│   ├── useOfflineSync.ts         # Sync when connection returns
│   ├── useAuth.ts                # Auth state and actions
│   └── usePitchDetection.ts      # Real-time pitch analysis
├── stores/
│   ├── authStore.ts              # Zustand — user session
│   ├── playerStore.ts            # Zustand — global audio player state
│   ├── offlineStore.ts           # Zustand — offline queue
│   └── settingsStore.ts          # Zustand — user preferences
├── services/
│   ├── api/
│   │   ├── client.ts             # Axios instance with auth interceptors
│   │   ├── recordings.ts         # Recording endpoints
│   │   ├── lessons.ts            # Lesson endpoints
│   │   ├── auth.ts               # Auth endpoints
│   │   └── search.ts             # Search endpoints
│   ├── audio/
│   │   ├── recorder.ts           # Low-level recording service
│   │   ├── player.ts             # Low-level playback service
│   │   └── cache.ts              # Offline audio caching
│   └── storage/
│       ├── secureStorage.ts      # expo-secure-store wrapper
│       └── sqliteStorage.ts      # Local database wrapper
├── theme/
│   ├── colors.ts                 # Full color system
│   ├── typography.ts             # Font scale and weights
│   ├── spacing.ts                # 4px base grid
│   ├── shadows.ts                # iOS + Android shadows
│   └── index.ts                  # Re-exports everything
├── types/
│   ├── recording.ts              # Shared with backend
│   ├── lesson.ts
│   ├── user.ts
│   └── api.ts                    # API response types
├── utils/
│   ├── formatters.ts             # Duration, date, filesize
│   ├── validators.ts             # Zod schemas
│   ├── permissions.ts            # Microphone, storage permissions
│   └── analytics.ts             # Event tracking wrapper
├── constants/
│   ├── genres.ts                 # HEELLO, QARAAMI, etc.
│   ├── regions.ts                # Somali regions
│   └── languages.ts              # so, ar, en
├── app.json                      # Expo config
├── eas.json                      # EAS Build config
└── package.json
```

### State Management Pattern

Use Zustand for global persistent state (auth, player, offline queue). Use React Query for all server data — it handles caching, refetching, optimistic updates, and loading states automatically. Never put server data in Zustand.

```
Server data (API responses) → React Query cache → components
User session (JWT, profile) → Zustand authStore → persisted to SecureStore
Audio player state          → Zustand playerStore → in-memory only
Offline queue               → Zustand offlineStore → persisted to SQLite
```

### Navigation Structure

```
Root Stack
├── (auth) Group — shown when not authenticated
│   ├── /welcome       — onboarding slides
│   ├── /login
│   └── /register
└── (tabs) Group — shown when authenticated
    ├── /discover      — tab 1 — browse archive, featured artists
    ├── /learn         — tab 2 — lesson modules, progress
    ├── /search        — tab 3 — search across everything
    ├── /record        — tab 4 — field recording (role-gated)
    └── /profile       — tab 5 — account, settings, subscription
    
    Modal Screens (overlay the tabs)
    ├── /archive/[id]  — recording detail with audio player
    ├── /artist/[id]   — artist profile
    └── /lesson/[id]   — lesson player
```

### Offline Strategy

Every recording that a user plays is automatically cached to local storage. Lesson text and metadata sync when connected. The field recording feature works fully offline — recordings queue locally and upload when connection returns. The app never shows an error for missing content that was previously loaded — it shows the cached version with a "Last updated X" timestamp.

---

## 7. UI/UX DESIGN DIRECTION

### Design Identity

The visual identity is rooted in Somali craft and Islamic geometric tradition — not in generic "African music app" aesthetics. The signature element is the geometric motif derived from traditional Somali dhaqan (cultural) textile patterns — a five-pointed star geometry that mirrors the five-note pentatonic scale. This motif appears as a subtle background texture, as a loading animation, and as the logo mark.

The overall feeling: archival dignity meets modern clarity. Like a great museum app that knows what it holds is precious. Dark mode primary. Rich, warm materials. Nothing flashy. Nothing that would embarrass a Smithsonian exhibition.

### Color System

```typescript
// theme/colors.ts

export const colors = {
  // Backgrounds — dark primary, building toward light
  bg: {
    primary:   '#0C0B14',   // near-black with warm purple undertone
    secondary: '#161524',   // card surfaces
    tertiary:  '#201E33',   // elevated elements, modals
    inverse:   '#EDE9DC',   // light mode / onboarding
  },

  // Accent — oud wood amber, the signature color
  // Used sparingly: CTAs, active states, highlights
  amber: {
    primary:   '#C89B5F',   // main accent — oud wood
    light:     '#E5C48A',   // hover / pressed states
    dim:       '#7A5C2E',   // secondary text on amber bg
    subtle:    '#2A1F0E',   // amber-tinted surface
  },

  // Secondary accent — Somali flag blue
  blue: {
    primary:   '#4189D4',   // links, secondary actions
    light:     '#6BABEC',
    dim:       '#1A4B82',
    subtle:    '#0A1E38',
  },

  // Semantic colors
  success:  '#5AB88A',
  warning:  '#E8B84B',
  error:    '#E05A5A',
  info:     '#5A9BE0',

  // Text
  text: {
    primary:   '#EDE9DC',   // main body text — warm white
    secondary: '#9B97B0',   // labels, metadata, placeholders
    tertiary:  '#5C5A74',   // disabled states
    inverse:   '#0C0B14',   // text on light backgrounds
  },

  // Borders
  border: {
    primary:   '#2D2B45',
    secondary: '#1E1D30',
    focus:     '#C89B5F',   // always amber on focus
  },

  // Always-static (never changes in dark/light)
  static: {
    white: '#FFFFFF',
    black: '#000000',
  },
} as const;
```

### Typography

```typescript
// theme/typography.ts
// Font family: Nunito (body) + Playfair Display (display/headings)
// Both loaded via expo-google-fonts

export const typography = {
  // Display — used for artist names, song titles, hero text
  displayLarge:  { fontFamily: 'PlayfairDisplay_700Bold',  fontSize: 32, lineHeight: 40 },
  displayMedium: { fontFamily: 'PlayfairDisplay_500Medium', fontSize: 24, lineHeight: 32 },
  displaySmall:  { fontFamily: 'PlayfairDisplay_400Regular', fontSize: 20, lineHeight: 28 },

  // Body — all UI chrome and content text
  bodyLarge:     { fontFamily: 'Nunito_600SemiBold',  fontSize: 16, lineHeight: 24 },
  bodyMedium:    { fontFamily: 'Nunito_400Regular',   fontSize: 14, lineHeight: 22 },
  bodySmall:     { fontFamily: 'Nunito_400Regular',   fontSize: 12, lineHeight: 18 },

  // Labels — tabs, badges, metadata tags
  labelLarge:    { fontFamily: 'Nunito_700Bold',      fontSize: 12, lineHeight: 16 },
  labelMedium:   { fontFamily: 'Nunito_600SemiBold',  fontSize: 11, lineHeight: 14 },
  labelSmall:    { fontFamily: 'Nunito_500Medium',    fontSize: 10, lineHeight: 12 },
} as const;
```

### Spacing System

Base unit: 4px. All spacing values are multiples of 4.

```typescript
// theme/spacing.ts
export const spacing = {
  xs:   4,    // tight internal padding
  sm:   8,    // between related elements
  md:   12,   // standard internal card padding
  base: 16,   // default horizontal screen padding
  lg:   20,   // between sections within a card
  xl:   24,   // between major sections
  xxl:  32,   // major layout gaps
  xxxl: 48,   // hero sections, top padding
} as const;
```

### Key Screens — Description for Design

**Welcome / Onboarding (3 slides)**
Slide 1: Full-screen dark background. The five-pointed geometric star animates from a single center point outward. Tagline appears: "The music of our ancestors, for the children of tomorrow." Somali and English, stacked. No skip button on slide 1 — the animation is the identity moment.
Slide 2: A waveform visualization of an oud playing. "5,000 years of Somali musical tradition. Preserved. Taught. Shared." Three icons below: Archive, Learn, Discover.
Slide 3: Community — illustrations of elders, learners, ouds. "Join 50,000 Somali families connecting through music." CTA: "Create account" + "Sign in."

**Discover (Tab 1)**
Header: "Discover" in display font. Below: horizontal scroll of featured artist cards (elder musicians). Each card: dark card with amber accent at top, artist photo (or geometric placeholder), name in display font, role in label font. Below featured: vertical list of recent recordings. Filter bar: All / Heello / Qaraami / Dhaanto / Instrumental. Each recording row: waveform thumbnail, title, artist, duration, play button. Tapping plays inline with a mini-player that rises from the bottom.

**Individual Recording (Modal)**
Full screen dark. Title in display font, large. Artist name in amber. Metadata chips in a horizontal row: genre, region, era, instruments. Large waveform visualization — custom animated waveform in amber that animates as audio plays. Play/pause centered. Below: AI-generated description of the musical content. "About this song" section: the cultural context and story, sourced from the field recording notes. Transcript tab: spoken lyrics/words if available. "Share" and "Save offline" actions.

**Learn (Tab 2)**
Two sections: "Continue" (your in-progress lessons) and "All modules." Module cards: numbered, titled in display font, progress bar in amber, lesson count in label font. Modules are grouped by track: Beginners — Understanding Somali Music; Intermediate — The Pentatonic Scale and Oud Basics; Advanced — Song-specific learning. Tapping a module goes to lesson list. Tapping a lesson opens the lesson player.

**Lesson Player (Modal)**
Progress bar at top. Lesson number and title. Content: rich text with embedded audio clips from the archive. Interactive pitch exercise: the phone microphone listens as the learner tries to sing or play the note, and a visual meter shows how close they are. "Next lesson" button at bottom. Offline badge shows when content is cached.

**Record (Tab 4 — role-gated, admin/contributor only)**
This screen is only visible to users with the "contributor" role. Large centered record button. Session metadata form beneath. After recording: audio playback, AI analysis panel, metadata completion form. Save button.

**Profile (Tab 5)**
Avatar, display name, email. Subscription status with amber badge (Free / Premium / Institutional). Streak: "X days learning." Stats: recordings listened, lessons completed, favorites. Settings: language (Somali / Arabic / English), playback quality, offline downloads, notifications. Sign out.

### Accessibility Requirements

All interactive elements: minimum 44×44pt touch target. Text contrast: minimum 4.5:1 on all backgrounds. All icons have accessibilityLabel. Audio content has text transcript or description. Supports Dynamic Type (font scaling). Supports Reduce Motion (disables non-essential animations). Screen reader tested on VoiceOver (iOS) and TalkBack (Android).

---

## 8. BACKEND ARCHITECTURE

### Service Architecture

The backend is a modular monolith in Phase 1 — all services live in one codebase but are organized as independent modules with clean interfaces. This avoids the operational complexity of microservices while maintaining the ability to extract individual services later.

```
backend/
├── src/
│   ├── modules/
│   │   ├── auth/             # Registration, login, tokens, biometric auth
│   │   ├── users/            # User profiles, preferences, roles
│   │   ├── recordings/       # Archive CRUD, upload, metadata
│   │   ├── sessions/         # Field recording sessions
│   │   ├── lessons/          # Lesson content, progress tracking
│   │   ├── search/           # Elasticsearch integration
│   │   ├── subscriptions/    # Stripe integration, plan management
│   │   ├── notifications/    # Push notification management
│   │   └── research/         # Research API — dataset access
│   ├── shared/
│   │   ├── middleware/       # Auth, rate limiting, validation, logging
│   │   ├── database/         # MongoDB and PostgreSQL clients
│   │   ├── storage/          # R2 client, presigned URL generation
│   │   ├── queue/            # BullMQ job definitions
│   │   ├── email/            # Resend email service
│   │   └── errors/           # Custom error classes and handler
│   ├── config/               # Validated env vars, constants
│   └── app.ts                # Express app factory
```

### Authentication Flow

1. User registers with email + password. Password hashed with bcrypt (12 rounds). User record created in PostgreSQL.
2. Login: verify password, issue short-lived JWT access token (15 minutes) + long-lived refresh token (30 days). Refresh token stored in PostgreSQL, hashed.
3. Mobile app stores access token in expo-secure-store (hardware-backed keychain). Refresh token also in SecureStore.
4. Every API request includes `Authorization: Bearer <access_token>`.
5. When access token expires, the mobile app automatically uses the refresh token to get a new one (transparent to user).
6. Logout: refresh token deleted from database. Access token placed in Redis blacklist for its remaining TTL.
7. Biometric authentication: on subsequent logins, if the user has set up biometrics, Face ID / fingerprint is used instead of password. The biometric never leaves the device — it unlocks the stored token.

### File Upload Flow (Secure, Scalable)

Never upload audio files through the Node.js API. Files go directly from the mobile app to Cloudflare R2.

```
1. Mobile app requests a presigned upload URL from API
   POST /api/v1/recordings/upload-url
   Body: { filename, contentType, sessionId }
   
2. API generates a time-limited presigned URL (15 minutes) with:
   - Maximum file size enforced (500MB)
   - Allowed content types enforced (audio/wav, audio/webm, audio/flac)
   - A random UUID filename (never the original filename)
   Response: { uploadUrl, fileKey, recordingId }
   
3. Mobile app uploads file directly to R2 using the presigned URL
   PUT <uploadUrl>
   Headers: Content-Type, Content-Length
   Body: raw audio bytes
   
4. Mobile app notifies API that upload is complete
   POST /api/v1/recordings/upload-complete
   Body: { recordingId, fileKey }
   
5. API enqueues an async job to:
   - Verify file exists in R2
   - Run virus/malware scan
   - Trigger AI transcription pipeline
   - Update recording status to "processing" → "ready"
```

### Job Queue Architecture

Long-running operations are never handled in the request/response cycle. They are enqueued as jobs and processed asynchronously by worker processes.

```
Job types:
- audio:process          — virus scan, format validation, waveform generation
- ai:transcribe          — Whisper speech transcription
- ai:pitch-extract       — CREPE pitch detection
- ai:classify            — genre and style classification
- ai:embed               — generate audio embedding for similarity search
- search:index           — index new recording in Elasticsearch
- notification:send      — send push notification to user
- email:send             — send transactional email
- subscription:sync      — sync Stripe subscription status

Each job has:
- 3 retry attempts with exponential backoff
- Dead letter queue for failed jobs after 3 attempts
- Timeout enforcement (AI jobs: 5 minutes max)
- Sentry error reporting on failure
```

---

## 9. DATABASE ARCHITECTURE

### MongoDB — Primary Metadata Store

MongoDB stores all content metadata. The schema is document-oriented to accommodate the flexibility needed for cultural metadata (not every field applies to every recording).

```javascript
// Recording document — the core data unit
{
  _id: ObjectId,
  id: String,              // human-readable ID: "2024-01-15-AAE-001"
  
  // File reference
  fileKey: String,         // R2 object key — never the original filename
  fileUrl: String,         // CDN URL for playback
  waveformUrl: String,     // Pre-generated waveform image URL
  duration: Number,        // seconds — extracted, not trusted from client
  fileSize: Number,        // bytes
  format: String,          // "wav" | "webm" | "flac"
  sampleRate: Number,      // 44100 | 48000 | 96000
  
  // Cultural metadata
  title: {
    somali: String,        // Original Somali title
    transliteration: String,
    english: String,       // English translation
  },
  artist: {
    id: ObjectId,          // ref → Artist collection
    name: String,          // denormalized for query performance
  },
  poet: {
    name: String,
    notes: String,
  },
  genre: String,           // "heello" | "qaraami" | "dhaanto" | "buraanbur" | "gabay" | "jiifto" | "instrumental" | "other"
  subgenre: String,
  occasion: String,        // "love song" | "wedding" | "lullaby" | etc.
  instruments: [String],   // ["voice", "oud", "kaban"]
  language: String,        // "so" | "ar" | "sw" | "other"
  region: String,          // "Mogadishu" | "Hargeisa" | etc.
  era: String,             // "1960s" | "1970s" | etc.
  
  // Session info
  session: {
    id: String,
    date: Date,
    location: String,
    recorder: String,      // name of person who made the recording
    consentFileKey: String, // reference to consent recording
  },
  
  // AI-generated fields — added asynchronously
  ai: {
    status: String,                // "pending" | "processing" | "complete" | "failed"
    transcriptSomali: String,
    transcriptEnglish: String,
    musicDescription: String,
    styleNotes: String,
    pitchData: [{
      timeSec: Number,
      frequencyHz: Number,
      noteLabel: String,           // "do" | "re" | "mi" | "sol" | "la"
      centsDeviation: Number,      // microtonality data
    }],
    embeddingId: String,           // reference to pgvector record
    genre_predicted: String,       // model's classification
    quality: String,               // "excellent" | "good" | "fair" | "poor"
    processedAt: Date,
  },
  
  // Access control
  visibility: String,    // "public" | "restricted" | "private"
  license: String,       // "CC-BY-4.0" | "CC-BY-NC-4.0" | "all-rights-reserved"
  
  // Moderation
  status: String,        // "draft" | "review" | "published" | "archived"
  reviewedBy: ObjectId,  // ref → User
  reviewedAt: Date,
  
  // Engagement
  playCount: Number,
  saveCount: Number,
  
  // Timestamps
  createdAt: Date,
  updatedAt: Date,
  deletedAt: Date,       // soft delete — recordings are NEVER hard deleted
}
```

```javascript
// Artist document
{
  _id: ObjectId,
  name: String,
  nameArabic: String,
  nameSomali: String,
  birthYear: Number,
  birthRegion: String,
  bio: {
    somali: String,
    english: String,
  },
  affiliations: [String],  // ["Waaberi Band", "Radio Mogadishu"]
  activePeriod: String,    // "1965–1991"
  instruments: [String],
  photoUrl: String,
  consentOnFile: Boolean,
  consentDate: Date,
  recordingCount: Number,  // denormalized counter
  createdAt: Date,
}
```

### PostgreSQL — User and Business Data

PostgreSQL stores all relational, transactional data: users, subscriptions, roles, progress, payments.

```sql
-- Users table
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url  TEXT,
  language    TEXT DEFAULT 'so',       -- 'so' | 'ar' | 'en'
  role        TEXT DEFAULT 'listener', -- 'listener' | 'contributor' | 'admin'
  email_verified BOOLEAN DEFAULT false,
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  deleted_at  TIMESTAMPTZ            -- soft delete
);

-- Refresh tokens (for auth rotation)
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,         -- bcrypt hash of the token
  device_id   TEXT,                  -- optional device fingerprint
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Subscriptions (mirrors Stripe data)
CREATE TABLE subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES users(id),
  stripe_customer_id    TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  plan                  TEXT NOT NULL,  -- 'free' | 'premium' | 'institutional'
  status                TEXT NOT NULL,  -- 'active' | 'past_due' | 'canceled'
  current_period_start  TIMESTAMPTZ,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Lesson progress
CREATE TABLE lesson_progress (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  lesson_id     TEXT NOT NULL,
  module_id     TEXT NOT NULL,
  completed     BOOLEAN DEFAULT false,
  completed_at  TIMESTAMPTZ,
  progress_pct  SMALLINT DEFAULT 0,   -- 0–100
  last_position_sec INTEGER DEFAULT 0, -- resume position
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

-- Saved recordings (bookmarks)
CREATE TABLE saved_recordings (
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  recording_id  TEXT NOT NULL,  -- MongoDB ObjectId as string
  saved_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, recording_id)
);

-- Play history
CREATE TABLE play_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  recording_id  TEXT NOT NULL,
  played_at     TIMESTAMPTZ DEFAULT now(),
  duration_sec  INTEGER     -- how long they listened
);

-- Research API access
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id),
  key_hash    TEXT NOT NULL,       -- bcrypt hash
  key_prefix  TEXT NOT NULL,       -- first 8 chars for display "sk_xxxx..."
  name        TEXT NOT NULL,       -- "MIT Music Lab Key"
  plan        TEXT DEFAULT 'academic', -- 'academic' | 'commercial'
  rate_limit  INTEGER DEFAULT 1000,    -- requests per day
  last_used_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### pgvector — Audio Similarity Search

```sql
CREATE EXTENSION vector;

CREATE TABLE audio_embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id  TEXT NOT NULL UNIQUE,  -- MongoDB ObjectId
  embedding     vector(768),           -- MERT output dimension
  model_version TEXT NOT NULL,         -- "mert-v1-95m"
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- IVFFlat index for approximate nearest neighbor search
-- listcount = sqrt(number of rows) — recalculate as archive grows
CREATE INDEX ON audio_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Query: find 10 most similar recordings to a given recording
SELECT recording_id, 1 - (embedding <=> query_embedding) AS similarity
FROM audio_embeddings
ORDER BY embedding <=> query_embedding
LIMIT 10;
```

---

## 10. AI AND ML PIPELINE

### Pipeline Overview

The AI pipeline runs asynchronously. When a new recording is uploaded and verified, it triggers a chain of processing jobs. Each job is independent — failure of one does not block the others.

```
New recording uploaded
         │
         ▼
[Job 1] Audio validation
  • Verify format (WAV/WEBM/FLAC only)
  • Check duration (10 sec minimum, 60 min maximum)
  • Virus scan with ClamAV
  • Extract technical metadata (sample rate, channels, bit depth)
         │
         ▼
[Job 2] Whisper transcription (runs in parallel with Job 3)
  • Load whisper large-v3 model
  • Transcribe spoken Somali to text
  • Translate to English
  • Identify language segments (code-switching detection)
  • Store: transcript_somali, transcript_english
         │
         ▼
[Job 3] CREPE pitch extraction (runs in parallel with Job 2)
  • Resample audio to 16kHz mono (CREPE requirement)
  • Run CREPE pitch detection (10ms frame step)
  • Apply Viterbi smoothing
  • Map frequencies to Somali pentatonic scale
  • Calculate cents deviation (microtonality data)
  • Store: pitch_data array, dominant_notes
         │
         ▼
[Job 4] MERT embedding generation
  • Load MERT-v1-95M model
  • Generate 768-dimensional audio embedding
  • Store embedding in pgvector
         │
         ▼
[Job 5] Genre classification
  • Use fine-tuned Wav2Vec2 classifier (after sufficient training data)
  • In Phase 1: rule-based classification using metadata
  • Store: genre_predicted, confidence_score
         │
         ▼
[Job 6] Search indexing
  • Index recording metadata in Elasticsearch
  • Fields: title, artist, genre, region, era, transcript, instruments
         │
         ▼
Recording status → "published"
Notification sent to admin for review
```

### Whisper — Speech Transcription Configuration

```python
# FastAPI service — ai_service/routers/transcribe.py

import whisper
from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

router = APIRouter()
model = whisper.load_model("large-v3")  # loaded once at startup

class TranscribeRequest(BaseModel):
    recording_id: str
    audio_url: str          # pre-signed R2 URL
    language: str = "so"    # Somali by default

@router.post("/transcribe")
async def transcribe(req: TranscribeRequest, tasks: BackgroundTasks):
    tasks.add_task(run_transcription, req)
    return {"status": "queued", "recording_id": req.recording_id}

async def run_transcription(req: TranscribeRequest):
    # Download audio from R2
    audio_path = await download_audio(req.audio_url, req.recording_id)
    
    # Transcribe in original language
    result_original = model.transcribe(
        audio_path,
        language=req.language,
        task="transcribe",
        word_timestamps=True,   # get word-level timing
        verbose=False
    )
    
    # Translate to English
    result_english = model.transcribe(
        audio_path,
        language=req.language,
        task="translate",
        verbose=False
    )
    
    # Post result back to main API
    await post_result(req.recording_id, {
        "transcript_somali": result_original["text"],
        "transcript_english": result_english["text"],
        "word_timestamps": result_original["segments"],
        "detected_language": result_original["language"],
    })
```

### CREPE — Pitch Detection and Scale Mapping

```python
# ai_service/routers/pitch.py

import crepe
import librosa
import numpy as np
import soundfile as sf
from fastapi import APIRouter

router = APIRouter()

# Somali pentatonic scale — approximate Hz values (D root, common oud tuning)
# IMPORTANT: these values are refined empirically from Ahmed Ali Egal's recordings
# His ear is the ground truth — update these as field data comes in
SOMALI_SCALE_HZ = {
    "do":  293.66,   # D4
    "re":  329.63,   # E4
    "mi":  369.99,   # F#4 (approximate — slightly variable in practice)
    "sol": 440.00,   # A4
    "la":  493.88,   # B4
}

def hz_to_somali_note(hz: float) -> tuple[str, float]:
    """
    Map a frequency to the nearest Somali scale degree.
    Returns (note_name, cents_deviation).
    
    cents_deviation reveals microtonality:
    - 0 cents = exactly on the Western equal-tempered pitch
    - ±50 cents = a quarter tone away
    - ±100 cents = one semitone away
    
    This data is the core research contribution.
    """
    notes = list(SOMALI_SCALE_HZ.items())
    diffs = [abs(hz - target_hz) for _, target_hz in notes]
    idx = int(np.argmin(diffs))
    note_name, target_hz = notes[idx]
    cents_deviation = 1200 * np.log2(hz / target_hz)
    return note_name, round(cents_deviation, 2)

@router.post("/extract-pitch")
async def extract_pitch(recording_id: str, audio_url: str):
    audio_path = await download_audio(audio_url, recording_id)
    
    # Load and resample to 16kHz mono (CREPE requirement)
    audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    
    # Run CREPE pitch detection
    time, frequency, confidence, _ = crepe.predict(
        audio, sr,
        model_capacity='full',    # most accurate model
        viterbi=True,             # smoother melody contour
        step_size=10,             # 10ms frames
        verbose=0
    )
    
    # Filter to confident detections only
    confidence_threshold = 0.80
    mask = confidence > confidence_threshold
    
    # Map to Somali scale
    pitch_data = []
    for t, hz, conf in zip(time[mask], frequency[mask], confidence[mask]):
        if hz > 0:
            note, deviation = hz_to_somali_note(hz)
            pitch_data.append({
                "time_sec": round(float(t), 3),
                "frequency_hz": round(float(hz), 2),
                "confidence": round(float(conf), 3),
                "note_label": note,
                "cents_deviation": deviation,
            })
    
    await post_result(recording_id, {"pitch_data": pitch_data})
    return {"status": "complete", "points_extracted": len(pitch_data)}
```

### MERT — Audio Embeddings for Similarity Search

```python
# ai_service/routers/embed.py

from transformers import AutoModel, AutoProcessor
import torch
import numpy as np

# MERT-v1-95M: Music Understanding model — 95M parameters
# Pretrained on large music dataset, outputs rich audio representations
model_name = "m-a-p/MERT-v1-95M"
processor = AutoProcessor.from_pretrained(model_name, trust_remote_code=True)
mert_model = AutoModel.from_pretrained(model_name, trust_remote_code=True)
mert_model.eval()

async def generate_embedding(audio_path: str) -> list[float]:
    import librosa
    audio, sr = librosa.load(audio_path, sr=24000, mono=True)
    
    inputs = processor(audio, sampling_rate=sr, return_tensors="pt")
    
    with torch.no_grad():
        outputs = mert_model(**inputs, output_hidden_states=True)
    
    # Use mean of all hidden states as the embedding
    # This captures multi-level musical features
    all_hidden = torch.stack(outputs.hidden_states).squeeze()
    time_averaged = all_hidden.mean(dim=-2)  # average over time
    embedding = time_averaged.mean(dim=0)    # average over layers
    
    return embedding.tolist()  # 768-dimensional vector
```

### Research Dataset API

Academic users get access to the dataset through a dedicated API. Access is authenticated with API keys, rate-limited by plan, and audited for compliance with cultural governance rules.

```
GET /research/v1/recordings
  → Paginated list of published recordings with full metadata
  → Filter by: genre, region, era, artist, instrument, language
  → Includes: AI-generated fields, pitch data, transcript

GET /research/v1/recordings/{id}/audio
  → Time-limited presigned URL to download the audio file
  → Requires: research API key + accepted terms of use

GET /research/v1/recordings/{id}/pitch
  → Full pitch extraction data as JSON or CSV

GET /research/v1/embeddings
  → Batch export of audio embeddings for training/fine-tuning
  → Rate limited: 100 requests/day academic, 1000/day commercial

POST /research/v1/similarity
  → Upload audio → get back 10 most similar recordings
```

---

## 11. SECURITY ARCHITECTURE

Security is not a feature added at the end. It is woven into every layer from the first line of code.

### Threat Model — What This Platform Faces

**Threat 1 — Content theft:** Unauthorized bulk download of the archive. An attacker scrapes all audio files and republishes them without attribution. Mitigation: all audio served via time-limited signed URLs (expiry: 1 hour). Direct R2 bucket access is blocked — all audio goes through the CDN with access controls. Rate limiting on audio URL generation.

**Threat 2 — Account takeover:** Attacker gains access to a user account via credential stuffing (reusing breached passwords from other sites) or brute force. Mitigation: bcrypt hashing makes stolen hashes useless. Rate limiting on login (5 attempts per 15 minutes per IP). Account lockout after 10 failed attempts. Mandatory email verification. Suspicious login notifications. Optional MFA via TOTP.

**Threat 3 — API abuse:** A bad actor uses the research API to scrape the dataset or train a commercial model without a license. Mitigation: API keys are hashed in the database. Rate limiting enforced at infrastructure level (Cloudflare) not just application level. All API key usage is logged and anomalies trigger alerts. Terms of use are legally binding.

**Threat 4 — SQL/NoSQL injection:** Attacker crafts malicious input that manipulates database queries. Mitigation: parameterized queries everywhere — no string concatenation in queries. Mongoose schema validation for MongoDB. pg parameterized queries for PostgreSQL. Input validation with Zod on all API inputs.

**Threat 5 — File upload attacks:** Attacker uploads a malicious file disguised as audio. Mitigation: presigned URLs restrict content-type to audio/* only. File size limits enforced at the CDN level (500MB max). ClamAV malware scan on every uploaded file before it is processed. Files are stored in R2 with a UUID key — never the original filename. Files are never executed.

**Threat 6 — DDoS:** Attacker floods the API with requests to take it down. Mitigation: Cloudflare DDoS protection at the network level (included in any Cloudflare plan). Rate limiting at the API level with Redis store. BullMQ job queue absorbs burst load on AI processing.

**Threat 7 — Insider threat / data breach:** A database leak exposes user personal data. Mitigation: passwords are bcrypt hashed — a leaked database reveals no plaintext passwords. Refresh tokens are hashed. API keys are hashed. Audio files are in a separate storage system from user data. GDPR-compliant data minimization — only store data that is needed.

### Security Implementation Checklist

```
Authentication
  ☐ bcrypt password hashing (12 rounds)
  ☐ JWT with 15-minute expiry (short)
  ☐ Refresh tokens with 30-day expiry, stored hashed
  ☐ Refresh token rotation on every use
  ☐ Redis blacklist for revoked access tokens
  ☐ Email verification required before full access
  ☐ TOTP-based MFA (optional for users, mandatory for admins)
  ☐ Account lockout after 10 failed login attempts
  ☐ Suspicious login email notifications
  ☐ Biometric auth via expo-local-authentication (mobile)

Authorization
  ☐ Role-based access control: listener | contributor | admin
  ☐ Row-level permissions for recording visibility
  ☐ API key authentication for research endpoints
  ☐ Contributor-only recording/upload endpoints
  ☐ Admin-only dashboard endpoints

API Security
  ☐ HTTPS only — HTTP requests redirected to HTTPS
  ☐ Helmet.js — security headers (HSTS, CSP, X-Frame-Options, etc.)
  ☐ CORS configured to allowed origins only
  ☐ Rate limiting: 100 req/15min for auth, 1000 req/hour general
  ☐ Request size limits: 10MB for JSON, 0 for file uploads (direct to R2)
  ☐ Input validation with Zod on every endpoint
  ☐ SQL parameterized queries — no string interpolation
  ☐ Mongoose strict schema — no mass assignment
  ☐ API versioning (/api/v1/) — breaking changes never affect existing clients

Infrastructure Security
  ☐ Environment variables — never hardcoded secrets
  ☐ Secrets management via Doppler or AWS Secrets Manager
  ☐ R2 bucket private — no public access — all access via signed URLs
  ☐ Signed URLs expire in 1 hour
  ☐ ClamAV malware scan on every uploaded file
  ☐ Cloudflare WAF enabled
  ☐ Database not publicly accessible — private network only
  ☐ Docker containers run as non-root user
  ☐ Dependency vulnerability scanning in CI (npm audit, pip audit)
  ☐ Sentry error tracking — no PII in error logs

Mobile Security
  ☐ Tokens stored in expo-secure-store (hardware keychain)
  ☐ SSL pinning — prevents man-in-the-middle on the API
  ☐ Root/jailbreak detection
  ☐ Screenshot prevention on sensitive screens
  ☐ Obfuscated JS bundle in production build
  ☐ No sensitive data in AsyncStorage (use SecureStore only)
  ☐ Certificate transparency monitoring

Compliance
  ☐ GDPR Article 17 — right to erasure implemented (soft delete + data export)
  ☐ COPPA — users under 13 not permitted (DOB check at registration)
  ☐ Privacy policy covering data collected, retention, rights
  ☐ Terms of service covering content license and acceptable use
  ☐ Cultural consent protocol — elder musician consent recorded and stored
```

---

## 12. API DESIGN AND CONTRACTS

### API Conventions

All endpoints follow these conventions without exception:

- Base URL: `https://api.somalimusicarchive.com/api/v1`
- Authentication: `Authorization: Bearer <jwt_token>`
- Content-Type: `application/json`
- All responses include: `{ success: boolean, data?: any, error?: { code, message } }`
- Pagination: `{ data: [], total, page, limit, hasMore }`
- Error codes are machine-readable strings: `AUTH_INVALID_TOKEN`, `RECORDING_NOT_FOUND`, etc.
- Dates in ISO 8601: `2024-01-15T10:30:00Z`
- IDs are UUIDs for PostgreSQL resources, MongoDB ObjectIds (as strings) for content

### Core Endpoints

```
AUTH
POST   /auth/register          → { user, accessToken, refreshToken }
POST   /auth/login             → { user, accessToken, refreshToken }
POST   /auth/refresh           → { accessToken, refreshToken }
POST   /auth/logout            → { success: true }
POST   /auth/verify-email      → { success: true }
POST   /auth/forgot-password   → { success: true }
POST   /auth/reset-password    → { success: true }

RECORDINGS
GET    /recordings             → { data: Recording[], pagination }
GET    /recordings/:id         → { data: Recording }
GET    /recordings/:id/audio   → { data: { url, expiresAt } }
GET    /recordings/:id/pitch   → { data: PitchData[] }
GET    /recordings/similar/:id → { data: Recording[] }
POST   /recordings/upload-url  → { data: { uploadUrl, fileKey, recordingId } }
POST   /recordings/upload-complete → { data: Recording }
PATCH  /recordings/:id         → { data: Recording }  (admin only)

SEARCH
GET    /search?q=&genre=&region=&era= → { data: SearchResult[] }

ARTISTS
GET    /artists                → { data: Artist[] }
GET    /artists/:id            → { data: Artist }
GET    /artists/:id/recordings → { data: Recording[] }

LESSONS
GET    /lessons/modules        → { data: Module[] }
GET    /lessons/modules/:id    → { data: Module with lessons }
GET    /lessons/:id            → { data: Lesson }
POST   /lessons/:id/progress   → { data: Progress }

USERS
GET    /users/me               → { data: User }
PATCH  /users/me               → { data: User }
GET    /users/me/saved         → { data: Recording[] }
POST   /users/me/saved/:id     → { data: { saved: true } }
DELETE /users/me/saved/:id     → { data: { saved: false } }
GET    /users/me/progress      → { data: LessonProgress[] }
DELETE /users/me               → { data: { deleted: true } }  (GDPR erasure)

SUBSCRIPTIONS
GET    /subscriptions/plans    → { data: Plan[] }
POST   /subscriptions/checkout → { data: { checkoutUrl } }  (Stripe)
GET    /subscriptions/status   → { data: Subscription }
POST   /subscriptions/cancel   → { data: Subscription }
POST   /subscriptions/webhook  → (Stripe webhook endpoint)

RESEARCH API (requires API key, not JWT)
GET    /research/v1/recordings        → paginated with full metadata
GET    /research/v1/recordings/:id/audio
POST   /research/v1/similarity        → find similar recordings
GET    /research/v1/embeddings        → batch embedding export
```

---

## 13. INFRASTRUCTURE AND DEVOPS

### Local Development Setup

```bash
# Prerequisites: Node 20+, Python 3.11+, Docker Desktop

# Clone the monorepo
git clone https://github.com/khalid-ibrahim/somali-music-archive
cd somali-music-archive

# Start all services with Docker Compose
docker compose up -d
# This starts: MongoDB, PostgreSQL + pgvector, Redis, Elasticsearch

# Install and start backend API
cd apps/api && npm install && npm run dev

# Install and start Python AI service
cd apps/ai-service && pip install -r requirements.txt && uvicorn main:app --reload

# Install and start mobile app
cd apps/mobile && npm install && npx expo start

# Environment files (copy from .env.example)
cp apps/api/.env.example apps/api/.env
cp apps/ai-service/.env.example apps/ai-service/.env
cp apps/mobile/.env.example apps/mobile/.env
```

### Monorepo Structure

```
somali-music-archive/                 # git root
├── apps/
│   ├── mobile/                       # React Native — Expo
│   ├── web/                          # Next.js
│   ├── api/                          # Node.js + Express
│   └── ai-service/                   # Python + FastAPI
├── packages/
│   ├── types/                        # Shared TypeScript types
│   ├── validators/                   # Shared Zod schemas
│   └── constants/                    # Shared constants (genres, regions)
├── infrastructure/
│   ├── docker-compose.yml            # Local dev
│   ├── docker-compose.prod.yml       # Production
│   └── nginx/                        # Reverse proxy config
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Test on every PR
│       ├── deploy-api.yml            # Deploy API on merge to main
│       ├── deploy-web.yml            # Deploy web on merge to main
│       └── eas-build.yml             # Build mobile on release tag
├── docs/
│   └── ARCHITECTURE.md              # This file
└── package.json                      # Turborepo workspace config
```

### CI/CD Pipeline

```
Every Pull Request:
  → Lint (ESLint + Prettier)
  → Type check (tsc --noEmit)
  → Unit tests
  → Integration tests
  → Security scan (npm audit, pip audit)
  → Build check (does it compile without error?)

Merge to main:
  → All PR checks pass
  → API deployed to Railway staging
  → Web deployed to Vercel preview
  → E2E tests run against staging

Git tag (v1.x.x):
  → API deployed to production
  → Web deployed to Vercel production
  → EAS Build triggered → app submitted to TestFlight + Play Store internal testing

Manual approval:
  → TestFlight → App Store production
  → Play internal → Play production
```

---

## 14. SCALABILITY STRATEGY

### Phase 1 — 0 to 10,000 users (months 1–12)

Infrastructure cost: $150–400/month total.

- API: single Railway instance, 1GB RAM
- Database: MongoDB Atlas M10 ($57/month), Supabase Pro ($25/month)
- Audio storage: Cloudflare R2 (first 10GB free, then $0.015/GB/month — very cheap)
- AI processing: Modal.com on-demand GPU (pay per second of GPU use)
- Mobile: Expo EAS Build (free tier covers 30 builds/month)

At this scale, nothing needs to change architecturally. The monolith handles it easily.

### Phase 2 — 10,000 to 100,000 users (months 12–24)

Infrastructure cost: $800–2,500/month.

- API: 3–5 Railway instances behind load balancer
- Database: MongoDB Atlas M30, read replicas added
- AI service: dedicated GPU instance (Lambda Labs A10 at $0.60/hour)
- CDN: Cloudflare handles audio streaming at scale with zero code changes
- Elasticsearch: Elastic Cloud Standard plan
- BullMQ workers: 2–3 worker instances for job processing

At this scale, extract the AI service to its own deployment if processing becomes the bottleneck.

### Phase 3 — 100,000+ users (year 3+)

Infrastructure cost: $5,000–15,000/month (covered by subscription revenue).

- Migrate API to AWS ECS with auto-scaling
- MongoDB Atlas M50+ with sharding if needed
- Redis Cluster for session and cache
- Kafka for event streaming between services
- AI service on dedicated GPU cluster
- This is a good problem to have — plan for it, don't build for it yet.

### Database Indexes — Performance from Day One

Create these indexes before launch. They prevent slow queries at any scale.

```javascript
// MongoDB — Recordings collection
db.recordings.createIndex({ "artist.id": 1, "createdAt": -1 })
db.recordings.createIndex({ "genre": 1, "status": 1, "createdAt": -1 })
db.recordings.createIndex({ "region": 1, "era": 1 })
db.recordings.createIndex({ "status": 1, "visibility": 1 })
db.recordings.createIndex({ "ai.status": 1 })  // for processing queue
db.recordings.createIndex({ "createdAt": -1 })  // for recent feed

// Elasticsearch — full-text search index
// Indexed fields: title.somali, title.english, artist.name,
//                 genre, region, era, ai.transcriptEnglish
```

---

## 15. DATA PRIVACY AND CULTURAL GOVERNANCE

### Cultural Advisory Board

All decisions about the archive — what recordings are published, how they are licensed, what data about musicians is shared publicly — require approval from the Cultural Advisory Board. This board consists of elder Somali musicians, community leaders, and scholars. It is not a product team decision.

The board has veto power over: removal of any recording from public access, changes to the licensing model for the archive, any commercial use of recordings beyond subscription streaming, academic dataset releases.

### Consent Protocol

Every recording session begins with an explicit verbal consent recording stored as the first file in the session folder. The consent recording references the date, location, and purpose. The musician's verbal "yes" is the legal consent.

Musicians can withdraw consent at any time. Withdrawal results in the recording being immediately set to `visibility: "private"` and removed from search results. The file is never deleted from the archive — cultural materials are not destroyed — but they are made inaccessible.

### GDPR Compliance (applies to EU Somali diaspora users)

User data export: `GET /users/me/export` returns all personal data as JSON.
Account deletion: `DELETE /users/me` soft-deletes the user, anonymizes play history, and schedules hard delete after 30 days.
Data retention: session tokens expired after 30 days. Play history retained for 24 months then anonymized.
Third-party data sharing: none without explicit user consent.

### What Is Never Shared Without Consent

- The location of a recording session
- The full name or contact information of a musician
- Unpublished recordings
- Consent recordings themselves (these are internal documents)
- Any private communications with contributing musicians

---

## 16. BUILD SEQUENCE — PHASE BY PHASE

### Phase 0 — Foundation (weeks 1–2, before any code)

- [ ] Set up GitHub monorepo with Turborepo
- [ ] Configure EAS project (Expo Application Services)
- [ ] Set up MongoDB Atlas (free tier)
- [ ] Set up Supabase (free tier)
- [ ] Set up Cloudflare R2 bucket (private)
- [ ] Set up Doppler for secrets management
- [ ] Configure GitHub Actions CI (lint + type check)
- [ ] Register app bundle IDs: com.somalimusicarchive.app
- [ ] Set up Sentry for error tracking

### Phase 1 — Archive Core (months 1–3)

Goal: Be able to record Ahmed Ali Egal and store the recordings securely with metadata.

- [ ] React Native app skeleton with Expo Router
- [ ] Design token system implemented (colors, typography, spacing)
- [ ] Authentication screens (register, login, biometric)
- [ ] JWT + refresh token system in API
- [ ] Record screen with Web Audio + expo-av
- [ ] Metadata form with full field set
- [ ] Presigned upload URL flow (R2)
- [ ] MongoDB recording document schema
- [ ] Consent recording flow
- [ ] Admin dashboard (basic — web only)
- [ ] First recording session with Ahmed Ali Egal

### Phase 2 — Platform MVP (months 3–6)

Goal: A public-facing app that diaspora users can download and use.

- [ ] Discover tab with archive browser
- [ ] Artist profiles
- [ ] Audio player with waveform display
- [ ] Offline audio caching
- [ ] Learn tab — first 10 lessons
- [ ] Search (basic — MongoDB text search, Elasticsearch in Phase 3)
- [ ] User profiles and progress tracking
- [ ] Stripe subscription integration
- [ ] Push notifications
- [ ] App Store and Google Play submission
- [ ] Privacy policy and terms of service

### Phase 3 — Intelligence Layer (months 7–12)

Goal: AI pipeline running on all recordings. First academic paper submitted.

- [ ] Whisper speech transcription service
- [ ] CREPE pitch extraction service
- [ ] Scale-mapping function (Somali pentatonic)
- [ ] MERT embedding generation
- [ ] pgvector similarity search
- [ ] Elasticsearch full-text search
- [ ] AI-generated content displayed in app
- [ ] "Similar recordings" feature
- [ ] Research API with API key auth
- [ ] First dataset exported for academic review
- [ ] First ISMIR paper submission

### Phase 4 — Scale and Revenue (months 12–18)

Goal: $8,000+ MRR and 10,000+ users.

- [ ] Institutional license system
- [ ] Admin dashboard — full content management
- [ ] Multi-language UI (Somali, Arabic, English)
- [ ] Advanced lesson modules
- [ ] Community features (comments, collections)
- [ ] Grant application submissions (McKnight Foundation, NEA)
- [ ] First university partnership
- [ ] Performance optimization for scale

---

## 17. FILE AND FOLDER STRUCTURE

Full monorepo structure:

```
somali-music-archive/
├── apps/
│   ├── mobile/                    # React Native (Expo)
│   │   ├── app/                   # Expo Router screens
│   │   ├── components/            # UI components
│   │   ├── hooks/                 # Custom hooks
│   │   ├── stores/                # Zustand stores
│   │   ├── services/              # API + storage services
│   │   ├── theme/                 # Design tokens
│   │   ├── types/                 # TypeScript types
│   │   ├── utils/                 # Helper functions
│   │   ├── constants/             # App constants
│   │   ├── assets/                # Images, fonts, audio
│   │   ├── app.json               # Expo config
│   │   ├── eas.json               # EAS config
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── web/                       # Next.js (App Router)
│   │   ├── app/                   # Pages
│   │   ├── components/
│   │   ├── lib/
│   │   ├── next.config.js
│   │   └── package.json
│   │
│   ├── api/                       # Node.js + Express
│   │   ├── src/
│   │   │   ├── modules/           # Feature modules
│   │   │   ├── shared/            # Shared utilities
│   │   │   ├── config/            # Configuration
│   │   │   └── app.ts             # Express app
│   │   ├── prisma/                # PostgreSQL schema
│   │   ├── Dockerfile
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── ai-service/                # Python FastAPI
│       ├── routers/               # API routes
│       ├── models/                # ML model loading
│       ├── services/              # Business logic
│       ├── utils/                 # Helpers
│       ├── main.py                # FastAPI app
│       ├── Dockerfile
│       └── requirements.txt
│
├── packages/
│   ├── types/                     # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── recording.ts
│   │   │   ├── user.ts
│   │   │   ├── lesson.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── validators/                # Shared Zod schemas
│   │   ├── src/
│   │   │   ├── recording.ts
│   │   │   ├── user.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── constants/                 # Shared constants
│       ├── src/
│       │   ├── genres.ts
│       │   ├── regions.ts
│       │   ├── languages.ts
│       │   └── index.ts
│       └── package.json
│
├── infrastructure/
│   ├── docker-compose.yml         # Local development
│   ├── docker-compose.prod.yml    # Production reference
│   └── nginx/
│       └── nginx.conf
│
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── deploy-api.yml
│       ├── deploy-web.yml
│       └── eas-build.yml
│
├── docs/
│   ├── ARCHITECTURE.md            # This file
│   ├── API.md                     # Full API reference
│   ├── SECURITY.md                # Security procedures
│   └── CONTRIBUTING.md            # How to contribute
│
├── turbo.json                     # Turborepo config
├── package.json                   # Workspace root
└── .gitignore
```

---

## 18. ENVIRONMENT VARIABLES AND SECRETS

Every service has a `.env.example` file committed to git with placeholder values. The actual secrets live in Doppler (or AWS Secrets Manager) and are never committed.

### API Environment Variables

```bash
# apps/api/.env.example

# Server
NODE_ENV=development
PORT=3001
API_URL=http://localhost:3001

# JWT
JWT_ACCESS_SECRET=CHANGE_ME_32_CHAR_MINIMUM
JWT_REFRESH_SECRET=CHANGE_ME_32_CHAR_MINIMUM
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d

# Databases
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/somali-archive
POSTGRES_URL=postgresql://user:password@localhost:5432/somali_archive
REDIS_URL=redis://localhost:6379

# Cloudflare R2 (S3-compatible)
R2_ACCOUNT_ID=CHANGE_ME
R2_ACCESS_KEY_ID=CHANGE_ME
R2_SECRET_ACCESS_KEY=CHANGE_ME
R2_BUCKET_NAME=somali-audio-archive
R2_PUBLIC_DOMAIN=https://cdn.somalimusicarchive.com

# Stripe
STRIPE_SECRET_KEY=sk_live_CHANGE_ME
STRIPE_WEBHOOK_SECRET=whsec_CHANGE_ME
STRIPE_PREMIUM_PRICE_ID=price_CHANGE_ME
STRIPE_INSTITUTIONAL_PRICE_ID=price_CHANGE_ME

# Email
RESEND_API_KEY=CHANGE_ME
EMAIL_FROM=noreply@somalimusicarchive.com

# AI Service
AI_SERVICE_URL=http://localhost:8000
AI_SERVICE_API_KEY=CHANGE_ME_INTERNAL_KEY

# Sentry
SENTRY_DSN=https://CHANGE_ME@sentry.io/CHANGE_ME
```

### Mobile Environment Variables

```bash
# apps/mobile/.env.example
EXPO_PUBLIC_API_URL=http://localhost:3001/api/v1
EXPO_PUBLIC_SENTRY_DSN=CHANGE_ME
EXPO_PUBLIC_POSTHOG_KEY=CHANGE_ME
```

---

## 19. TESTING STRATEGY

### Test Pyramid

```
           /\
          /E2E\           ← Detox (mobile E2E) — 10 critical flows
         /------\
        /  Int.  \        ← Supertest (API integration) — every endpoint
       /----------\
      /    Unit    \      ← Jest (logic, utilities, validators) — high coverage
     /--------------\
```

### Unit Tests — Jest

Coverage target: 80% for utilities, validators, and business logic functions. Not 100% — coverage theater wastes time. Focus on functions that have branches (if/else) and can fail in surprising ways.

```
Test files live next to source files: recorder.ts → recorder.test.ts
```

### Integration Tests — Supertest

Every API endpoint gets at least 3 tests: happy path, unauthorized (no token), invalid input. Authentication endpoints get additional edge cases: expired tokens, revoked tokens, brute force attempts.

### E2E Tests — Detox (Mobile)

Ten critical user flows tested on real device simulators:

1. Register → verify email → log in
2. Browse archive → play a recording
3. Search for a song → find it → play it
4. Start a lesson → complete it → see progress updated
5. Save a recording → find it in saved list
6. Record → fill metadata → save to archive
7. Subscribe to Premium → verify access unlocked
8. Log out → log back in
9. Use the app offline → reconnect → data syncs
10. Request account deletion → confirm → verify anonymized

---

## 20. MIT PORTFOLIO AND ACADEMIC STRATEGY

### What This Project Represents for a PhD Application

A PhD application to MIT's music technology program (or McGill, Stanford CCRMA, or UC Berkeley CNMAT) asks: has this applicant demonstrated the ability to identify a research problem, design a methodology, collect data, and produce results? This project answers yes to all four — with real data, a real collaborator, and a working system.

### The Three Papers to Target

**Paper 1 — Dataset paper (target: ISMIR, year 1)**
Title: "SomaliMusicCorpus: A Labeled Dataset of Traditional Somali Music for Music Information Retrieval Research"
Content: Description of the archive — collection methodology, annotation schema, inter-annotator agreement, statistical analysis of the corpus, baseline pitch detection results. You do not need a novel model. A novel dataset is a contribution.
Co-authors: Ahmed Ali Egal (as cultural contributor and knowledge holder), any faculty collaborator you engage.

**Paper 2 — Model paper (target: ISMIR or ICASSP, year 2)**
Title: "Adapting Automatic Music Transcription for Non-Western Oral Traditions: A Case Study in Somali Pentatonic Music"
Content: Fine-tuned CREPE model for Somali scale, evaluation methodology, comparison to baseline Western-trained AMT models, analysis of microtonal deviation patterns in the corpus.

**Paper 3 — Framework paper (target: NeurIPS or ICML, year 2–3)**
Title: "Toward Culturally Equitable Music AI: A Framework for Preserving Oral Musical Traditions with Self-Supervised Audio Models"
Content: Generalizable methodology for applying modern audio AI to any undocumented oral musical tradition. Somali music as the case study. Implications for preservation of other endangered traditions.

### How to Frame the Application Narrative

"I am a Somali-American software engineer and oud player. I identified a critical gap at the intersection of cultural preservation and music AI: the near-total absence of machine-processable data for Somali traditional music, which is an oral tradition that will be irrecoverably lost within a generation. I have taken concrete action to address this gap: I have established a recording partnership with Ahmed Ali Egal, a founding member of the Waaberi Band — Somalia's greatest musical institution — and built the technical infrastructure to capture, preserve, and analyze this material. I am applying to pursue the rigorous AI research needed to complete this work at the level it deserves."

This narrative is specific, urgent, and yours alone. No other applicant in the world can write it.

---

*End of architecture document.*
*Version 1.0 — Prepared June 2024*
*Author: Khalid Ibrahim*
*For questions or contributions: See CONTRIBUTING.md*
