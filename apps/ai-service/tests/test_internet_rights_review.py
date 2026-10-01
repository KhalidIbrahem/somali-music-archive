"""internet_rights_review: relevance exclusions, archival re-uploads, producer channels, apply()."""
from __future__ import annotations

import json
from pathlib import Path

from scripts import internet_rights_review as rr


def test_decide_rules() -> None:
    assert rr.decide("100% Kaban spawning | Escape from Tarkov", "BoomBostic", False)[0] == rr.TIER_EXCLUDED
    assert rr.decide("History of Somalia | Wikipedia audio article", "wikipedia tts", False)[0] == rr.TIER_EXCLUDED
    assert rr.decide("عزة في هواك | بيت العود - الخرطوم", "Bait Al Oud - Khartoum", False)[0] == rr.TIER_EXCLUDED
    assert rr.decide("Somali Yacht Club - Pulsar | Live", "ChV Live Music Shooting", False)[0] == rr.TIER_EXCLUDED
    assert rr.decide("NIIKO SOMALI BANTU BOYS KISMAYO", "Studio Ali Adan", False)[0] == rr.TIER_EXCLUDED
    # archival re-uploads and classic performers drop to research-only even from studio channels
    tier, reason = rr.decide("Maxamad S Tubeec || Nasteexo with lyrics", "GEEDI SHAAMBOW STUDIO", True)
    assert tier == rr.TIER_RESEARCH and "Harvard" in reason
    assert rr.decide("KHADRA DAAHIR CIGE HEES KABAN MACAAN", "GEEDI SHAAMBOW STUDIO", False)[0] == rr.TIER_RESEARCH
    assert rr.decide("Heesta Dookh | Haldoor GR | Horn Cable Tv 2018", "Horn Cable Tv", False)[0] == rr.TIER_CC
    assert rr.decide("GABADH UDHALATAY DALKA SWEDEN OO QAADAYSA HEES MACAAN", "Mallay Media Pro", False)[0] == rr.TIER_CC
    assert rr.decide("KABAN QARAMI CADBI DIGE", "Faysal Abba", False)[0] == rr.TIER_RESEARCH  # classic performer
    assert rr.decide("naftu jaah wareerto kaban by samj", "sAm J hAsSaN", False)[0] == rr.TIER_RESEARCH  # personal channel
    assert rr.decide("HEESTA BEERQAAD/HADUU BEERKU QAYBSAMO", "GEEDI SHAAMBOW STUDIO", False)[0] == rr.TIER_RESEARCH  # archival channel
    assert rr.decide("Shar gudban shaydaan xijaaban by maxmaad axmad kuluc", "GEEDI SHAAMBOW STUDIO", False)[0] == rr.TIER_RESEARCH


def test_apply_rewrites_manifest_inventory_and_classified(tmp_path: Path) -> None:
    manifest = tmp_path / "manifest.jsonl"
    inv = tmp_path / "internet_files.jsonl"
    cls = tmp_path / "internet_classified.jsonl"
    items = [
        {"item_id": "a", "source": "yt", "title": "Kaban Hunt - Escape from Tarkov", "creator": "X", "tier": "internet_cc", "url": "u/a"},
        {"item_id": "b", "source": "yt", "title": "Heesta Dookh 2018", "creator": "Horn Cable Tv", "tier": "internet_cc", "url": "u/b"},
        {"item_id": "c", "source": "yt", "title": "Cumar dhuule || with lyrics", "creator": "Studio Z", "tier": "internet_cc", "url": "u/c", "possible_harvard_duplicate": True},
        {"item_id": "d", "source": "file", "title": "hand vetted", "creator": "Archive", "tier": "internet_cc", "url": "u/d"},
    ]
    manifest.write_text("".join(json.dumps(r) + "\n" for r in items))
    inv_rows = [{"item_id": i, "rights": "internet_cc", "excluded": False, "exclude_reason": None} for i in "abcd"]
    inv.write_text("".join(json.dumps(r) + "\n" for r in inv_rows))
    cls.write_text("".join(json.dumps(dict(r, content="full_mix")) + "\n" for r in inv_rows))
    decisions = rr.review(rr.load_jsonl(manifest))
    assert {d["item_id"] for d in decisions} == {"a", "b", "c"}  # the hand-vetted file source is left alone
    counts = rr.apply(decisions, manifest, inv, cls)
    m = {r["item_id"]: r for r in rr.load_jsonl(manifest)}
    assert m["a"]["tier"] == rr.TIER_EXCLUDED and m["b"]["tier"] == rr.TIER_CC and m["c"]["tier"] == rr.TIER_RESEARCH
    assert m["d"]["tier"] == "internet_cc" and "rights_review" not in m["d"]
    for path in (inv, cls):
        rows = {r["item_id"]: r for r in rr.load_jsonl(path)}
        assert rows["a"]["excluded"] is True and rows["a"]["exclude_reason"] == "not_somali_music"
        assert rows["b"]["rights"] == rr.TIER_CC and rows["c"]["rights"] == rr.TIER_RESEARCH and rows["c"]["excluded"] is False
    assert counts["manifest:excluded_not_somali_music"] == 1
    text = rr.render(decisions, counts)
    assert "| internet_cc | 1 |" in text and "Escape from Tarkov" in text
