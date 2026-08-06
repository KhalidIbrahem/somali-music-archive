# CONVENTIONS.md

Project-wide engineering conventions for the Somali Music AI Preservation
Platform. These are the load-bearing rules the codebase cites; the full
rationale for each lives in docs/ARCHITECTURE.md.

## Project

Somali Music AI Preservation Platform — the first AI-powered archive of Somali
traditional music. Built by Khalid Ibrahim, Minneapolis MN.

## Stack

- Mobile: React Native, Expo SDK 57, TypeScript strict, Expo Router (SDK-versioned)
- Backend: Node.js 20, Express, TypeScript strict
- Databases: MongoDB (metadata), PostgreSQL + pgvector (users/embeddings)
- Storage: Cloudflare R2 — audio never uploads through Node.js
- Cache: Redis (Upstash)
- AI: Python 3.11, FastAPI, Whisper large-v3, CREPE, MERT-v1-95M
- Payments: Stripe

## Commands

- `cd apps/mobile && npx expo start` — mobile app
- `cd apps/api && npm run dev` — backend API
- `cd apps/ai-service && uvicorn main:app --reload` — AI service
- `npm test` — all tests

## Hard rules — never break these

- TypeScript strict, no `any` ever
- Never upload files through Node.js — always presigned R2 URLs
- Never AsyncStorage for tokens — always expo-secure-store
- bcrypt 12 rounds for all passwords
- Soft delete only — never hard delete any recording
- UUID filenames in R2 — never original filenames
- Zod validation on every single API input
- Unit tests alongside every service function

## Design tokens

- Accent: #C89B5F (oud-wood amber)
- Background: #0C0B14 (near-black)
- Fonts: Playfair Display (titles) + Nunito (body)
- Spacing: 4px base grid (studio surfaces: strict 8px)
- Semantic studio tokens: packages/constants/src/designTokens.json is the
  single source; web consumes generated apps/web/app/tokens.css
  (`npm run tokens:gen`), mobile imports via @sma/constants.

## Architecture

Full spec in docs/ARCHITECTURE.md — read before any major decision.
Database schemas in ARCHITECTURE.md Section 5. Security rules in Section 6.
Folder structure in Section 10. Build phases in Section 11.
