"""Render ``docs/data/AHMED_CORPUS_INVENTORY.md`` from the Stage 1 inventory.

Reads ``data/inventory/ahmed_classified.jsonl`` (ahmed_classify.py) and falls
back to ``data/inventory/ahmed_files.jsonl`` (ahmed_extract.py) when the
classification has not run; ``data/inventory/ahmed_classifier.json`` supplies
the cross-validation report for the method section. Every number in the
document is computed from those files and every parameter or word list in the
method section is imported from ``ahmed_extract`` / ``ahmed_classify``;
nothing is hand-typed.

Sections, in order: the headline table (unique songs = number of song groups;
unique hours = hours of non-excluded, unique-by-sha files; hours of isolated
oud, isolated vocals, full mix, drums, synth/rap = non-qaraami material to
exclude, other, unclassified; then the two review counts: third-party
suspects whose rights are unverified, and shared files whose song group is
ambiguous), a per-source-group table, a per-project table (project, song
group, kind, files, unique hours, mixdown file, stems, third-party count,
content mix), the song groups that merge several projects with the evidence,
the rights-review table (imports, ``_mixed`` downloads, ``xml`` bases), the
ambiguous shared files, the exclusion list with reasons, the unclassified list
(with the classifier's prediction, which ``content`` withholds), and a method
section stating how the labels were produced (seed rules, CV accuracy,
thresholds, aliases, all read from the classifier report and the modules).

Usage (from apps/ai-service):
  python -m scripts.ahmed_inventory_doc [--classified data/inventory/ahmed_classified.jsonl] \
      [--files data/inventory/ahmed_files.jsonl] [--report data/inventory/ahmed_classifier.json] \
      [--out docs/data/AHMED_CORPUS_INVENTORY.md]
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from scripts.ahmed_classify import (
    ALIASES,
    HINT_WORDS,
    LABELS,
    PROB_MIN,
    THIRD_PARTY_REASONS,
    THRESHOLDS,
    assign_song_groups,
    name_hints,
    project_summary,
    third_party,
)
from scripts.ahmed_extract import (
    CANONICAL_RANK,
    MIN_DURATION_S,
    MIXDOWN_WORD_LIST,
    SILENCE_FLOOR_DB,
    SILENCE_FRAME_MS,
    SILENCE_SR,
    SILENT_FRACTION,
)

REPO = Path(__file__).resolve().parents[3]
DEFAULT_CLASSIFIED = "data/inventory/ahmed_classified.jsonl"
DEFAULT_FILES = "data/inventory/ahmed_files.jsonl"
DEFAULT_REPORT = "data/inventory/ahmed_classifier.json"
DEFAULT_OUT = "docs/data/AHMED_CORPUS_INVENTORY.md"
SOURCE_GROUPS = ("garageband", "logic", "ahmed_collection")
EXCLUDE_GENRES = ("synth", "rap")


def words(key: str) -> str:
    return "/".join(HINT_WORDS[key])


def seed_rules_text() -> dict[str, str]:
    """One line per seed label, built from the module's word lists and thresholds."""
    t = THRESHOLDS
    return {
        "oud": f"name has {words('oud')}, or source_group ahmed_collection with vocal_fraction < {t['OUD_VAD_MAX']} "
               "and no \"mixed\" in the name",
        "voice": f"name has {words('voice')} (cod also as a suffix) and (vocal_fraction >= {t['VOICE_VAD_MIN']}, or "
                 f"voiced_fraction >= {t['VOICE_VOICED_MIN']} with percussive_ratio < {t['VOICE_PERC_MAX']}); or, without a "
                 f"name hint, vocal_fraction >= {t['VOICE_VAD_STRONG']} with percussive_ratio < {t['VOICE_PERC_MAX']} on a "
                 "non-mixdown role",
        "drums": f"name has {words('drums')}, or percussive_ratio >= {t['DRUMS_PERC_MIN']} with voiced_fraction < "
                 f"{t['DRUMS_VOICED_MAX']}",
        "synth": f"name has {words('synth')}, or spectral_flatness_mean >= {t['SYNTH_FLATNESS_MIN']} on a .caf file",
        "full_mix": f"role_guess is mixdown (Output/, Bounces/, \"Output 1-2\" or a name with {'/'.join(MIXDOWN_WORD_LIST)})",
        "rap": f"name (or the project, for generic take names) has {words('rap')}; takes precedence over every other rule",
        "other": "never seeded; assigned to files whose features could not be computed",
    }


def hours(rows: list[dict[str, Any]]) -> float:
    return sum(float(r.get("duration_s") or 0.0) for r in rows) / 3600.0


