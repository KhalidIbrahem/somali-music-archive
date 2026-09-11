#!/bin/bash
# Start the local demo: the AI service on http://127.0.0.1:8000/demo.
# Transcription runs inside this service; generation is proxied to the MusicGen
# service (services/musicgen-api, port 8765) when it is running.
cd "$(dirname "$0")" || exit 1
PY="${MUSICGEN_ENV_PYTHON:-$HOME/ai/musicgen-env/bin/python}"
if curl -fsS -m 2 http://127.0.0.1:8765/health >/dev/null 2>&1; then
  echo "generation service: up (127.0.0.1:8765)"
else
  echo "generation service: not reachable on 8765; the generation panel will say so"
fi
echo "demo page: http://127.0.0.1:8000/demo"
exec "$PY" -m uvicorn main:app --host 127.0.0.1 --port 8000
