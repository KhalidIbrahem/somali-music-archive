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

## Local pages

- `/demo`: upload a recording, get the score; generate with the fine-tuned
  model through the MusicGen service (`run_demo.sh`, or `scripts/dev-up.sh`
  from the repo root).
- `/demo/review`: the listening review of the annotation packs in
  `data/annotation/`, phrase by phrase, for annotators who do not read
  notation (`services/review_service.py`, `routers/review.py`,
  `static/review.html`). Verdicts and recordings go to
  `review_<name>.json` beside the pack; `export.md` lists what to fix.
  Start with `bash scripts/dev-up.sh --lan` for an iPad on the same network.

## Design notes

- **Lazy models.** Whisper/MERT load on first use (`models/registry.py`), so the
  service boots instantly and the pure tests run without torch/crepe.
- **Internal only.** Every analysis endpoint requires the shared `x-internal-key`
  header (`deps.py`); the service is not publicly routable in production.
- **The science is testable.** `services/scale.py` (the microtonality/cents
  computation — the core research contribution) is stdlib-only and unit-tested.
