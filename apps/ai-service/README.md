# AI Service

Python + FastAPI service for the Somali Music AI Preservation Platform
(ARCHITECTURE.md §10). Transcription (Whisper), pitch extraction + Somali scale
mapping (CREPE), and audio embeddings (MERT).

## Run

```bash
cd apps/ai-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn main:app --reload      # http://localhost:8000  (docs at /docs)
```

## Test

The scale-mapping tests are pure and need no ML wheels:

```bash
pip install pytest        # or requirements-dev.txt for the full stack
pytest
```

## Design notes

- **Lazy models.** Whisper/MERT load on first use (`models/registry.py`), so the
  service boots instantly and the pure tests run without torch/crepe.
- **Internal only.** Every analysis endpoint requires the shared `x-internal-key`
  header (`deps.py`); the service is not publicly routable in production.
- **The science is testable.** `services/scale.py` (the microtonality/cents
  computation — the core research contribution) is stdlib-only and unit-tested.
