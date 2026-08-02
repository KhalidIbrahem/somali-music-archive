# SETUP — AI music generation (Suno & Google Lyria)

How to get API access for the generation layer, what each key unlocks, and how
to run the whole flow **with no keys at all** while you wait.

The apps never talk to a provider directly: web and mobile call the Node API
(`POST /api/v1/generate` → poll `GET /api/v1/generate/:jobId`), and the API
holds the keys server-side. Every variable below goes in `apps/api/.env`
(templates + one-line docs in `apps/api/.env.example`). **Keys are never put in
web or mobile env files** — those apps only need the existing
`NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL`.

## 0. No keys yet? Everything still runs

Leave `SUNO_API_KEY` and `GEMINI_API_KEY` empty. In development the API swaps
in a built-in **fake provider** (submits a task, "generates" for ~3 seconds,
returns a short silent WAV), so app → API → provider → playback is demoable
end-to-end, offline, free. In production an empty key returns a clean
`503 GENERATION_PROVIDER_UNAVAILABLE` instead.

## 1. Google Lyria — official, available today ✅

Lyria 3 is served through Google's **Gemini API** (verified Aug 2026).

1. Go to **Google AI Studio** — <https://aistudio.google.com> — with a Google
   account and create an **API key** (free tier exists for testing; regular API
   use needs billing enabled on the key's project).
2. Put it in `apps/api/.env` as `GEMINI_API_KEY=…`.
3. Models (`LYRIA_MODEL`):
   - `lyria-3-clip-preview` — ~30-second clips, MP3. **Default; start here.**
   - `lyria-3-pro-preview` — full ~2-minute compositions (WAV) — larger files;
     in production these are staged through R2, never inlined.
4. Wire facts the client uses (already implemented in
   `apps/api/src/modules/generation/providers/lyria.ts`):
   `POST https://generativelanguage.googleapis.com/v1beta/interactions`,
   header `x-goog-api-key`, body `{ model, input }` → `output_audio` (base64) +
   `output_text` (lyrics). The call is synchronous and can take tens of
   seconds — the API's job model absorbs that (you always get a job to poll).
5. Enterprise alternative: the same models are on **Vertex AI** (public
   preview) if you later want GCP-project auth instead of an API key — that
   would be a small change inside the Lyria provider class only.

Pricing note: Lyria API usage is token-billed on the paid tier — check the
current rates at <https://ai.google.dev/gemini-api/docs/music-generation>
before opening generation to many users; the API's per-user limit
(10 generations/hour) is your cost brake.

## 2. Suno — ⚠️ no official public API (verified Aug 2026)

**Suno has not launched a public developer API.** As of mid-2026 it runs a
partner-only program — no public keys, docs, or pricing. Anything advertising
"Suno API" today is a **third-party reseller**.

This repo implements the documented reseller at **api.sunoapi.org** (the client
activates only when a key is present):

1. Sign up at <https://sunoapi.org>, buy credits, and create a key in their
   **API Key Management** page.
2. Put it in `apps/api/.env` as `SUNO_API_KEY=…`. Defaults for
   `SUNO_API_BASE_URL` (`https://api.sunoapi.org`) and `SUNO_MODEL` (`V5`)
   already match their docs.
3. Wire facts (implemented in `providers/suno.ts`): `POST /api/v1/generate`
   (Bearer auth; required `customMode`, `instrumental`, `model`, `callBackUrl`)
   → `{ data: { taskId } }`; poll `GET /api/v1/generate/record-info?taskId=…`;
   audio at `data.response.sunoData[0].audioUrl`. Their webhook requirement is
   satisfied by our no-op `POST /api/v1/generate/callback` — results are only
   ever read by authenticated polling, never trusted from the webhook.

**Read before buying**: resellers are unofficial. Terms-of-service standing
with Suno, commercial rights to the output, reliability, and refund policy are
all between you and the reseller — none of it is Suno-backed. For a public
platform, treat reseller output as experimental content. If/when Suno opens an
official API, point `SUNO_API_BASE_URL` at it and adjust only
`providers/suno.ts`; nothing else in the stack changes.

## 3. The archive's own model (`provider: "local"`)

The third provider proxies the Python ai-service's `/generate` endpoint —
today it is deliberately gated (returns a clean "not yet available" job) until
the corpus licensing audit clears (`GENERATION_ENABLED` in the ai-service) and
the fine-tuned checkpoints are wired for serving. This is the swap-in path for
the MusicGen/LoRA work in `runs/` — the apps already send `provider: "local"`
with zero client changes needed later.

## 4. Deploying to Vercel — two one-time checks

1. `apps/api/vercel.json` now sets `maxDuration: 300` for the function — needed
   because Lyria can generate for 30–90s inside one call.
2. Verify **Fluid Compute** is enabled for the API project in the Vercel
   dashboard (default-on for recent projects). The budgeted-submit design hands
   long provider calls to `waitUntil()` after responding; without Fluid
   Compute those background continuations can be frozen.
3. Push the new env vars with the existing flow: `scripts/vercel-env-push.sh`.

## 5. Smoke test (any provider, once its key is set)

```bash
cd apps/api && npm run dev
# login to get a token, then:
curl -s -X POST http://localhost:3001/api/v1/generate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"provider":"lyria","prompt":"A gentle qaraami love song with solo oud"}'
# → { success: true, data: { id, state, ... } }   then poll (≥3s apart):
curl -s http://localhost:3001/api/v1/generate/$JOB_ID -H "Authorization: Bearer $TOKEN"
```

Or just open the web app's **/generate** page / the mobile **Generation
Studio** (Profile → Generation Studio) and press Generate.