def fmt_h(h: float) -> str:
    return f"{h:.2f}"


def md_table(headers: list[str], rows: list[list[Any]]) -> str:
    def cell(v: Any) -> str:
        return "" if v is None else str(v).replace("|", "\\|").replace("\n", " ")

    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines += ["| " + " | ".join(cell(v) for v in r) + " |" for r in rows]
    return "\n".join(lines)


def load_rows(classified: Path, files: Path) -> tuple[list[dict[str, Any]], bool, dict[str, dict[str, Any]]]:
    """(rows, classified_available, song_groups report). Falls back to the raw
    inventory; song groups and the rights flag are (re)computed with the same
    functions the classifier uses, so an older classified file renders too."""
    src = classified if classified.exists() else files
    if not src.exists():
        raise SystemExit(f"no inventory at {classified} or {files}")
    rows = [json.loads(line) for line in src.read_text().splitlines() if line.strip()]
    available = src == classified
    for r in rows:
        r["hints"] = r.get("hints") or name_hints(r["name"], r.get("project", ""))
        if "third_party_suspect" not in r:
            r["third_party_suspect"], r["third_party_reason"] = third_party(r)
        if not available:
            r.setdefault("content", None)
            r.setdefault("predicted_content", None)
            r.setdefault("content_prob", None)
            r.setdefault("unclassified", not r.get("excluded"))
    _, song_groups = assign_song_groups(rows)
    return rows, available, song_groups


def content_of(r: dict[str, Any]) -> str:
    """Bucket a kept row: its content label, or "unclassified" when flagged / missing."""
    if r.get("unclassified") or not r.get("content"):
        return "unclassified"
    return str(r["content"])


def headline(rows: list[dict[str, Any]], song_groups: dict[str, dict[str, Any]]) -> list[list[Any]]:
    kept = [r for r in rows if not r.get("excluded")]
    buckets: dict[str, list[dict[str, Any]]] = {k: [] for k in (*LABELS, "unclassified")}
    for r in kept:
        buckets[content_of(r)].append(r)
    n_songs = len({r["song_group"] for r in kept})
    merged = sum(1 for g, e in song_groups.items() if len(e["projects"]) > 1 and any(r["song_group"] == g for r in kept))
    suspects = [r for r in kept if r.get("third_party_suspect")]
    ambiguous = [r for r in kept if r.get("group_ambiguous")]
    out: list[list[Any]] = [
        ["unique songs (song groups)", n_songs, f"{merged} groups span several projects"],
        ["unique hours (non-excluded, unique by sha256)", fmt_h(hours(kept)), f"{len(kept)} files"],
        ["isolated oud", fmt_h(hours(buckets["oud"])), f"{len(buckets['oud'])} files"],
        ["isolated vocals", fmt_h(hours(buckets["voice"])), f"{len(buckets['voice'])} files"],
        ["full mix", fmt_h(hours(buckets["full_mix"])), f"{len(buckets['full_mix'])} files"],
        ["drums", fmt_h(hours(buckets["drums"])), f"{len(buckets['drums'])} files"],
        ["synth / beats / rap (non-qaraami, to exclude)",
         fmt_h(sum(hours(buckets[k]) for k in EXCLUDE_GENRES)),
         f"{sum(len(buckets[k]) for k in EXCLUDE_GENRES)} files"],
        ["other", fmt_h(hours(buckets["other"])), f"{len(buckets['other'])} files"],
        ["unclassified", fmt_h(hours(buckets["unclassified"])), f"{len(buckets['unclassified'])} files"],
        ["imports / third-party suspects (rights unverified, counted in the rows above)",
         fmt_h(hours(suspects)), f"{len(suspects)} files"],
        ["shared files with an ambiguous song group (counted in the rows above)",
         fmt_h(hours(ambiguous)), f"{len(ambiguous)} files"],
    ]
    return out


def per_source(rows: list[dict[str, Any]]) -> list[list[Any]]:
    out = []
    for g in SOURCE_GROUPS:
        sub = [r for r in rows if r["source_group"] == g]
        if not sub:
            continue
        kept = [r for r in sub if not r.get("excluded")]
        readable = [r for r in sub if r.get("duration_s")]
        content = Counter(content_of(r) for r in kept)
        mix = ", ".join(f"{k} {fmt_h(hours([r for r in kept if content_of(r) == k]))}" for k, _ in content.most_common())
        out.append([g, len(sub), fmt_h(hours(readable)), len(kept), fmt_h(hours(kept)),
                    len(sub) - len(kept), len({r["project"] for r in kept}), len({r["song_group"] for r in kept}),
                    sum(1 for r in kept if r.get("third_party_suspect")), mix])
    return out


