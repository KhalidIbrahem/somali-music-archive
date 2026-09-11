/**
 * pm2 process file for the local research stack (scripts/dev-up.sh).
 *
 *   api         Node API on :3001, in-memory persistence seeded from apps/api/.data/dev-store.json
 *   ai-service  FastAPI on :8000 (transcription jobs, /demo, generation proxy)
 *   web         Next.js dev server on :3000
 *
 * The MusicGen service on :8765 is a launchd user agent (com.qaraamigen.musicgen-api)
 * and is checked, not managed, by the scripts. Node comes from ~/ai/node-v22 and
 * Python from ~/ai/musicgen-env; neither needs Homebrew or sudo.
 */
const path = require('node:path');

const ROOT = __dirname;
const HOME = process.env.HOME;
const NODE_BIN = path.join(HOME, 'ai', 'node-v22', 'bin');
const PY = path.join(HOME, 'ai', 'musicgen-env', 'bin', 'python');
const PATH = `${NODE_BIN}:${process.env.PATH || '/usr/bin:/bin'}`;
const LOGS = path.join(ROOT, 'logs');

const common = {
  interpreter: 'none',
  autorestart: true,
  max_restarts: 100,
  restart_delay: 2000,
  min_uptime: 5000,
  time: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'api',
      cwd: path.join(ROOT, 'apps', 'api'),
      script: path.join(ROOT, 'node_modules', '.bin', 'tsx'),
      args: 'src/server.ts',
      env: {
        PATH,
        NODE_ENV: 'development',
        PORT: '3001',
        // The local stack never depends on the cloud databases: in-memory
        // repositories, hydrated from the seeded dev store, and an in-process
        // rate limiter. A variable set here wins over apps/api/.env.
        PERSISTENCE: 'memory',
        RATE_LIMIT_BACKEND: 'memory',
        // Every origin the web app is opened from locally: localhost and
        // 127.0.0.1 on the dev port, the Expo dev server, and this machine's
        // Tailscale address for a phone on the same tailnet.
        CORS_ORIGINS:
          'http://localhost:3000,http://127.0.0.1:3000,http://localhost:8081,http://100.65.5.120:3000',
      },
      out_file: path.join(LOGS, 'api.out.log'),
      error_file: path.join(LOGS, 'api.err.log'),
    },
    {
      ...common,
      name: 'ai-service',
      cwd: path.join(ROOT, 'apps', 'ai-service'),
      script: PY,
      // Loopback by default. `bash scripts/dev-up.sh --lan` sets
      // AI_SERVICE_HOST=0.0.0.0 so an iPad on the same network can open the
      // listening review page (/demo/review); REVIEW_HTTPS_URL is the https
      // address that page names for recording (Tailscale, when available).
      args: `-m uvicorn main:app --host ${process.env.AI_SERVICE_HOST || '127.0.0.1'} --port 8000`,
      env: { PATH, REVIEW_HTTPS_URL: process.env.REVIEW_HTTPS_URL || '' },
      out_file: path.join(LOGS, 'ai-service.out.log'),
      error_file: path.join(LOGS, 'ai-service.err.log'),
    },
    {
      ...common,
      name: 'web',
      cwd: path.join(ROOT, 'apps', 'web'),
      script: path.join(ROOT, 'node_modules', '.bin', 'next'),
      args: 'dev -p 3000',
      env: { PATH },
      out_file: path.join(LOGS, 'web.out.log'),
      error_file: path.join(LOGS, 'web.err.log'),
    },
  ],
};
