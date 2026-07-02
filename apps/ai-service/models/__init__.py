"""Lazy ML model loading (ARCHITECTURE.md §10). Kept separate from routers so the
heavy weights load once, on first use, and are cached for the process lifetime."""