def per_project(rows: list[dict[str, Any]]) -> list[list[Any]]:
    projects = project_summary(rows)
    out = []
    for key in sorted(projects, key=lambda k: (SOURCE_GROUPS.index(projects[k]["source_group"]), projects[k]["project"].lower())):
        p = projects[key]
        members = [r for r in rows if not r.get("excluded") and f"{r['source_group']}/{r['project']}" == key]
        content = Counter(content_of(r) for r in members)
        mixdown = Path(p["mixdown"]).name if p["mixdown"] else ""
        out.append([p["project"], p["song_group"], p["project_kind"], p["files"], fmt_h(p["hours_unique"]),
                    mixdown, len(p["stems"]), p["third_party_suspects"],
                    ", ".join(f"{k} {v}" for k, v in sorted(content.items()))])
    return out


def merged_groups(song_groups: dict[str, dict[str, Any]]) -> list[list[Any]]:
    out = []
    for g, e in song_groups.items():
        if len(e["projects"]) > 1:
            out.append([g, len(e["projects"]), ", ".join(e["projects"]), e["kept"], fmt_h(e["hours"]),
                        "; ".join(e["merged_by"]) or "same song key"])
    return sorted(out, key=lambda x: (-int(x[1]), str(x[0])))


def rights_review(rows: list[dict[str, Any]]) -> list[list[Any]]:
    out = []
    for r in rows:
        if r.get("excluded") or not r.get("third_party_suspect"):
            continue
        out.append([r["path"], r.get("third_party_reason"), r.get("role_guess"), r.get("content") or "",
                    fmt_h(hours([r])) if r.get("duration_s") else ""])
    return sorted(out, key=lambda x: (str(x[1]), str(x[0])))


def ambiguous_shared(rows: list[dict[str, Any]]) -> list[list[Any]]:
    out = []
    for r in rows:
        if r.get("excluded") or not r.get("group_ambiguous"):
            continue
        out.append([r["path"], r.get("song_group"), ", ".join(r.get("shared_projects") or []),
                    fmt_h(hours([r])) if r.get("duration_s") else ""])
    return sorted(out, key=lambda x: (str(x[1]), str(x[0])))


def exclusions(rows: list[dict[str, Any]]) -> list[list[Any]]:
    out = []
    for r in rows:
        if r.get("excluded"):
            out.append([r["path"], r.get("exclude_reason"), fmt_h(hours([r])) if r.get("duration_s") else "",
                        r.get("dup_of_path") or ""])
    return sorted(out, key=lambda x: (str(x[1]), str(x[0])))


def unclassified(rows: list[dict[str, Any]]) -> list[list[Any]]:
    out = []
    for r in rows:
        if r.get("excluded") or not r.get("unclassified"):
            continue
        predicted = r.get("predicted_content") or r.get("content")
        reason = "seed conflict: " + "/".join(r.get("seed_candidates") or []) if r.get("seed_conflict") else (
            "no classification" if predicted is None else f"content_prob < {PROB_MIN}")
        out.append([r["path"], predicted or "", "" if r.get("content_prob") is None else f"{r['content_prob']:.2f}",
                    r.get("seed_label") or "", reason])
    return sorted(out, key=lambda x: str(x[0]))


