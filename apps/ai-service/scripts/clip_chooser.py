"""Clip chooser: pick which generated clips the public website plays.

Only clips from releasable adapters are offered (the oud adapter and the
ACE-Step adapters trained on one performer's own recordings); Harvard-trained
adapters are research-only and never appear here. The website build has its
own gate (apps/web/scripts/check-public-audio-rights.mjs) that checks the same
rule again from the model cards.

    # 1. listen and choose (opens a page on http://127.0.0.1:8790, this Mac only)
    cd apps/ai-service && ~/ai/musicgen-env/bin/python -m scripts.clip_chooser serve

    # 2. write the chosen clips into a website checkout (transcode, scores, manifest)
    ~/ai/musicgen-env/bin/python -m scripts.clip_chooser publish --site ~/Projects/somali-music-archive

    # see every candidate in the terminal
    ~/ai/musicgen-env/bin/python -m scripts.clip_chooser list

The selection is saved to data/clip_chooser/selection.json (git-ignored with
data/). `publish` reads it, scores any clip that has no PCS / voiced yet
(scripts.pcs, CPU by default), transcodes to mono MP3 at -14 LUFS into
apps/web/public/demos/generated/, rewrites apps/web/lib/published-clips.json and
apps/web/public-audio-rights.json, removes generated clips that are no longer
chosen, and runs the rights gate. Committing and pushing stay with you.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# The data/ tree (clips, scores) lives only in the main checkout; QARAAMI_REPO points
# there when this script runs from another worktree.
REPO = Path(os.environ.get("QARAAMI_REPO") or Path(__file__).resolve().parents[3]).expanduser().resolve()
SELECTION = REPO / "data/clip_chooser/selection.json"
HOST, PORT = "127.0.0.1", 8790
RIGHTS_RE = re.compile(r"\*\*Rights class:\*\*\s*`(releasable|research_only)`")

ACE = "ACE-Step 1.5 xl-sft (4 B)"
OUD_CORPUS = "a private oud (kaban) qaraami collection, 28 songs"
CLEAN_OUD_CORPUS = (
    "isolated oud stems from one performer’s own recordings in a private collection, 5.7 hours; "
    "no archival or internet audio"
)
SONGS_CORPUS = (
    "one performer’s own songs with vocals from a private collection, lyrics machine-transcribed; "
    "no archival or internet audio"
)

# Every candidate source. kind: "ab" = blind set with ab_scores.json (adapter side),
# "genlog" = generation directory with generation_log.json, "captions" = the oud A/B set.
SOURCES: list[dict] = [
    {"key": "v4pool", "kind": "genlog", "glob": "data/v4/sD_pool", "adapterId": "ace_songs_v4", "perK": True,
     "model": ACE, "adapter": "songs-with-lyrics LoRA (v4)", "checkpoint": "v4_ace_songs_r256, epoch 6 (best-of-32 pool)",
     "corpus": SONGS_CORPUS},
    {"key": "v4", "kind": "genlog", "glob": "data/v4/sC_ckpt_r256/*", "adapterId": "ace_songs_v4",
     "model": ACE, "adapter": "songs-with-lyrics LoRA (v4)", "checkpoint": "v4_ace_songs_r256, {dir}",
     "corpus": SONGS_CORPUS},
    {"key": "v3final", "kind": "ab", "dir": "data/ab_stage3_acelora_vs_acebase", "adapterId": "ace_clean_oud",
     "model": ACE, "adapter": "clean-oud LoRA", "checkpoint": "v3_ace_xlsft, final", "corpus": CLEAN_OUD_CORPUS},
    {"key": "v3melody", "kind": "ab", "dir": "data/ab_stage4_melody_vs_text", "adapterId": "ace_clean_oud",
     "model": ACE, "adapter": "clean-oud LoRA, melody-conditioned cover",
     "checkpoint": "v3_ace_xlsft, final (cover of a transcribed held-out melody)", "corpus": CLEAN_OUD_CORPUS},
    {"key": "v3ep06", "kind": "ab", "dir": "data/ab_stageA_best_epoch_vs_final", "adapterId": "ace_clean_oud",
     "model": ACE, "adapter": "clean-oud LoRA", "checkpoint": "v3_ace_xlsft, epoch 6", "corpus": CLEAN_OUD_CORPUS},
    {"key": "oud", "kind": "captions", "dir": "data/oud_ab_listening", "adapterId": "oud",
     "model": "MusicGen-small (300 M)", "adapter": "oud adapter",
     "checkpoint": "oud_lora_r16_nodrop_20260809, step 500", "corpus": OUD_CORPUS},
]

# Scorer outputs ({dir: {"clips": [{path, pcs, voiced_fraction, band_snr_db, ...}]}}) keyed by clip path.
SCORE_FILES = ["data/v3/s3_scores.json", "data/v3/s4_scores.json", "data/v4/sA_scores.json",
               "data/v4/sC_scores.json", "data/v4/showcase_bestof32/bestof_scores.json"]


@dataclass
class Clip:
    id: str
    source: str
    path: str  # repo-relative wav
    adapterId: str
    model: str
    adapter: str
    checkpoint: str
    corpus: str
    prompt: str
    seed: int | None
    pcs: float | None = None
    voiced: float | None = None
    bandSnrDb: float | None = None
    vocals: bool = False
    lyrics: str | None = None
    extra: dict = field(default_factory=dict)


def _scores_by_path() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for f in SCORE_FILES:
        p = REPO / f
        if not p.exists():
            continue
        try:
            d = json.loads(p.read_text())
        except json.JSONDecodeError:
            continue
        # best-of-32 ranking: {"prompts": [{"ranking": [{file, pcs, voiced, band_snr_db, score}, ...]}]}
        for pr in d.get("prompts", []) if isinstance(d, dict) and isinstance(d.get("prompts"), list) else []:
            for rank, r in enumerate(pr.get("ranking", []), 1):
                if isinstance(r, dict) and "file" in r:
                    out[r["file"]] = {"pcs": r.get("pcs"), "voiced_fraction": r.get("voiced"),
                                      "band_snr_db": r.get("band_snr_db"), "autoRank": rank,
                                      "autoOf": len(pr["ranking"]), "autoScore": r.get("score")}
        for v in d.values() if isinstance(d, dict) else []:
            for c in v.get("clips", []) if isinstance(v, dict) else []:
                if isinstance(c, dict) and "path" in c:
                    out[c["path"]] = c
    return out


def _f(x) -> float | None:
    return round(float(x), 4) if isinstance(x, int | float) else None


def catalog() -> list[Clip]:
    scores = _scores_by_path()
    clips: list[Clip] = []
    for src in SOURCES:
        meta = {k: src[k] for k in ("adapterId", "model", "adapter", "corpus")}
        if src["kind"] == "ab":
            d = REPO / src["dir"]
            f = d / "ab_scores.json"
            if not f.exists():
                continue
            for p in json.loads(f.read_text())["pairs"]:
                wav = d / f"pair{p['pair']:03d}_adapter.wav"
                if not wav.exists():
                    continue
                a = p.get("adapter", {})
                sc = scores.get(a.get("source", ""), {})
                clips.append(Clip(id=f"{src['key']}_{p['pair']:03d}", source=src["dir"],
                                  path=str(wav.relative_to(REPO)), checkpoint=src["checkpoint"],
                                  prompt=p["caption"], seed=p.get("seed"), pcs=_f(a.get("pcs")),
                                  voiced=_f(a.get("voiced_fraction")), bandSnrDb=_f(sc.get("band_snr_db")),
                                  vocals="no vocals" not in p["caption"], **meta))
        elif src["kind"] == "genlog":
            for d in sorted(Path(x) for x in glob.glob(str(REPO / src["glob"]))):
                log = d / "generation_log.json"
                if not log.exists():
                    continue
                g = json.loads(log.read_text())
                for c in g.get("clips", []):
                    wav = d / c["file"]
                    if not wav.exists():
                        continue
                    rel = str(wav.relative_to(REPO))
                    sc = scores.get(rel, {})
                    cid = (f"{src['key']}_{c.get('i', 0):03d}_{c.get('k', 0):02d}" if src.get("perK")
                           else f"{src['key']}_{d.name}_{c.get('i', 0):03d}")
                    auto = {k: sc[k] for k in ("autoRank", "autoOf", "autoScore") if sc.get(k) is not None}
                    clips.append(Clip(id=cid, source=str(d.relative_to(REPO)), extra=auto,
                                      path=rel, checkpoint=src["checkpoint"].format(dir=d.name),
                                      prompt=c.get("caption", ""), seed=c.get("seed"), pcs=_f(sc.get("pcs")),
                                      voiced=_f(sc.get("voiced_fraction")), bandSnrDb=_f(sc.get("band_snr_db")),
                                      vocals=not c.get("instrumental", True), lyrics=c.get("lyrics"), **meta))
        elif src["kind"] == "captions":
            d = REPO / src["dir"]
            caps = d / "CAPTIONS.txt"
            if not caps.exists():
                continue
            for line in caps.read_text().splitlines():
                m = re.match(r"pair(\d+):\s*(.+)", line)
                wav = d / f"pair{m.group(1)}_finetuned.wav" if m else None
                if wav and wav.exists():
                    n = int(m.group(1))
                    clips.append(Clip(id=f"{src['key']}_{n:03d}", source=src["dir"], path=str(wav.relative_to(REPO)),
                                      checkpoint=src["checkpoint"], prompt=m.group(2), seed=None, **meta))
    return clips


def title_for(c: Clip) -> str:
    """A short title from the caption: "Song with vocals, 110 BPM, rooted on A"."""
    p = c.prompt
    kind = "Song with vocals" if c.vocals else ("Oud and hand drums" if "hand drums" in p else "Solo oud")
    bpm = re.search(r"(lively|moderate|slow)?\s*at (\d+) BPM", p)
    tonic = re.search(r"rooted on ([A-G][#b]?)", p)
    parts = [kind]
    if bpm:
        parts.append(f"{'lively at ' if bpm.group(1) == 'lively' else ''}{bpm.group(2)} BPM")
    if tonic:
        parts.append(f"rooted on {tonic.group(1).replace('#', '♯')}")
    return ", ".join(parts)


def duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return round(float(out.strip()), 1)


# ── serve ─────────────────────────────────────────────────────────────────────
PAGE = """<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Clip chooser</title>
<style>
:root{--bg:#0C0B14;--card:#16141f;--ink:#eee;--mid:#aaa;--accent:#C89B5F}
body{background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px;max-width:1100px;margin:auto}
h1{font-weight:600}.muted{color:var(--mid)}.card{background:var(--card);border-radius:8px;padding:12px 14px;margin:10px 0}
.card.on{outline:2px solid var(--accent)}audio{width:100%;margin:6px 0}label{margin-right:16px;white-space:nowrap}
input[type=text],textarea{width:100%;box-sizing:border-box;background:#0f0e16;color:var(--ink);border:1px solid #333;border-radius:4px;padding:6px}
.bar{position:sticky;top:0;background:var(--bg);padding:8px 0;z-index:2;border-bottom:1px solid #222}
button{background:var(--accent);color:#000;border:0;border-radius:4px;padding:8px 14px;font-weight:600;cursor:pointer}
select{background:#0f0e16;color:var(--ink);border:1px solid #333;padding:4px}.num{font-variant-numeric:tabular-nums}
details{margin-top:4px}pre{white-space:pre-wrap;color:var(--mid)}
</style>
<h1>Clip chooser</h1>
<p class=muted>Releasable adapters only (Harvard-trained adapters are never listed). Click the stars to rate (saved at once), sort by <b>my stars</b>, tick <b>Listen page</b> / <b>Generate page</b> for the best, edit the title, then <b>Save selection</b> and run <code>publish</code> (HANDOVER.md §3). The v4 pool holds 32 songs per prompt; the automatic pick per prompt is marked.</p>
<div class=bar>Show <select id=f></select> &nbsp; Sort <select id=sort><option value=stars>my stars</option><option value=auto>auto pick first</option><option value=pcs>PCS</option><option value=voiced>voiced</option><option value=none>source order</option></select>
 &nbsp; <label><input type=checkbox id=onlyon> only chosen</label> <label><input type=checkbox id=vox> vocals only</label>
 <label><input type=checkbox id=unrated> unrated only</label> <label>min ★ <select id=minr><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label>
<span class=num id=count></span> &nbsp; <button id=save>Save selection</button> <span id=msg class=muted></span></div>
<p>Listen page note (shown to visitors, say how you picked):<br><textarea id=note rows=2></textarea></p>
<div id=list></div>
<script>
const C=__CLIPS__, S=__SEL__; const sel=new Map((S.clips||[]).map(x=>[x.id,x])); const R=S.ratings||{};
const $=id=>document.getElementById(id);
function body(){return {listenNote:$('note').value,clips:[...sel.values()],ratings:R};}
async function save(quiet){const r=await fetch('/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body())});
 $('msg').textContent=r.ok?(quiet?'rating saved':'saved to data/clip_chooser/selection.json'):'save failed: '+await r.text();}
function order(){const k=$('sort').value,a=[...C];const v=c=>k==='stars'?(R[c.id]||0)*10+(c.extra.autoRank===1?1:0):k==='auto'?(c.extra.autoRank===1?2:c.extra.autoRank?1/c.extra.autoRank:0):k==='pcs'?(c.pcs??-1):k==='voiced'?(c.voiced??-1):0;
 if(k!=='none')a.sort((x,y)=>v(y)-v(x));return a;}
document.getElementById('note').value=S.listenNote||'';
const f=document.getElementById('f'); f.innerHTML='<option value="">all sources</option>'+[...new Set(C.map(c=>c.source))].map(s=>`<option>${s}</option>`).join('');
const fmt=x=>x==null?'—':x.toFixed(3);
function render(){const L=$('list');L.innerHTML='';let n=0,shown=0;
 for(const c of C){if((sel.get(c.id)?.pages||[]).length)n++;}
 for(const c of order()){const s=sel.get(c.id)||{};const on=(s.pages||[]).length>0;const st=R[c.id]||0;
  if(f.value&&c.source!==f.value)continue;if($('onlyon').checked&&!on)continue;if($('vox').checked&&!c.vocals)continue;
  if($('unrated').checked&&st)continue;if(st<+$('minr').value)continue;if(++shown>200)break;
  const d=document.createElement('div');d.className='card'+(on?' on':'');
  const stars=[1,2,3,4,5].map(i=>`<span class=star data-r=${i} style="cursor:pointer;font-size:22px;color:${i<=st?'var(--accent)':'#444'}">★</span>`).join('');
  const auto=c.extra.autoRank?` · auto rank ${c.extra.autoRank}/${c.extra.autoOf}${c.extra.autoRank===1?' <b style="color:var(--accent)">(auto pick)</b>':''}`:'';
  d.innerHTML=`<div>${stars} <span class=muted>${st?st+'/5':'not rated'}</span></div><b>${c.id}</b> <span class=muted>· ${c.model} · ${c.adapter} · ${c.checkpoint}${auto}</span>
  <div class=num>PCS ${fmt(c.pcs)} · voiced ${fmt(c.voiced)} · band SNR ${c.bandSnrDb==null?'—':c.bandSnrDb.toFixed(1)+' dB'} · seed ${c.seed??'—'} ${c.vocals?'· <b>vocals</b>':''}</div>
  <audio controls preload=none src="/audio/${encodeURIComponent(c.id)}"></audio>
  <div class=muted>${c.prompt}</div>
  ${c.lyrics?`<details><summary>lyrics (machine-transcribed)</summary><pre>${c.lyrics.replace(/[<&]/g,m=>({'<':'&lt;','&':'&amp;'}[m]))}</pre></details>`:''}
  <p><label><input type=checkbox data-p=listen ${(s.pages||[]).includes('listen')?'checked':''}> Listen page</label>
  <label><input type=checkbox data-p=generate ${(s.pages||[]).includes('generate')?'checked':''}> Generate page</label></p>
  Title <input type=text value="${(s.title||c.title).replace(/"/g,'&quot;')}">`;
  d.querySelectorAll('input[type=checkbox]').forEach(b=>b.onchange=()=>{const cur=sel.get(c.id)||{id:c.id,title:c.title,pages:[]};
   cur.pages=[...d.querySelectorAll('input[type=checkbox]')].filter(x=>x.checked).map(x=>x.dataset.p);
   cur.title=d.querySelector('input[type=text]').value; if(cur.pages.length)sel.set(c.id,cur);else sel.delete(c.id);render();});
  d.querySelectorAll('.star').forEach(x=>x.onclick=()=>{const r=+x.dataset.r;if(R[c.id]===r)delete R[c.id];else R[c.id]=r;save(true);render();});
  d.querySelector('input[type=text]').onchange=e=>{const cur=sel.get(c.id);if(cur)cur.title=e.target.value;};
  L.appendChild(d);}
 $('count').textContent=` ${n} chosen · ${Object.keys(R).length} rated · ${C.length} clips${shown>200?' (first 200 shown — filter to see more)':''}`;}
['f','sort','onlyon','vox','unrated','minr'].forEach(i=>$(i).onchange=render);
$('save').onclick=()=>save(false);
render();
</script>"""


def load_selection() -> dict:
    if SELECTION.exists():
        return json.loads(SELECTION.read_text())
    return {"listenNote": "", "clips": []}


def validate_selection(body: dict, ids: set[str]) -> dict:
    if not isinstance(body, dict) or not isinstance(body.get("clips"), list):
        raise ValueError("expected {listenNote, clips: [...]}")
    out = []
    for c in body["clips"]:
        if not isinstance(c, dict) or c.get("id") not in ids:
            raise ValueError(f"unknown clip {c!r:.80}")
        pages = [p for p in c.get("pages", []) if p in ("listen", "generate")]
        title = str(c.get("title") or "")[:80]
        if pages:
            out.append({"id": c["id"], "title": title, "pages": pages})
    raw = body.get("ratings") or {}
    ratings = {k: int(v) for k, v in raw.items() if k in ids and isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 5} \
        if isinstance(raw, dict) else {}
    return {"listenNote": str(body.get("listenNote") or "")[:400], "clips": out, "ratings": ratings}


def serve(_: argparse.Namespace) -> None:
    clips = catalog()
    by_id = {c.id: c for c in clips}
    payload = [asdict(c) | {"title": title_for(c)} for c in clips]

    class H(BaseHTTPRequestHandler):
        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            if self.path in ("/", "/index.html"):
                page = PAGE.replace("__CLIPS__", json.dumps(payload).replace("</", "<\\/")).replace(
                    "__SEL__", json.dumps(load_selection()).replace("</", "<\\/"))
                self._send(200, page.encode(), "text/html; charset=utf-8")
            elif self.path.startswith("/audio/"):
                from urllib.parse import unquote
                c = by_id.get(unquote(self.path[len("/audio/"):]))  # ids only: no path from the client
                if not c:
                    self._send(404, b"no such clip", "text/plain")
                    return
                self._send(200, (REPO / c.path).read_bytes(), "audio/wav")
            else:
                self._send(404, b"not found", "text/plain")

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/save":
                self._send(404, b"not found", "text/plain")
                return
            n = int(self.headers.get("Content-Length", 0))
            if n > 1_000_000:
                self._send(413, b"too large", "text/plain")
                return
            try:
                sel = validate_selection(json.loads(self.rfile.read(n)), set(by_id))
            except (ValueError, json.JSONDecodeError) as e:
                self._send(400, str(e).encode(), "text/plain")
                return
            SELECTION.parent.mkdir(parents=True, exist_ok=True)
            SELECTION.write_text(json.dumps(sel, ensure_ascii=False, indent=2) + "\n")
            self._send(200, b"ok", "text/plain")

        def log_message(self, *a) -> None:
            pass

    print(f"{len(clips)} candidate clips. Open http://{HOST}:{PORT}  (Ctrl-C to stop)")
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()


# ── publish ───────────────────────────────────────────────────────────────────
def card_rights(site: Path, adapter_id: str) -> str | None:
    p = site / f"docs/eval/MODEL_CARD_{adapter_id}.md"
    m = RIGHTS_RE.search(p.read_text()) if p.exists() else None
    return m.group(1) if m else None


def ensure_scores(c: Clip, device: str) -> None:
    if c.pcs is not None and c.voiced is not None:
        return
    import numpy as np

    sys.path.insert(0, str(REPO / "apps/ai-service"))
    from scripts.pcs import extract_f0, score_frames

    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(REPO / c.path), "-ac", "1", "-ar", "32000",
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    s = score_frames(*extract_f0(np.frombuffer(raw, np.float32), device))
    if s is None:
        raise SystemExit(f"{c.id}: too little pitched audio to score; pick another clip")
    c.pcs, c.voiced = round(s.pcs, 4), round(s.voiced_fraction, 4)
    print(f"  scored {c.id}: PCS {c.pcs:.3f}, voiced {c.voiced:.3f}")


def publish(args: argparse.Namespace) -> None:
    site = Path(args.site).expanduser().resolve()
    web = site / "apps/web"
    out_dir = web / "public/demos/generated"
    if not (web / "lib/published-clips.json").exists():
        raise SystemExit(f"{site} has no apps/web/lib/published-clips.json — use a checkout of website-v1 or master after the merge")
    sel = load_selection()
    if not sel["clips"]:
        raise SystemExit(f"nothing chosen in {SELECTION}; run `serve` first")
    by_id = {c.id: c for c in catalog()}
    chosen = [(by_id[s["id"]], s) for s in sel["clips"] if s["id"] in by_id]
    missing = [s["id"] for s in sel["clips"] if s["id"] not in by_id]
    if missing:
        raise SystemExit(f"selection names clips that no longer exist: {missing}")

    for c, _ in chosen:
        r = card_rights(site, c.adapterId)
        if r != "releasable":
            raise SystemExit(f"{c.id}: docs/eval/MODEL_CARD_{c.adapterId}.md says {r or 'nothing'} — not releasable, refusing")
    print(f"{len(chosen)} clips chosen; scoring any without PCS / voiced on {args.device} …")
    for c, _ in chosen:
        ensure_scores(c, args.device)

    manifest_p = web / "public-audio-rights.json"
    manifest = json.loads(manifest_p.read_text())
    files = manifest["files"]
    keep = {f"apps/web/public/demos/generated/{c.id}.mp3" for c, _ in chosen}
    for rel in [k for k, v in files.items() if k.startswith("apps/web/public/demos/generated/") and v.get("kind") == "model_output"]:
        if rel not in keep:
            del files[rel]
            (site / rel).unlink(missing_ok=True)
            print(f"  removed {rel}")

    generate, listen = [], []
    out_dir.mkdir(parents=True, exist_ok=True)
    for c, s in chosen:
        dst = out_dir / f"{c.id}.mp3"
        af = f"loudnorm=I=-14:TP=-1.5:LRA=11{f',atrim=0:{args.max_seconds}' if args.max_seconds else ''}"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(REPO / c.path), "-af", af, "-ac", "1",
                        "-ar", "44100", "-b:a", "96k", str(dst)], check=True)
        files[f"apps/web/public/demos/generated/{c.id}.mp3"] = {"kind": "model_output", "adapter": c.adapterId,
                                                                 "rights": "releasable", "source": c.path}
        entry = {"id": c.id, "file": f"/demos/generated/{c.id}.mp3", "model": c.model, "adapter": c.adapter,
                 "adapterId": c.adapterId, "checkpoint": c.checkpoint, "corpus": c.corpus, "prompt": c.prompt,
                 "seed": c.seed if c.seed is not None else 0, "durationSec": round(duration(dst)),
                 "pcs": round(c.pcs, 3), "voiced": round(c.voiced, 3)}
        if "generate" in s["pages"]:
            generate.append(entry)
        if "listen" in s["pages"]:
            le = entry | {"title": s.get("title") or title_for(c)}
            if c.bandSnrDb is not None:
                le["bandSnrDb"] = round(c.bandSnrDb, 1)
            listen.append(le)
        print(f"  wrote {dst.relative_to(site)}  ({entry['durationSec']} s, PCS {entry['pcs']}, voiced {entry['voiced']})")

    pub_p = web / "lib/published-clips.json"
    pub = json.loads(pub_p.read_text())
    pub["generate"] = generate
    pub["listen"] = {"selectionNote": sel.get("listenNote") or "chosen by the author after listening, from the releasable models’ outputs",
                     "clips": listen}
    pub_p.write_text(json.dumps(pub, ensure_ascii=False, indent=2) + "\n")
    manifest_p.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {pub_p.relative_to(site)} ({len(generate)} generate, {len(listen)} listen) and {manifest_p.relative_to(site)}")

    node = shutil.which("node") or str(Path.home() / "ai/node-v22/bin/node")
    gate = subprocess.run([node, str(web / "scripts/check-public-audio-rights.mjs")], cwd=site)
    if gate.returncode:
        raise SystemExit("rights gate FAILED — nothing to commit until it passes")
    print("\nNext: look at the site locally (`cd apps/web && npm run dev`), then commit and push:\n"
          "  git add -A apps/web/public/demos/generated apps/web/lib/published-clips.json apps/web/public-audio-rights.json\n"
          "  git commit -m 'site: choose generated clips' && git push origin master")


# ── gallery: every releasable clip on /gallery ───────────────────────────────
GROUPS = [  # (source prefix or exact source, title, note)
    ("data/v4/sD_pool", "Songs with vocals — best-of-32 pool",
     "Model v4: ACE-Step 1.5 with a LoRA trained on one performer’s own songs (Somali lyrics, machine-transcribed). "
     "32 generations for each of 10 lyric prompts; the automatic pick per prompt is marked."),
    ("data/v4/sC_ckpt_r256", "Songs with vocals — training checkpoints",
     "The same v4 model at different points of training (16 held-out lyric prompts, one generation each)."),
    ("data/ab_stage3_acelora_vs_acebase", "Solo oud — ACE-Step clean-oud LoRA",
     "Model v3: ACE-Step 1.5 with a LoRA trained on 5.7 hours of isolated oud stems; 16 held-out prompts."),
    ("data/ab_stage4_melody_vs_text", "Solo oud — melody-conditioned covers",
     "Model v3 given a melody transcribed from a held-out recording and asked to play it as qaraami oud."),
    ("data/ab_stageA_best_epoch_vs_final", "Solo oud — v3 at epoch 6", "An earlier checkpoint of model v3."),
    ("data/oud_ab_listening", "Solo oud — MusicGen-small oud adapter",
     "The first model: MusicGen-small with a LoRA trained on a private oud collection (10 s clips)."),
]


def gallery(args: argparse.Namespace) -> None:
    site = Path(args.site).expanduser().resolve()
    web = site / "apps/web"
    out_dir = web / "public/demos/gallery"
    out_dir.mkdir(parents=True, exist_ok=True)
    clips = catalog()
    ok = {a for a in {c.adapterId for c in clips} if card_rights(site, a) == "releasable"}
    clips = [c for c in clips if c.adapterId in ok]
    manifest_p = web / "public-audio-rights.json"
    manifest = json.loads(manifest_p.read_text())
    files = manifest["files"]
    for rel in [k for k in files if k.startswith("apps/web/public/demos/gallery/")]:
        del files[rel]
    groups = []
    for prefix, title, note in GROUPS:
        members = [c for c in clips if c.source == prefix or c.source.startswith(prefix + "/")]
        if not members:
            continue
        sub: dict[str, list] = {}
        for c in members:
            dst = out_dir / f"{c.id}.mp3"
            if not dst.exists() or args.force:
                subprocess.run(["nice", "ffmpeg", "-loglevel", "error", "-y", "-i", str(REPO / c.path), "-af",
                                f"loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:{args.max_seconds}", "-ac", "1", "-ar", "44100",
                                "-b:a", f"{args.kbps}k", str(dst)], check=True)
            rel = f"apps/web/public/demos/gallery/{c.id}.mp3"
            files[rel] = {"kind": "model_output", "adapter": c.adapterId, "rights": "releasable", "source": c.path}
            key = c.source.split("/")[-1] if c.source.startswith("data/v4/sC_ckpt") else (
                f"Prompt {int(c.id.split('_')[1]) + 1}" if c.id.startswith("v4pool_") else "")
            item = {"id": c.id, "file": f"/demos/gallery/{c.id}.mp3", "title": title_for(c), "adapterId": c.adapterId,
                    "model": c.model, "adapter": c.adapter, "checkpoint": c.checkpoint, "prompt": c.prompt,
                    "seed": c.seed, "durationSec": round(duration(dst)), "vocals": c.vocals}
            for k in ("pcs", "voiced", "bandSnrDb"):
                v = getattr(c, k)
                if v is not None:
                    item[k] = round(v, 3 if k != "bandSnrDb" else 1)
            if c.extra.get("autoRank") == 1:
                item["autoPick"] = True
            sub.setdefault(key, []).append(item)
        for v in sub.values():
            v.sort(key=lambda x: (not x.get("autoPick"), -(x.get("pcs") or 0)))
        groups.append({"title": title, "note": note,
                       "sections": [{"title": k, "clips": v} for k, v in sorted(sub.items(), key=lambda kv: kv[0])]})
        print(f"  {title}: {len(members)} clips")
    (web / "lib/gallery-clips.json").write_text(json.dumps({"groups": groups}, ensure_ascii=False, indent=1) + "\n")
    manifest_p.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    total = sum(f.stat().st_size for f in out_dir.glob("*.mp3"))
    print(f"wrote lib/gallery-clips.json ({sum(len(s['clips']) for g in groups for s in g['sections'])} clips, "
          f"{total / 1e6:.0f} MB of audio)")
    node = shutil.which("node") or str(Path.home() / "ai/node-v22/bin/node")
    if subprocess.run([node, str(web / "scripts/check-public-audio-rights.mjs")], cwd=site).returncode:
        raise SystemExit("rights gate FAILED")


def list_cmd(_: argparse.Namespace) -> None:
    for c in catalog():
        sc = "unscored" if c.pcs is None else f"PCS {c.pcs:.3f} voiced {c.voiced:.3f}"
        print(f"{c.id:28s} {c.adapterId:14s} {sc:28s} {'vocals ' if c.vocals else ''}{c.checkpoint}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("serve", help="choose clips in a local page").set_defaults(fn=serve)
    sub.add_parser("list", help="print every candidate").set_defaults(fn=list_cmd)
    p = sub.add_parser("publish", help="write the chosen clips into a website checkout")
    p.add_argument("--site", default=str(REPO), help="repo checkout to write into (default: this one)")
    p.add_argument("--device", default="cpu", help="device for scoring unscored clips (cpu or mps)")
    p.add_argument("--max-seconds", type=float, default=60.0, help="trim longer clips (0 = keep full length)")
    p.set_defaults(fn=publish)
    g = sub.add_parser("gallery", help="publish every releasable clip on /gallery")
    g.add_argument("--site", default=str(REPO))
    g.add_argument("--kbps", type=int, default=64)
    g.add_argument("--max-seconds", type=float, default=60.0)
    g.add_argument("--force", action="store_true", help="re-encode existing files")
    g.set_defaults(fn=gallery)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
