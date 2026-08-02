#!/usr/bin/env bash
# Push the API's production environment to the Vercel project
# `somali-music-archive-api`, reading values from apps/api/.env.
#
#   bash scripts/vercel-env-push.sh
#
# Values are piped to `vercel env add` and never echoed. Overrides applied for
# serverless: POSTGRES_URL is switched to the Supavisor TRANSACTION pooler
# (port 6543, pgbouncer=true, one connection per lambda), PERSISTENCE=database,
# RATE_LIMIT_BACKEND=redis, API_URL/CORS_ORIGINS point at the deployed domains.
set -euo pipefail
cd "$(dirname "$0")/../apps/api"

PROJECT_ARGS=()
getval() { sed -n "s/^$1=//p" .env | head -1; }
push() { # push <KEY> <VALUE>
  printf '%s' "$2" | vercel env add "$1" production --force > /dev/null 2>&1 \
    && echo "  ✓ $1" || { echo "  ✗ $1 failed"; exit 1; }
}

echo "Pushing production env to somali-music-archive-api..."

PASSTHROUGH="JWT_ACCESS_SECRET JWT_REFRESH_SECRET MONGODB_URI REDIS_URL \
R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_PUBLIC_DOMAIN \
STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_PREMIUM_PRICE_ID STRIPE_INSTITUTIONAL_PRICE_ID \
RESEND_API_KEY EMAIL_FROM AI_SERVICE_URL AI_SERVICE_API_KEY"
for KEY in $PASSTHROUGH; do
  VAL="$(getval "$KEY")"
  [ -n "$VAL" ] || { echo "  ✗ $KEY missing from apps/api/.env"; exit 1; }
  push "$KEY" "$VAL"
done

# Serverless-specific overrides
PG="$(getval POSTGRES_URL)"
push POSTGRES_URL "$(printf '%s' "$PG" | sed 's/:5432\//:6543\//')?pgbouncer=true&connection_limit=1"
push PERSISTENCE "database"
push RATE_LIMIT_BACKEND "redis"
push API_URL "https://somali-music-archive-api.vercel.app"
push CORS_ORIGINS "https://somali-music-archive.vercel.app"

echo "Done. Now redeploy so the new env takes effect:"
echo "  node scripts/vercel-deploy.mjs somali-music-archive-api"