def method(report: dict[str, Any] | None, classified_available: bool) -> str:
    lines = ["## Method", ""]
    lines.append("Inventory: `apps/ai-service/scripts/ahmed_extract.py` (ffprobe metadata, full-file sha256 as file identity, "
                 f"silence fraction over {SILENCE_FRAME_MS} ms frames of a {SILENCE_SR // 1000} kHz mono decode below "
                 f"{SILENCE_FLOOR_DB:g} dBFS, role guess from location and name with mixdown words "
                 f"{'/'.join(MIXDOWN_WORD_LIST)}; exclusion rules: overview_cache, unreadable, apple_loop (every .caf file "
                 f"plus Apple loop names of the form `<Loop words> NN`), silent (silence fraction > {SILENT_FRACTION} or "
                 f"duration < {MIN_DURATION_S:g} s), duplicate (same sha256 as an earlier file in canonical order "
                 f"{' > '.join(CANONICAL_RANK)}, then project, name, mtime; the first copy survives with `also_in`)). "
                 "Rights flag `third_party_suspect` (reasons " + ", ".join(THIRD_PARTY_REASONS) + "): a track-numbered "
                 "import under Media/Audio Files, a `_mixed` name, an `xml` imported instrumental base; these rows keep "
                 "their content label and stay in every table above, so they must be excluded from training sets until "
                 "their rights are settled.")
    lines.append("")
    if not classified_available:
        lines.append("Classification: **not run** (`data/inventory/ahmed_classified.jsonl` missing); every kept file is "
                     "listed as unclassified. Run `python -m scripts.ahmed_classify` and regenerate this page.")
        lines.append("")
        lines.append(grouping_text())
        return "\n".join(lines)
    lines.append("Classification: `apps/ai-service/scripts/ahmed_classify.py`. Features per file over up to "
                 f"{(report or {}).get('chunks', '?')} evenly spaced 30 s windows: MERT-v1-95M last-layer mean embedding (768-d), "
                 "Silero VAD vocal_fraction, HPSS percussive_ratio and onset strength, torchcrepe voiced_fraction and PCS, "
                 "spectral flatness. Seed labels from these rules (a file matching several rules is a seed conflict and "
                 "stays unclassified):")
    lines.append("")
    rules = seed_rules_text()
    for label in LABELS:
        lines.append(f"- `{label}`: {rules[label]}")
    lines.append("")
    if report:
        skipped = int(report.get("eligible_not_processed") or 0)
        if skipped:
            lines.append(f"**Partial classification: {skipped} of {report.get('eligible', '?')} eligible files were not "
                         "processed (`--limit`); the totals above cover the processed rows only.**")
            lines.append("")
        lines.append(f"Model: {report.get('model', '?')} on {report.get('features', '?')}. "
                     f"Seeds: {report.get('n_seeds', '?')} of {report.get('n_rows', '?')} rows "
                     f"({', '.join(f'{k} {v}' for k, v in (report.get('seed_counts') or {}).items()) or 'none'}).")
        cv = report.get("cv")
        if cv:
            per = cv.get("per_class") or {}
            per_txt = ", ".join(f"{k} F1 {v['f1-score']:.2f} (n={int(v['support'])})" for k, v in per.items() if isinstance(v, dict) and "f1-score" in v)
            lines.append(f"Cross-validation: stratified {cv['n_splits']}-fold on the seeds, accuracy {cv['accuracy']:.3f}, "
                         f"balanced accuracy {cv['balanced_accuracy']:.3f}; per class: {per_txt}.")
        else:
            lines.append(f"Cross-validation: not available ({report.get('note', 'no report')}).")
        lines.append(f"Prediction: predicted_content = argmax over every processed row; a row is unclassified when "
                     f"content_prob < {PROB_MIN} or on a seed conflict, and its `content` is then null (only confident rows "
                     f"carry a label). Rows processed {report.get('rows_processed', '?')}, usable {report.get('rows_usable', '?')}, "
                     f"unclassified {report.get('unclassified', '?')}, seed conflicts {report.get('seed_conflicts', '?')}; "
                     f"device {report.get('device', '?')}, {report.get('elapsed_s', '?')} s.")
    else:
        lines.append("Classifier report (`data/inventory/ahmed_classifier.json`) missing: CV accuracy not available.")
    lines.append("")
    lines.append(grouping_text())
    lines.append("")
    lines.append("Thresholds: " + ", ".join(f"{k} = {v}" for k, v in THRESHOLDS.items()) + ".")
    return "\n".join(lines)


def grouping_text() -> str:
    aliases = ", ".join(f"{a} -> {b}" for a, b in ALIASES.items())
    return ("Song grouping: `ahmed_classify.song_group()` NFKD-folds the project / bundle / file name to ASCII lowercase, "
            "drops numbers, genre words, Somali function words and take/variant/role tags, keeps the first remaining word "
            "with doubled vowels collapsed and `ey` -> `ay`, then applies the aliases " + aliases + ". Generic bundle "
            "names (My Song N, untitled, AUDIO-…, a bare number) keep their digits. `assign_song_groups()` keys a titled "
            "file by its own title and a generic take by its project, then merges keys when a title names its project's "
            "song (a shared content word) or the project is generic, and when two projects hold a byte-identical "
            "recorded take (`#NN` .aif, a \"Save As\" lineage). Any other shared file (imports, drum stems, stale "
            "Output.aif copies) does not merge its hosts: a titled one keeps its title's group, a generic one takes "
            "the majority group of its hosts and is flagged `group_ambiguous` when they disagree. The chosen mixdown "
            "per project is its longest non-excluded mixdown-role file.")


