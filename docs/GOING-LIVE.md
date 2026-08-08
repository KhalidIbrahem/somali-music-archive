# Going live — accounts, teaching, Google, and the new domain

Written 2026-08-07, alongside the accounts/teaching release. Everything here is
doable in under an hour; the code side is already deployed.

## What shipped

- **Signed-in experience**: the header now knows who you are on every page — a
  member chip with a menu (My account, Teaching studio, Admin, **Sign out**).
  Sessions survive past 15 minutes (the web app now stores the refresh token
  and renews automatically).
- **`/account`**: the member dashboard — profile, role badge, phone, editable
  display name, sign out.
- **Registration/login with email, phone, or Google**: registration takes an
  optional phone (international format, e.g. `+252 61 234 5678`); the login
  form's one identifier field accepts email or phone. Google is wired
  end-to-end but hidden until the env vars below are set.
- **Teaching**: `educator` role, `/teach` studio (write lessons, attach PDFs /
  images / audio, publish or keep as draft), public `/learn` pages. Lesson
  metadata lives in MongoDB; attachments go straight to R2 (presigned, UUID
  keys, soft delete only). The library shelf is now Mongo-backed too — uploads
  no longer vanish on serverless cold starts.

## 1 · Give Prof. Rehanna Kashogi educator access

1. Send her the register link: `https://<your-domain>/register` (works today at
   the vercel.app URL). Any account type is fine; phone is optional.
2. Ask which email she used, then from `apps/api/` run:

   ```bash
   npm run promote -- her-email@university.edu educator
   ```

   The local `.env` already points `PERSISTENCE=database` at production
   Postgres, so this updates the live row (the script prints
   `role listener → educator (database)`).

3. That's it — next time she signs in, the header menu shows **Teaching
   studio** and `/teach` unlocks. Drafts stay private until she publishes.

There is also an admin API if you prefer UI-less promotion from anywhere:
`GET /api/v1/users?q=kashogi` then `PATCH /api/v1/users/:id/role`
`{"role":"educator"}` — both admin-token only. Educators can also upload to
the Library and contribute recordings (educator ≥ contributor).

## 2 · Turn on "Continue with Google"

The button appears automatically once TWO env vars carry the same OAuth client ID:

1. [console.cloud.google.com](https://console.cloud.google.com) → APIs &
   Services → **Credentials** → Create credentials → **OAuth client ID** →
   type **Web application**.
2. Authorized JavaScript origins — add every origin the site serves from:
   - `https://somali-music-archive.vercel.app`
   - `https://<your-new-domain>` (and `https://www.<your-new-domain>`)
   - `http://localhost:3000` (dev)
   No redirect URIs are needed (the button uses the popup credential flow).
3. Copy the client ID (`…apps.googleusercontent.com`) into:
   - API Vercel project: `GOOGLE_CLIENT_ID`
   - Web Vercel project: `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   (`scripts/vercel-env-push.mjs` can push these.)
4. Redeploy **both** projects (the web value is baked at build time).

Google accounts link by email: if someone registered with password first,
Google sign-in logs into the same account and marks the email verified.

## 3 · Point the Hostinger domain at Vercel

1. In the Vercel dashboard → the **web** project (`somali-music-archive`) →
   Settings → Domains → add `yourdomain.com` (and `www`).
2. Vercel shows the records to create at Hostinger (hPanel → DNS Zone):
   - apex `A` → `76.76.21.21`
   - `www` `CNAME` → `cname.vercel-dns.com`
3. After it verifies, update the pieces that pin origins:
   - **API project env** `CORS_ORIGINS` — append
     `,https://yourdomain.com,https://www.yourdomain.com` (keep the vercel.app
     origin too), then redeploy the API.
   - **R2 CORS**: add the new origins in `scripts/r2-cors.mjs` and run it —
     otherwise browser uploads (library/lessons) fail preflight from the new
     domain.
   - **Google OAuth origins** (step 2.2) if Google is enabled.
   - Optional: web project env `NEXT_PUBLIC_API_URL` can stay on the API's
     vercel.app URL — or move the API to `api.yourdomain.com` later; only
     CORS_ORIGINS needs to match whatever the browser origin is.

## Gotchas while testing

- Auth endpoints are rate-limited **5 per 15 min per IP** — register+login
  bursts from one machine throttle themselves; wait out the window.
- The email verification mail only sends if `RESEND_API_KEY` is a real key
  with a verified sender; accounts work fine unverified (uploads for
  contributors are the only verified-email gate).
- `apps/api/api/*.mjs` is the committed serverless bundle — after touching API
  source, run `npm run build:vercel` in `apps/api` before deploying.
