"""Second-pass rights and relevance review of the internet downloads (qaraami-v2 Phase 1).

`internet_acquire.py` accepts an item when its licence metadata permits reuse (a
YouTube "Creative Commons Attribution" flag, a CC/PD licenceurl on the Internet
Archive). Two things that flag cannot tell us are decided here, from the item's
title and uploader, with every decision written down for a human audit:

1. **Relevance.** A YouTube search for "kaban" returns Escape-from-Tarkov gaming
   videos (Kaban is a boss), Kurdish "Kaban" programmes, Sudanese oud institutes,
   Wikipedia audio articles, memes and pranks. Those are not Somali music and are
   excluded outright (tier ``excluded_not_somali_music``; the inventory row gets
   ``excluded=True``), whatever the classifier says about them.
2. **Who declared the licence.** A CC-BY flag set by the uploader only means
   something when the uploader is credibly the producer of that recording. Items
   that (a) the acquisition flagged as possible Harvard-collection duplicates,
   (b) carry archival markers in the title ("with lyrics", "original", "xusuustii"
   = in memory of, "codkii" = the voice of, "Radio Muqdisho 1965", ...) or (c) name
   a classic performer of the 1950s-1980s are re-uploads of other people's
   recordings and drop to ``internet_research_only``. What is left is accepted as
   ``internet_cc`` only when the uploader is a producer or broadcaster channel
   (TV, Media, Studio, Production, Records, Vevo, Films, Entertainment, a festival);
   personal channels default to ``internet_research_only``.

The rules are explicit constants below so that Khalid can audit and edit them; the
report lists every item with its decision and the rule that fired. Nothing is
deleted from disk. Re-run after every acquisition pass.

Usage (from apps/ai-service):
  python -m scripts.internet_rights_review                 # report only
  python -m scripts.internet_rights_review --apply         # also rewrite tiers/rights
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DEFAULT_MANIFEST = REPO / "data/internet/manifest.jsonl"
DEFAULT_INVENTORY = REPO / "data/inventory/internet_files.jsonl"
DEFAULT_CLASSIFIED = REPO / "data/inventory/internet_classified.jsonl"
DEFAULT_REPORT = REPO / "docs/data/INTERNET_RIGHTS_REVIEW.md"

TIER_CC = "internet_cc"
TIER_RESEARCH = "internet_research_only"
TIER_EXCLUDED = "excluded_not_somali_music"

# --- relevance: not Somali music at all --------------------------------------
EXCLUDE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("gaming (Escape from Tarkov's 'Kaban')", r"tarkov|sptarkov|kaban (kill|hunt|guide|spawning|wipes|is mine|'s vs)|killing kaban|kaban, imma|boss kaban"),
    ("Kurdish 'Kaban' programme / Arabic-script title", r"پڕۆگرامی|کابان|كابان|ahang|بيت العود|الخرطوم|القاهرة|الإسكندرية"),
    ("Sudanese / non-Somali oud content", r"khartoum|bait al oud|beloudgrass|bluegrass on oud|tuning notes|world of tuning"),
    ("spoken-word / encyclopaedia / meme / prank", r"wikipedia|audio article|meme sound|hello! hello!|trey456|prank|ruqya|health tips|fascinating history|somali sister|somali beauty|players training"),
    ("Ukrainian band 'Somali Yacht Club'", r"yacht club"),
    ("non-qaraami Somali content (niiko dance, beats, religious chant, wedding drums, talk)", r"\bniiko\b|\bbeatz\b|\bqasiido\b|wedding daaf|\bwaraysi\b|\bbarnaamij\b|pre-stage|hargeisa experience|qosolkii|dhismo qoys"),
)

# --- rights: re-uploads of other people's recordings --------------------------
ARCHIVAL_MARKERS = re.compile(
    r"with lyr|lyrics|lyrcs|\boriginal\b|xusuustii|xussusti|codkii|codadkii|\baun\b|waayo waayo|radio (muqdisho|hargeysa|hargeisa)|"
    r"\b19[5-8]\d\b|\bqaaci\b|\bqaraami xul\b|xul ah|legend|\bbest\b|bilaa music|halaasi",
    re.IGNORECASE,
)
CLASSIC_PERFORMERS = re.compile(
    r"magool|khadra daahir|xasan a(adan|\.) samatar|hassan adan samatar|cumar dhuule|omar dule|maxam[ae]d mooge|axmed mooge|ahmed mooge|"
    r"\bmooge\b|cali cigaal|ali cigaal|\bcigaal\b|tubeec|suleebaan|saleebaan|hibo nuur[ao]|saalax qaasi[mn]|salah kassim|maandeeq|mandeq|"
    r"cabdi salaad|beerdilaashe|dararamle|saado cali|faadum[ao] qaasim|cabdulqaadir (macalin )?juba|sayid khaliifa|gaywarow|cumar shooli|"
    r"murtiile|hanuuniye|ismaaciil aarka|cali diiriye|cali gaab|maxamed jaamac joof|cismaan gacanlow|sahra dawo|cabdi xasan dige|cadbi dige|"
    r"shey mire|aamina cali jiis|faadumo abdilaahi|caasha luula|xaliim[ao] kh|axmad cali|abwaanka|axmed naaji|amiin diini|cabdullaahi nuur|"
    r"\bkuluc\b|maxmaad axmad|faadumo qaasim|cabdillahi yarrow|yarrow",
    re.IGNORECASE,
)
# Channels whose catalogue is, by inspection of the 2026-09-26 download, re-uploads of archival
# recordings with lyric overlays: everything they declare CC-BY on is treated as research-only.
ARCHIVAL_CHANNELS = re.compile(r"geedi shaambow|m\. abshir|xogta heesaha|mk somali lyrics|iskiinos|suugaan safari|mahad health", re.IGNORECASE)
PRODUCER_CHANNEL = re.compile(
    r"\b(tv|media|studio|sterio|production|productions|records|vevo|films|entertainment|pro|group|radio|news|transcordancias|festival)\b",
    re.IGNORECASE,
)


def decide(title: str, creator: str, possible_harvard_duplicate: bool) -> tuple[str, str]:
    """(tier, reason) for one downloaded item."""
    text = f"{title} {creator}"
    for label, pattern in EXCLUDE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return TIER_EXCLUDED, f"not Somali music: {label}"
    if possible_harvard_duplicate:
        return TIER_RESEARCH, "possible re-upload of a Harvard-collection recording"
    if ARCHIVAL_MARKERS.search(title):
        return TIER_RESEARCH, "archival re-upload marker in the title (lyrics video / original / in memoriam / era)"
    if CLASSIC_PERFORMERS.search(title):
        return TIER_RESEARCH, "names a classic performer; the uploader is not the rights holder"
    if ARCHIVAL_CHANNELS.search(creator or ""):
        return TIER_RESEARCH, "channel known to re-upload archival recordings (lyric videos)"
    if PRODUCER_CHANNEL.search(creator or ""):
        return TIER_CC, "uploader is a producer/broadcaster channel declaring CC-BY on its own production"
    return TIER_RESEARCH, "personal channel; uploader-declared CC-BY on a recording of unverified authorship"


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def write_jsonl_atomic(path: Path, rows: list[dict]) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    os.replace(tmp, path)


def review(manifest: list[dict]) -> list[dict]:
    out = []
    for r in manifest:
        if r.get("source") == "file" or str(r.get("tier", "")).startswith("contrib"):
            continue  # hand-vetted sources keep their tier
        tier, reason = decide(str(r.get("title") or ""), str(r.get("creator") or ""), bool(r.get("possible_harvard_duplicate")))
        out.append({"item_id": r.get("item_id"), "title": r.get("title"), "creator": r.get("creator"), "url": r.get("url"),
                    "tier_before": r.get("tier"), "tier": tier, "reason": reason})
    return out


def apply(decisions: list[dict], manifest_path: Path, inventory_path: Path, classified_path: Path) -> dict:
    by_id = {d["item_id"]: d for d in decisions}
    stamp = time.strftime("%Y-%m-%d")
    counts: Counter = Counter()
    rows = load_jsonl(manifest_path)
    for r in rows:
        d = by_id.get(r.get("item_id"))
        if d:
            r["tier"], r["rights_review"], r["rights_reviewed_at"] = d["tier"], d["reason"], stamp
            counts[f"manifest:{d['tier']}"] += 1
    write_jsonl_atomic(manifest_path, rows)
    for path in (inventory_path, classified_path):
        inv = load_jsonl(path)
        if not inv:
            continue
        for r in inv:
            d = by_id.get(r.get("item_id"))
            if not d:
                continue
            r["rights"] = d["tier"]
            r["tier"] = d["tier"]
            r["rights_review"] = d["reason"]
            if d["tier"] == TIER_EXCLUDED:
                r["excluded"] = True
                r["exclude_reason"] = "not_somali_music"
            elif r.get("exclude_reason") == "not_somali_music":
                r["excluded"] = False
                r["exclude_reason"] = None
            counts[f"{path.name}:{d['tier']}"] += 1
        write_jsonl_atomic(path, inv)
    return dict(counts)


def render(decisions: list[dict], applied: dict | None) -> str:
    c = Counter(d["tier"] for d in decisions)
    lines = ["# Internet downloads — rights and relevance review", "",
             f"Generated {time.strftime('%Y-%m-%d %H:%M')} by `apps/ai-service/scripts/internet_rights_review.py` over "
             f"`data/internet/manifest.jsonl` ({len(decisions)} downloaded items). The licence flags were read by "
             "`internet_acquire.py`; this pass decides relevance and whether the uploader can credibly have granted the licence. "
             "Rules are the constants in the script; edit them and re-run with `--apply` to change a decision. Nothing is deleted.", "",
             "| tier | items |", "| --- | --- |"]
    for k in (TIER_CC, TIER_RESEARCH, TIER_EXCLUDED):
        lines.append(f"| {k} | {c.get(k, 0)} |")
    lines += ["", "Policy: `internet_cc` = trainable and publishable with attribution; `internet_research_only` = trainable for research "
              "adapters only (never served, never published); `excluded_not_somali_music` = not used at all.",
              "", f"Applied to the manifest/inventory: {'yes' if applied else 'no (report only)'}" + (f" — {applied}" if applied else ""), "",
              "## Decisions", "", "| item | uploader | title | tier | rule |", "| --- | --- | --- | --- | --- |"]
    for d in sorted(decisions, key=lambda d: (d["tier"], (d["creator"] or ""), (d["title"] or ""))):
        t = (d["title"] or "").replace("|", "/").replace("\n", " ")[:80]
        lines.append(f"| [{d['item_id']}]({d['url']}) | {(d['creator'] or '').replace('|', '/')[:30]} | {t} | {d['tier']} | {d['reason']} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    ap.add_argument("--inventory", default=str(DEFAULT_INVENTORY))
    ap.add_argument("--classified", default=str(DEFAULT_CLASSIFIED))
    ap.add_argument("--report-out", default=str(DEFAULT_REPORT))
    ap.add_argument("--apply", action="store_true", help="rewrite tiers/rights in the manifest, inventory and classified rows")
    args = ap.parse_args(argv)
    manifest = load_jsonl(Path(args.manifest))
    decisions = review(manifest)
    applied = apply(decisions, Path(args.manifest), Path(args.inventory), Path(args.classified)) if args.apply else None
    Path(args.report_out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.report_out).write_text(render(decisions, applied))
    print(json.dumps({"items": len(decisions), "tiers": dict(Counter(d["tier"] for d in decisions)), "applied": applied,
                      "report": args.report_out}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