def render(rows: list[dict[str, Any]], report: dict[str, Any] | None, classified_available: bool,
           today: str, sources: dict[str, str], song_groups: dict[str, dict[str, Any]] | None = None) -> str:
    if song_groups is None:
        _, song_groups = assign_song_groups(rows)
    kept = [r for r in rows if not r.get("excluded")]
    parts = [f"# Ahmed Ilkacase corpus inventory (Stage 1, {today})", ""]
    parts.append("Consented, trainable sessions (rights: `ahmed_ilkacase_consented`, see `docs/DATA_PROVENANCE.md`), "
                 "except the rows flagged `third_party_suspect` in the rights-review section, whose rights are unverified. "
                 f"Generated by `apps/ai-service/scripts/ahmed_inventory_doc.py` from `{sources['rows']}`"
                 + (f" and `{sources['report']}`" if report else "") + "; every number below is computed from those files. "
                 "Audio never enters git; paths are repo-relative.")
    parts.append("")
    parts.append("## Headline")
    parts.append("")
    parts.append(md_table(["measure", "value", "note"], headline(rows, song_groups)))
    parts.append("")
    parts.append(f"{len(rows)} files inventoried, {len(kept)} kept, {len(rows) - len(kept)} excluded. Content hours count "
                 "only rows whose label is confident; flagged rows are in the unclassified row, so the content rows plus "
                 "unclassified sum to the unique hours. The two review rows overlap the content rows.")
    parts.append("")
    parts.append("## By source group")
    parts.append("")
    parts.append(md_table(["source_group", "files", "hours (all readable)", "kept", "kept hours", "excluded", "projects",
                           "song groups", "third-party suspects", "content hours"], per_source(rows)))
    parts.append("")
    parts.append("## By project")
    parts.append("")
    parts.append(md_table(["project", "song_group", "kind", "files", "unique hours", "mixdown", "stems", "imports / suspects",
                           "content"], per_project(rows)))
    parts.append("")
    parts.append("## Song groups spanning several projects")
    parts.append("")
    mg = merged_groups(song_groups)
    parts.append(md_table(["song_group", "projects", "project list", "kept files", "hours", "evidence"], mg) if mg else "none")
    parts.append("")
    parts.append("## Rights review: imports and other third-party suspects")
    parts.append("")
    rr = rights_review(rows)
    parts.append(md_table(["path", "reason", "role", "content", "hours"], rr) if rr else "none")
    parts.append("")
    parts.append("## Shared files with an ambiguous song group")
    parts.append("")
    am = ambiguous_shared(rows)
    parts.append(md_table(["path", "chosen song_group", "host projects", "hours"], am) if am else "none")
    parts.append("")
    parts.append("## Excluded files")
    parts.append("")
    exc = exclusions(rows)
    reasons = Counter(str(e[1]) for e in exc)
    parts.append(", ".join(f"{k}: {v}" for k, v in sorted(reasons.items())) if exc else "none")
    parts.append("")
    parts.append(md_table(["path", "reason", "hours", "duplicate of"], exc) if exc else "")
    parts.append("")
    parts.append("## Unclassified files")
    parts.append("")
    unc = unclassified(rows)
    parts.append(md_table(["path", "predicted", "prob", "seed", "why"], unc) if unc else "none")
    parts.append("")
    parts.append(method(report, classified_available))
    parts.append("")
    return "\n".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--classified", default=DEFAULT_CLASSIFIED)
    ap.add_argument("--files", default=DEFAULT_FILES)
    ap.add_argument("--report", default=DEFAULT_REPORT)
    ap.add_argument("--out", default=DEFAULT_OUT)
    args = ap.parse_args()

    def absp(p: str) -> Path:
        return Path(p) if Path(p).is_absolute() else REPO / p

    rows, available, song_groups = load_rows(absp(args.classified), absp(args.files))
    report_path = absp(args.report)
    report = json.loads(report_path.read_text()) if available and report_path.exists() else None
    sources = {"rows": args.classified if available else args.files, "report": args.report}
    text = render(rows, report, available, date.today().isoformat(), sources, song_groups)
    out = absp(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    kept = sum(1 for r in rows if not r.get("excluded"))
    suspects = sum(1 for r in rows if not r.get("excluded") and r.get("third_party_suspect"))
    print(f"wrote {args.out}: {len(rows)} rows, {kept} kept, {suspects} third-party suspects, "
          f"{len({r['song_group'] for r in rows if not r.get('excluded')})} song groups, classified={available}, "
          f"report={'yes' if report else 'no'}")


if __name__ == "__main__":
    main()
