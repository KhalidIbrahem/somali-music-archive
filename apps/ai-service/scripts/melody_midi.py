"""Monophonic melody MIDI, plus a MIDI-derived chroma, for every isolated-oud clip.

For each captions row whose content is an oud line ("oud" for build_sets' ahmed_oud
rows, "sep_oud" for the Demucs 'other' stems of the sep_oud / harvard_sep_oud sets;
--content changes the list, --all-content takes every row) the 32 kHz mono clip goes
through the project's own melody pipeline:

  CREPE f0 at a 20 ms hop (scripts.pcs.extract_f0)
    -> cents + median smoothing (scripts.f0_notes.hz_to_cents / median_smooth)
    -> note events with the sustain/legato rules (scripts.f0_notes.segment_notes
       + merge_notes; the parameters of transcribe.stem_notes / vocal_f0, with
       the frame counts rescaled from their 10 ms hop to this 20 ms one)
    -> the confidence and length floor of transcribe.stem_notes
    -> ONE line (scripts.melody.melody_skyline)
    -> pitch quantised to the nearest semitone of the SONG's tuning-corrected grid:
       the global offset from A440 (scripts.pentatonic.tuning_offset, the circular mean
       pcs.score_frames uses; archival transfers and oud tunings sit tens of cents off,
       the first ahmed_oud clips are +46 c, where rounding on the A440 grid is a coin
       flip for every note) is removed first, as pcs and quantize.pentatonic_quantize
       do. The offset is pooled over the voiced frames of every clip of the same
       recording (song_sha256) in the run, not measured per clip: per-clip offsets of a
       recording that sits ~50 c off flip between +46 and -46 from one segment to the
       next (the circular mean lives in [-50, 50)), which transposed adjacent segments
       of one song by a semitone. Once a clip of a song has a JSON on disk, its offset
       is reused for the song's remaining clips (resume, --limit), so one song always
       has one grid. --no-tuning-correct keeps the A440 grid. The signed cents deviation
       and the measured absolute pitch are kept per note, so nothing is corrected away
       silently, and quantisation.grid_offset_source in the JSON says where the offset
       came from ("song", "song_reused", "clip" for the Python API, "a440").

and out come three files per clip, every one written atomically:

  <midi-dir>/<stem>.mid    pretty_midi; tempo from build_scale_dataset.tempo_bpm on
                           the clip; GM program 25 "Acoustic Guitar (nylon)" (which
                           pretty_midi numbers 24, 0-based) as the closest stand-in
                           for an oud; velocity from the note's RMS
  <midi-dir>/<stem>.json   notes (start, end, midi, cents_dev, cents, amp, confidence,
                           velocity), scale (tonic, mode, tuning offset, PCS from
                           scripts.pcs.score_frames), quantisation grid, n_notes,
                           voiced_fraction, bpm
  <chroma-dir>/<stem>.npy  (T, 12) float16 one-hot chroma at the musicgen-melody
                           frame rate: T = 1 + round(seconds*32000) // 4096 for the
                           ROW's seconds (235 for a 30 s clip, 79 for 10 s; checked
                           against the real processor, see chroma_frames), --seconds
                           only for rows without the field; 1 on the sounding note's
                           pitch class and an all-zero row while the melody is silent.

MIDI, JSON and chroma describe the same span: notes past the row's seconds are cut
(counted in n_notes_beyond_seconds, with audio_seconds recorded and a WARN line).
A clip with under 1 s of voiced frames or fewer than 4 melody notes gets no MIDI
and is appended to <midi-dir>/skipped.jsonl with the reason. Resumable: a clip
whose three outputs exist and were made with the current --min-conf / --min-note-ms /
--legato / --tuning-correct (the JSON's params), or whose stem is in skipped.jsonl
with those params, is not recomputed; anything else is. --shard I/N takes every N-th
eligible SONG starting at I (0-based), so the clips of one recording always share a
process and a grid; --limit N keeps the first N eligible rows.

Usage (from apps/ai-service):
  HF_HUB_OFFLINE=1 TOKENIZERS_PARALLELISM=false python -m scripts.melody_midi \
      --captions ../../data/sets/ahmed_oud/captions.jsonl [--midi-dir D] [--chroma-dir D] \
      [--device mps] [--limit N] [--shard I/N] [--min-conf 0.6] [--min-note-ms 100] \
      [--no-legato] [--no-tuning-correct] [--content oud,sep_oud | --all-content] \
      [--seconds 30] [--write-midi-captions] [--render-check N --render-dir D] \
      [--verify-processor]

Defaults: the output dirs come from each CLIP's own set dir, not from where the
captions file lives: a clip at data/sets/<set>/clips/<split>/x.wav writes to
data/sets/<set>/midi and data/sets/<set>/chroma_midi (sibling dirs of clips/, so the
clips dir keeps holding only WAVs), and with --no-tuning-correct to
data/sets/<set>/midi_a440 and data/sets/<set>/chroma_midi_a440, so both grids can
coexist and a merged run-captions file (data/sets/all_captions.jsonl,
data/scale_captions.jsonl) still lands in the git-ignored per-set dirs. A clip not laid
out that way needs --midi-dir and --chroma-dir. --write-midi-captions (alias
--write-chroma-dir) writes a SIBLING captions file, <captions stem>_midi.jsonl
(_midi_a440.jsonl on the A440 grid), holding only the rows that have a .mid and a MIDI
chroma, with "chroma_dir" pointing at the MIDI chroma, "midi_path" set, the previous
chroma_dir kept as "audio_chroma_dir" and "midi_grid" recorded; the input captions
file is never rewritten, so its audio chroma_dir survives and a trainer fed the sibling
sees MIDI conditioning only (scale_train --captions data/sets/<set>/captions_midi.jsonl).
--render-check N renders the MIDI of the first N processed clips (read back from the
.mid) to a plucked-sine WAV under --render-dir (default: the system temp dir, never
data/) for listening. --verify-processor loads the real melody processor once and
checks that its frame count on the first loadable clip equals chroma_frames(seconds).

.gitignore patterns this script's outputs need (added by the "report" component,
which owns .gitignore; MIDI and pitch JSON are derived from rights-held recordings):
  data/sets/*/midi/*            !data/sets/*/midi/skipped.jsonl
  data/sets/*/chroma_midi/
  data/sets/*/midi_a440/*       !data/sets/*/midi_a440/skipped.jsonl
  data/sets/*/chroma_midi_a440/
  and the same four under data/sets_10s/*/. The sibling captions_midi*.jsonl files are
  text provenance like captions.jsonl and stay trackable.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.build_scale_dataset import tempo_bpm  # noqa: E402
from scripts.f0_notes import (  # noqa: E402
    F0Note,
    hz_to_cents,
    median_smooth,
    merge_notes,
    segment_notes,
)
from scripts.melody import melody_skyline  # noqa: E402
from scripts.pcs import (  # noqa: E402
    CONF_THRESH,
    CREPE_SR,
    FMAX,
    FMIN,
    HOP,
    MIN_VOICED_FRAMES,
    ClipPCS,
    extract_f0,
    score_frames,
)
from scripts.pentatonic import tuning_offset  # noqa: E402
from scripts.quantize import Note  # noqa: E402
from scripts.scale_chroma import REPO, SR, resolve_clip  # noqa: E402

HOP_SEC = HOP / CREPE_SR  # 0.02 s: the CREPE hop of scripts.pcs
RMS_HOP = int(round(HOP_SEC * SR))  # 640 samples at 32 kHz: one RMS value per f0 frame
RMS_FRAME = 4 * RMS_HOP  # vocal_f0 uses frame_length = 4 * hop
CHROMA_HOP = 4096  # MusicgenMelodyFeatureExtractor hop_length (n_fft 16384, centred STFT)
CHROMA_FRAMES_30S = 235  # what the processor returns for a 30 s clip
MIN_NOTES = 4
GM_NYLON_GUITAR = 24  # GM #25 "Acoustic Guitar (nylon)", 0-based as pretty_midi counts
VELOCITY_FLOOR = 24  # as transcribe.build_score
VOICING_THRESHOLD = CONF_THRESH  # 0.5: vocal_f0's default and the PCS voicing gate
MERGE_GAP_SEC = 0.12  # vocal_f0's legato merge gap
# f0_notes / vocal_f0 defaults are frame counts at a 10 ms hop: 12 settle frames
# (120 ms, longer than a vibrato half-period), 8 attack-lookback frames (80 ms), a
# 5-wide (50 ms) cents median. Re-expressed at this hop so the time constants hold.
SETTLE_FRAMES = max(1, int(round(0.12 / HOP_SEC)))  # 6
ATTACK_LOOKBACK = max(1, int(round(0.08 / HOP_SEC)))  # 4
CENTS_SMOOTH = 3  # 60 ms; extract_f0 has already median-3 filtered f0 and periodicity
CONF_SMOOTH = 3
JSON_VERSION = 2  # 2: per-song grid (quantisation.grid_offset_source), audio_seconds, repo-relative paths
SKIPPED_NAME = "skipped.jsonl"
CLIP_ERRORS: tuple[type[Exception], ...] = (sf.LibsndfileError, ValueError, OSError)
"""Per-clip failures that are logged, counted and skipped; anything else aborts."""
OUD_CONTENTS = frozenset({"oud", "sep_oud"})
"""Captions content labels that are an oud line: build_sets.SET_CONTENT gives "oud" to
ahmed_oud and "sep_oud" to the Demucs 'other' stems of sep_oud / harvard_sep_oud."""
DEFAULT_CONTENT = "oud,sep_oud"
A440_DIR_SUFFIX = "_a440"  # default dirs of the --no-tuning-correct grid: midi_a440, chroma_midi_a440
GRID_NAME = {True: "tuning_corrected", False: "a440"}
MIDI_CAPTIONS_SUFFIX = {"tuning_corrected": "_midi", "a440": "_midi_a440"}
PARAM_KEYS = ("min_conf", "min_note_ms", "legato", "tuning_correct")
"""The analysis parameters an existing output must have been made with to count on resume."""
SEG_RE = re.compile(r"_seg\d+$")


# ----------------------------------------------------------------------------- data
@dataclass
class MelodyNote:
    start: float
    end: float
    midi: int
    cents_dev: float  # signed offset of the measured median pitch from the semitone it was quantised to
    cents: float  # measured median pitch, absolute cents on the MIDI scale (100 * midi + deviation, A440 grid)
    amp: float  # note RMS, normalised to the clip's loudest frame (0..1)
    confidence: float  # mean CREPE periodicity over the note's pitched frames
    velocity: int

    @property
    def pitch_class(self) -> int:
        return self.midi % 12


@dataclass
class ClipMelody:
    notes: list[MelodyNote]
    scale: ClipPCS
    bpm: float
    seconds: float
    n_frames: int
    n_notes_raw: int
    n_notes_kept: int
    grid_offset_cents: float  # the tuning offset removed before rounding (0 on the A440 grid)
    tuning_correct: bool
    grid_source: str = "clip"  # song | song_reused | clip | a440
    song_key: str = ""
    n_clips_pooled: int = 1
    audio_seconds: float = 0.0  # the clip's real length; notes past `seconds` are cut
    n_notes_beyond_seconds: int = 0


@dataclass
class Job:
    row: dict
    captions: Path
    midi_dir: Path
    chroma_dir: Path
    seconds: float = 30.0  # the row's clip length (its "seconds"), --seconds when absent

    @property
    def stem(self) -> str:
        return Path(self.row["clip_path"]).stem

    @property
    def song(self) -> str:
        return song_key(self.row)

    @property
    def midi_path(self) -> Path:
        return self.midi_dir / f"{self.stem}.mid"

    @property
    def json_path(self) -> Path:
        return self.midi_dir / f"{self.stem}.json"

    @property
    def chroma_path(self) -> Path:
        return self.chroma_dir / f"{self.stem}.npy"

    def done(self) -> bool:
        return self.midi_path.exists() and self.json_path.exists() and self.chroma_path.exists()


# ----------------------------------------------------------------------------- frames
def chroma_frames(seconds: float) -> int:
    """Frames the melody processor returns for `seconds` of 32 kHz audio.

    torchaudio's centred STFT with hop 4096 gives 1 + n_samples // 4096: 235 for a
    30 s clip, which is also round(30 * 235/30). The linear rule round(seconds *
    235/30) is off by one at other lengths (78 against the processor's 79 at 10 s),
    so the exact form is used."""
    return 1 + int(round(seconds * SR)) // CHROMA_HOP


def song_key(row: dict) -> str:
    """The clips that must share one tuning grid: the source recording (song_sha256),
    else the clip stem without its _segNNN suffix."""
    return str(row.get("song_sha256") or SEG_RE.sub("", Path(row["clip_path"]).stem))


def default_dirs(clip: Path, tuning_correct: bool = True) -> tuple[Path, Path] | None:
    """<set>/midi and <set>/chroma_midi (with _a440 appended on the A440 grid) for a clip
    laid out as <set>/clips/<split>/<file>; None for any other layout. Deriving the dirs
    from the clip rather than from the captions file keeps a merged run-captions file
    writing into each set's git-ignored dirs."""
    if len(clip.parents) < 3 or clip.parents[1].name != "clips":
        return None
    suffix = "" if tuning_correct else A440_DIR_SUFFIX
    return clip.parents[2] / f"midi{suffix}", clip.parents[2] / f"chroma_midi{suffix}"


def frame_rms(audio: np.ndarray, n_frames: int, hop: int = RMS_HOP,
              frame_length: int = RMS_FRAME) -> np.ndarray:
    """Centred RMS envelope, one value per f0 frame, normalised to the clip's peak (0..1)."""
    x = np.asarray(audio, dtype=np.float64)
    pad = frame_length // 2
    padded = np.concatenate([np.zeros(pad), x, np.zeros(pad + frame_length)])
    csum = np.concatenate([[0.0], np.cumsum(padded ** 2)])
    idx = np.arange(n_frames) * hop
    idx = np.minimum(idx, len(padded) - frame_length)
    rms = np.sqrt(np.maximum(csum[idx + frame_length] - csum[idx], 0.0) / frame_length)
    return rms / max(float(rms.max()), 1e-9)


def load_clip(path: Path) -> np.ndarray:
    """32 kHz mono float32, as long as the file is (the chroma length comes from --seconds)."""
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != SR:
        raise ValueError(f"{path}: expected {SR} Hz clips, got {sr} Hz")
    if len(audio) == 0:
        raise ValueError(f"{path}: empty clip")
    return audio.astype(np.float32)


# ----------------------------------------------------------------------------- notes
def track_notes(f0: np.ndarray, periodicity: np.ndarray, amp: np.ndarray, *, min_conf: float,
                min_note_ms: float, legato: bool) -> tuple[list[F0Note], list[F0Note]]:
    """Segment the f0 ribbon into note events with the vocal_f0 / stem_notes recipe.

    Returns (all notes, the notes passing stem_notes' confidence and length floor)."""
    n = min(len(f0), len(periodicity), len(amp))
    times = np.arange(n) * HOP_SEC
    cents = median_smooth(hz_to_cents(np.asarray(f0[:n], dtype=float)), width=CENTS_SMOOTH)
    conf = median_smooth(np.asarray(periodicity[:n], dtype=float), width=CONF_SMOOTH)
    notes = segment_notes(times, cents, conf, np.asarray(amp[:n], dtype=float),
                          voicing_threshold=VOICING_THRESHOLD, settle_frames=SETTLE_FRAMES,
                          attack_lookback=ATTACK_LOOKBACK, legato=legato)
    if legato:
        notes = merge_notes(notes, max_gap_sec=MERGE_GAP_SEC)
    kept = [x for x in notes
            if x.confidence >= min_conf and (x.end - x.start) >= min_note_ms / 1000.0]
    return notes, kept


def velocity_of(amp: float) -> int:
    return int(np.clip(round(float(amp) * 127), VELOCITY_FLOOR, 127))


def to_melody_line(kept: list[F0Note], grid_offset_cents: float = 0.0) -> list[MelodyNote]:
    """One monophonic line (melody_skyline), each note quantised to the nearest semitone
    of the grid shifted by `grid_offset_cents` (0 = the A440 grid; pass the clip's
    tuning offset for the corrected grid) with its signed cents deviation from that
    semitone kept. Onsets survive the skyline unchanged, so the CREPE confidence is
    carried across by onset."""
    conf_by_start = {x.start: x.confidence for x in kept}
    line = melody_skyline([Note(start=x.start, end=x.end, midi=x.midi, amp=x.amp, cents=x.cents)
                           for x in kept])
    out: list[MelodyNote] = []
    for n in line:
        corrected = float(n.cents) - grid_offset_cents
        midi = int(round(corrected / 100.0))
        out.append(MelodyNote(
            start=round(float(n.start), 4), end=round(float(n.end), 4), midi=midi,
            cents_dev=round(corrected - 100.0 * midi, 1), cents=round(float(n.cents), 1),
            amp=round(float(n.amp), 3),
            confidence=round(float(conf_by_start.get(n.start, 1.0)), 3),
            velocity=velocity_of(n.amp),
        ))
    return out


def midi_chroma(notes: list[MelodyNote], n_frames: int) -> np.ndarray:
    """(n_frames, 12) float16 one-hot chroma. Frame k is centred at k*4096/32000 s and
    carries a 1 on the pitch class of the note sounding there; a zero row when none does."""
    chroma = np.zeros((n_frames, 12), dtype=np.float16)
    t = np.arange(n_frames) * (CHROMA_HOP / SR)
    for n in notes:  # the line is monophonic; a later note wins any residual overlap
        on = (t >= n.start) & (t < n.end)
        chroma[on] = 0.0
        chroma[on, n.pitch_class] = 1.0
    return chroma


def voiced_cents(f0: np.ndarray, periodicity: np.ndarray) -> np.ndarray:
    """Cents (MIDI scale) of the frames pcs.score_frames counts as voiced: the material
    the song's tuning offset is pooled from."""
    n = min(len(f0), len(periodicity))
    f0 = np.asarray(f0[:n], dtype=float)
    pd = np.asarray(periodicity[:n], dtype=float)
    voiced = (pd >= VOICING_THRESHOLD) & (f0 > FMIN) & (f0 < FMAX)
    return hz_to_cents(f0[voiced])


def pooled_offset(cents: list[np.ndarray]) -> float:
    """The tuning offset (pentatonic.tuning_offset's circular mean, in [-50, 50)) over the
    voiced frames of several clips; 0 when there are none."""
    allc = np.concatenate([np.asarray(c, dtype=float) for c in cents]) if cents else np.zeros(0)
    allc = allc[np.isfinite(allc)]
    return float(tuning_offset(allc)) if len(allc) else 0.0


def clip_notes(notes: list[MelodyNote], seconds: float) -> tuple[list[MelodyNote], int]:
    """Cut the line at `seconds` so MIDI, JSON and chroma cover the same span: notes
    starting at or after it are dropped, one straddling it is shortened. Returns
    (notes, how many reached more than one f0 hop past `seconds`); a note that merely
    rings to the end of a full-length clip (its last frame ends at seconds + hop) is
    shortened but not counted."""
    out: list[MelodyNote] = []
    beyond = 0
    for n in notes:
        if n.end > seconds + HOP_SEC + 1e-6:
            beyond += 1
        if n.start >= seconds:
            continue
        if n.end > seconds:
            n = MelodyNote(**{**asdict(n), "end": round(float(seconds), 4)})
        out.append(n)
    return out, beyond


def analyse(audio: np.ndarray, f0: np.ndarray, periodicity: np.ndarray, *, min_conf: float,
            min_note_ms: float, legato: bool, seconds: float, tuning_correct: bool = True,
            grid_offset_cents: float | None = None, grid_source: str = "song", song: str = "",
            n_clips_pooled: int = 1) -> tuple[ClipMelody | None, dict | None]:
    """Everything after CREPE for one clip: (melody, None), or (None, skip record).

    On the corrected grid `grid_offset_cents` is the song's pooled offset (run() passes
    it; `grid_source` says whether it was pooled now or reused from a sibling clip's
    JSON); None falls back to this clip's own offset ("clip"). Ignored on the A440 grid."""
    n = min(len(f0), len(periodicity))
    f0 = np.asarray(f0[:n], dtype=float)
    pd = np.asarray(periodicity[:n], dtype=float)
    voiced = (pd >= VOICING_THRESHOLD) & (f0 > FMIN) & (f0 < FMAX)
    n_voiced = int(voiced.sum())
    base = {"n_voiced_frames": n_voiced, "voiced_seconds": round(n_voiced * HOP_SEC, 2),
            "voiced_fraction": round(float(voiced.mean()), 3) if n else 0.0}
    scale = score_frames(f0, pd)
    if scale is None:  # fewer than MIN_VOICED_FRAMES (50 frames = 1 s at this hop)
        return None, {"reason": f"voiced_under_{MIN_VOICED_FRAMES * HOP_SEC:g}s", "n_notes": 0, **base}
    amp = frame_rms(audio, n)
    raw, kept = track_notes(f0, pd, amp, min_conf=min_conf, min_note_ms=min_note_ms, legato=legato)
    if not tuning_correct:
        grid_offset, source = 0.0, "a440"
    elif grid_offset_cents is None:
        grid_offset, source = float(scale.tuning_offset_cents), "clip"
    else:
        grid_offset, source = float(grid_offset_cents), grid_source
    line, beyond = clip_notes(to_melody_line(kept, grid_offset), seconds)
    if len(line) < MIN_NOTES:
        return None, {"reason": f"fewer_than_{MIN_NOTES}_notes", "n_notes": len(line),
                      "n_notes_raw": len(raw), "n_notes_kept": len(kept), **base}
    bpm = float(tempo_bpm(np.asarray(audio, dtype=np.float32)))
    if not np.isfinite(bpm) or bpm <= 0:
        bpm = 100.0
    return ClipMelody(notes=line, scale=scale, bpm=bpm, seconds=seconds,
                      n_frames=chroma_frames(seconds), n_notes_raw=len(raw),
                      n_notes_kept=len(kept), grid_offset_cents=grid_offset,
                      tuning_correct=tuning_correct, grid_source=source, song_key=song,
                      n_clips_pooled=n_clips_pooled, audio_seconds=round(len(audio) / SR, 3),
                      n_notes_beyond_seconds=beyond), None


# ----------------------------------------------------------------------------- writers
def write_midi(path: Path, melody: ClipMelody, name: str) -> None:
    """pretty_midi file: one nylon-guitar track (the GM oud stand-in), velocity from RMS."""
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(initial_tempo=float(melody.bpm))
    inst = pretty_midi.Instrument(program=GM_NYLON_GUITAR, name=name)
    for n in melody.notes:
        inst.notes.append(pretty_midi.Note(velocity=n.velocity, pitch=n.midi, start=n.start, end=n.end))
    pm.instruments.append(inst)
    tmp = path.with_name(path.name + ".tmp")
    pm.write(str(tmp))
    os.replace(tmp, path)


def write_json_atomic(path: Path, obj: dict) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
    os.replace(tmp, path)


def write_npy_atomic(path: Path, arr: np.ndarray) -> None:
    tmp = path.with_name(path.stem + ".tmp.npy")  # np.save insists on the .npy suffix
    np.save(tmp, arr)
    os.replace(tmp, path)


def analysis_params(*, min_conf: float, min_note_ms: float, legato: bool, tuning_correct: bool) -> dict:
    """The parameters that define an output; recorded in every JSON and skip record and
    compared on resume (PARAM_KEYS)."""
    return {"min_conf": float(min_conf), "min_note_ms": float(min_note_ms), "legato": bool(legato),
            "tuning_correct": bool(tuning_correct)}


def same_params(recorded: object, params: dict) -> bool:
    return isinstance(recorded, dict) and all(recorded.get(k) == params[k] for k in PARAM_KEYS)


def outputs_current(job: Job, params: dict) -> bool:
    """All three outputs exist and the JSON records these analysis parameters."""
    if not job.done():
        return False
    try:
        rec = json.loads(job.json_path.read_text())
    except (ValueError, OSError):
        return False
    return isinstance(rec, dict) and same_params(rec.get("params"), params)


def recorded_grid_offset(job: Job) -> float | None:
    """The corrected-grid offset an existing JSON of this clip was quantised with, else None."""
    if not job.json_path.exists():
        return None
    try:
        q = json.loads(job.json_path.read_text()).get("quantisation", {})
    except (ValueError, OSError, AttributeError):
        return None
    off = q.get("grid_offset_cents") if isinstance(q, dict) and q.get("grid") == "tuning_corrected" else None
    return float(off) if isinstance(off, (int, float)) else None


def melody_record(job: Job, melody: ClipMelody, *, min_conf: float, min_note_ms: float,
                  legato: bool, device: str, root: Path = REPO) -> dict:
    """The per-clip JSON; paths are repo-relative (absolute outside the repo), like the
    captions rows."""
    s = melody.scale
    return {
        "version": JSON_VERSION,
        "clip_path": job.row["clip_path"],
        "stem": job.stem,
        "midi_path": rel_to(job.midi_path, root),
        "chroma_path": rel_to(job.chroma_path, root),
        "seconds": melody.seconds,
        "audio_seconds": melody.audio_seconds,
        "n_notes_beyond_seconds": melody.n_notes_beyond_seconds,
        "hop_sec": HOP_SEC,
        "bpm": round(melody.bpm, 2),
        "program": GM_NYLON_GUITAR,
        "n_notes": len(melody.notes),
        "n_notes_raw": melody.n_notes_raw,
        "n_notes_kept": melody.n_notes_kept,
        "voiced_fraction": round(s.voiced_fraction, 3),
        "n_voiced_frames": s.n_voiced_frames,
        "scale": {
            "tonic": s.tonic_name, "tonic_pc": s.tonic_pc, "mode": s.mode,
            "tuning_offset_cents": round(s.tuning_offset_cents, 1),
            "tonic_score": round(s.tonic_score, 3), "pcs": round(s.pcs, 3),
        },
        "quantisation": {
            "grid": GRID_NAME[melody.tuning_correct],
            "grid_offset_cents": round(melody.grid_offset_cents, 1),
            "grid_offset_source": melody.grid_source,
            "song_key": melody.song_key,
            "n_clips_pooled": melody.n_clips_pooled,
            "note": "midi is the nearest semitone after removing grid_offset_cents from the measured pitch; "
                    "cents is the measured absolute pitch (A440 grid), cents_dev = measured - offset - 100*midi; "
                    "the offset is pooled over the song's clips (source song), reused from a sibling clip's JSON "
                    "(song_reused), this clip's own (clip) or 0 (a440)",
        },
        "chroma_frames": melody.n_frames,
        "params": {**analysis_params(min_conf=min_conf, min_note_ms=min_note_ms, legato=legato,
                                     tuning_correct=melody.tuning_correct),
                   "voicing_threshold": VOICING_THRESHOLD, "settle_frames": SETTLE_FRAMES,
                   "attack_lookback": ATTACK_LOOKBACK, "merge_gap_sec": MERGE_GAP_SEC,
                   "device": device},
        "notes": [asdict(n) for n in melody.notes],
    }


def read_skipped(midi_dir: Path) -> dict[str, dict]:
    """stem -> record for every complete line of skipped.jsonl (a torn line is ignored)."""
    p = midi_dir / SKIPPED_NAME
    if not p.exists():
        return {}
    out: dict[str, dict] = {}
    for line in p.read_text().splitlines():
        try:
            rec = json.loads(line)
            out[str(rec["stem"])] = rec
        except (ValueError, KeyError, TypeError):
            continue
    return out


def append_skipped(midi_dir: Path, record: dict) -> None:
    """One JSON line per skipped clip, a single O_APPEND write (safe across shards). A torn
    last line left by an interrupted write gets its newline first, so the new record is
    never glued onto it (which would lose both)."""
    p = midi_dir / SKIPPED_NAME
    prefix = b""
    if p.exists() and p.stat().st_size > 0:
        with p.open("rb") as rd:
            rd.seek(-1, os.SEEK_END)
            if rd.read(1) != b"\n":
                prefix = b"\n"
    with p.open("ab") as fh:
        fh.write(prefix + (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8"))
        fh.flush()


# ----------------------------------------------------------------------------- render
def render_pluck(notes: list[tuple[float, float, int, int]], seconds: float, sr: int = SR) -> np.ndarray:
    """Plucked-sine rendering of (start, end, midi, velocity) notes for listening: a
    decaying sine with two soft harmonics per note, scaled by velocity, peak 0.9."""
    out = np.zeros(int(round(seconds * sr)), dtype=np.float32)
    for start, end, midi, velocity in notes:
        a, b = int(start * sr), min(len(out), int(end * sr))
        if b <= a:
            continue
        t = np.arange(b - a) / sr
        f = 440.0 * 2.0 ** ((midi - 69) / 12.0)
        env = np.exp(-3.0 * t) * (velocity / 127.0)
        wave = np.sin(2 * np.pi * f * t) + 0.4 * np.sin(4 * np.pi * f * t) + 0.2 * np.sin(6 * np.pi * f * t)
        out[a:b] += (env * wave).astype(np.float32)
    peak = float(np.abs(out).max())
    if peak > 0:
        out *= 0.9 / peak
    return out


def render_midi_file(midi_path: Path, wav_path: Path, seconds: float) -> int:
    """Read the written .mid back with pretty_midi and render it; returns the note count."""
    import pretty_midi

    pm = pretty_midi.PrettyMIDI(str(midi_path))
    notes = [(n.start, n.end, n.pitch, n.velocity) for inst in pm.instruments for n in inst.notes]
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = wav_path.with_name(wav_path.name + ".tmp.wav")
    sf.write(tmp, render_pluck(notes, seconds), SR, subtype="PCM_16")
    os.replace(tmp, wav_path)
    return len(notes)


# ----------------------------------------------------------------------------- stamping
def rel_to(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def midi_captions_path(captions: Path, tuning_correct: bool = True) -> Path:
    """The sibling file --write-midi-captions writes: captions_midi.jsonl next to
    captions.jsonl (captions_midi_a440.jsonl on the A440 grid)."""
    return captions.with_name(captions.stem + MIDI_CAPTIONS_SUFFIX[GRID_NAME[tuning_correct]] + captions.suffix)


def write_midi_captions(out: Path, rows: list[dict], dirs_of: dict[str, tuple[Path, Path]], *,
                        tuning_correct: bool = True, root: Path = REPO) -> int:
    """Write `out` atomically with the rows (copied, in order) whose clip has a .mid and a
    MIDI chroma under its dirs (`dirs_of`: clip_path -> (midi_dir, chroma_dir)): "chroma_dir"
    points at the MIDI chroma (repo-relative), "midi_path" is set, the row's previous
    chroma_dir is kept as "audio_chroma_dir" and "midi_grid" names the grid. The input
    captions file is not touched, so its audio chroma_dir survives and a trainer fed `out`
    never mixes audio and MIDI conditioning. Returns the row count."""
    kept: list[dict] = []
    for r in rows:
        dirs = dirs_of.get(r["clip_path"])
        if dirs is None:
            continue
        mdir, cdir = dirs
        stem = Path(r["clip_path"]).stem
        mid, npy = mdir / f"{stem}.mid", cdir / f"{stem}.npy"
        if not (mid.exists() and npy.exists()):
            continue
        row = dict(r)
        rel_chroma = rel_to(cdir, root)
        if r.get("chroma_dir") and r["chroma_dir"] != rel_chroma:
            row["audio_chroma_dir"] = r["chroma_dir"]
        row["chroma_dir"] = rel_chroma
        row["midi_path"] = rel_to(mid, root)
        row["midi_grid"] = GRID_NAME[tuning_correct]
        kept.append(row)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in kept))
    os.replace(tmp, out)
    return len(kept)


# ----------------------------------------------------------------------------- run
def run_f0(audio: np.ndarray, device: str, log: Callable[[str], None]) -> tuple[np.ndarray, np.ndarray, str]:
    """CREPE on `device`, once retried on the CPU when the accelerator fails."""
    try:
        f0, pd = extract_f0(audio, device, SR)
        return f0, pd, device
    except RuntimeError as exc:
        if device == "cpu":
            raise
        log(f"extract_f0 failed on {device} ({str(exc)[:120]}); retrying on cpu")
        f0, pd = extract_f0(audio, "cpu", SR)
        return f0, pd, "cpu"


def plan(jobs: list[Job], params: dict) -> tuple[list[Job], int, int]:
    """Split the jobs into (to compute, resumed, stale): resumed have current outputs or a
    skip record made with `params`; stale had outputs or a skip record made with other
    parameters and are recomputed. Creates the output dirs."""
    skipped_known: dict[Path, dict[str, dict]] = {}
    todo: list[Job] = []
    resumed = stale = 0
    for j in jobs:
        j.midi_dir.mkdir(parents=True, exist_ok=True)
        j.chroma_dir.mkdir(parents=True, exist_ok=True)
        if j.midi_dir not in skipped_known:
            skipped_known[j.midi_dir] = read_skipped(j.midi_dir)
        rec = skipped_known[j.midi_dir].get(j.stem)
        if outputs_current(j, params) or (rec is not None and same_params(rec.get("params"), params)):
            resumed += 1
            continue
        if j.done() or rec is not None:
            stale += 1
        todo.append(j)
    return todo, resumed, stale


def run(jobs: list[Job], *, device: str = "mps", min_conf: float = 0.6, min_note_ms: float = 100.0,
        legato: bool = True, tuning_correct: bool = True, seconds: float = 30.0, render: int = 0,
        render_dir: Path | None = None, root: Path = REPO, log: Callable[[str], None] = print) -> dict:
    """Process every job that is not already done or skipped with these parameters, song by
    song (song_key): CREPE on all of a song's pending clips first, the tuning offset pooled
    over their voiced frames (or reused from a sibling clip's JSON), then the notes, MIDI,
    JSON and chroma of each clip on that one grid. `seconds` is the fallback for rows
    without their own. Returns the summary."""
    t_all = time.time()
    params = analysis_params(min_conf=min_conf, min_note_ms=min_note_ms, legato=legato,
                             tuning_correct=tuning_correct)
    todo, resumed, stale = plan(jobs, params)
    groups: dict[tuple[Path, str], list[Job]] = {}
    for j in todo:
        groups.setdefault((j.midi_dir, j.song), []).append(j)
    sticky: dict[tuple[Path, str], float] = {}
    if tuning_correct:
        for j in jobs:
            key = (j.midi_dir, j.song)
            if key in groups and key not in sticky:
                off = recorded_grid_offset(j)
                if off is not None:
                    sticky[key] = off
    lengths = sorted({j.seconds for j in jobs}) or [seconds]
    log(f"{len(jobs)} clips in {len({j.song for j in jobs})} songs, {len(todo)} to compute "
        f"({stale} with outputs from other parameters), {resumed} already done or skipped, "
        f"chroma {'/'.join(str(chroma_frames(s)) for s in lengths)} x 12 frames for "
        f"{'/'.join(f'{s:g}' for s in lengths)} s, grid {GRID_NAME[tuning_correct]}, device {device}")
    processed = skipped = rendered = 0
    failed: list[str] = []
    per_clip: list[dict] = []
    for key, group in groups.items():
        # pass 1: CREPE on every pending clip of the song; keep f0 only (audio is re-read)
        tracked: list[tuple[Job, np.ndarray, np.ndarray, str, float]] = []
        cents: list[np.ndarray] = []
        for j in group:
            t0 = time.time()
            try:
                audio = load_clip(resolve_clip(j.row["clip_path"], root))
            except CLIP_ERRORS as exc:
                failed.append(j.row["clip_path"])
                log(f"FAILED {j.row['clip_path']}: {exc}")
                continue
            f0, pd, used = run_f0(audio, device, log)
            tracked.append((j, f0, pd, used, time.time() - t0))
            if tuning_correct and key not in sticky:
                cents.append(voiced_cents(f0, pd))
        if not tracked:
            continue
        if not tuning_correct:
            grid_offset, source = None, "a440"
        elif key in sticky:
            grid_offset, source = sticky[key], "song_reused"
        else:
            grid_offset, source = pooled_offset(cents), "song"
            sticky[key] = grid_offset
        # pass 2: notes, files
        for j, f0, pd, used, t_f0 in tracked:
            t0 = time.time()
            try:
                audio = load_clip(resolve_clip(j.row["clip_path"], root))
            except CLIP_ERRORS as exc:
                failed.append(j.row["clip_path"])
                log(f"FAILED {j.row['clip_path']}: {exc}")
                continue
            melody, skip = analyse(audio, f0, pd, min_conf=min_conf, min_note_ms=min_note_ms,
                                   legato=legato, seconds=j.seconds, tuning_correct=tuning_correct,
                                   grid_offset_cents=grid_offset, grid_source=source, song=key[1],
                                   n_clips_pooled=len(tracked))
            if skip is not None:
                record = {"clip_path": j.row["clip_path"], "stem": j.stem, **skip, "params": params,
                          "seconds_taken": round(time.time() - t0 + t_f0, 2)}
                append_skipped(j.midi_dir, record)
                skipped += 1
                log(f"SKIP {j.stem}  {skip['reason']}  voiced={skip['voiced_seconds']}s notes={skip['n_notes']}")
                continue
            if melody.audio_seconds > j.seconds + 0.05:
                log(f"WARN {j.stem}: audio is {melody.audio_seconds:.2f} s but the row says {j.seconds:g} s; "
                    f"{melody.n_notes_beyond_seconds} notes past {j.seconds:g} s cut from MIDI, JSON and chroma")
            write_midi(j.midi_path, melody, name=f"oud melody {j.stem}")
            write_json_atomic(j.json_path, melody_record(j, melody, min_conf=min_conf, min_note_ms=min_note_ms,
                                                         legato=legato, device=used, root=root))
            write_npy_atomic(j.chroma_path, midi_chroma(melody.notes, melody.n_frames))
            if rendered < render:
                out_dir = render_dir or Path(tempfile.gettempdir()) / "melody_midi_render"
                render_midi_file(j.midi_path, out_dir / f"{j.stem}.wav", j.seconds)
                rendered += 1
            dt = time.time() - t0 + t_f0
            processed += 1
            info = {"stem": j.stem, "n_notes": len(melody.notes), "n_notes_raw": melody.n_notes_raw,
                    "voiced_fraction": round(melody.scale.voiced_fraction, 3), "bpm": round(melody.bpm),
                    "tonic": melody.scale.tonic_name, "mode": melody.scale.mode,
                    "tuning_offset_cents": round(melody.scale.tuning_offset_cents, 1),
                    "grid_offset_cents": round(melody.grid_offset_cents, 1), "grid_offset_source": source,
                    "pcs": round(melody.scale.pcs, 3), "chroma_frames": melody.n_frames,
                    "f0_seconds": round(t_f0, 2), "seconds": round(dt, 2), "device": used}
            per_clip.append(info)
            log(f"{j.stem}  notes={info['n_notes']} (raw {info['n_notes_raw']}) voiced={info['voiced_fraction']:.2f} "
                f"bpm={info['bpm']} tonic={info['tonic']} m{info['mode']} tune={info['tuning_offset_cents']:+.0f}c "
                f"grid={info['grid_offset_cents']:+.0f}c({source}) pcs={info['pcs']:.2f}  "
                f"f0 {t_f0:.1f}s total {dt:.1f}s")
    return {
        "clips": len(jobs), "songs": len({j.song for j in jobs}), "processed": processed, "skipped": skipped,
        "resumed": resumed, "stale_recomputed": stale,
        "failed": len(failed), "failed_clips": failed[:50], "rendered": rendered,
        "chroma_frames": [chroma_frames(s) for s in lengths], "seconds": lengths, "device": device,
        "tuning_correct": tuning_correct, "grid": GRID_NAME[tuning_correct], "params": params,
        "midi_dirs": sorted({rel_to(j.midi_dir, root) for j in jobs}),
        "chroma_dirs": sorted({rel_to(j.chroma_dir, root) for j in jobs}),
        "grid_offsets": {song: round(off, 1) for (_d, song), off in sorted(sticky.items(), key=lambda kv: kv[0][1])},
        "elapsed_s": round(time.time() - t_all, 1), "per_clip": per_clip[:200],
    }


def verify_processor(job: Job, seconds: float, root: Path = REPO, log: Callable[[str], None] = print) -> int:
    """Run the real musicgen-melody processor on this clip and check the frame count."""
    from scripts import scale_chroma as sc

    processor = sc.load_processor()
    clip = sc.load_clip(resolve_clip(job.row["clip_path"], root), int(round(seconds * SR)))
    feats = sc.compute_chroma(processor, clip)
    want = chroma_frames(seconds)
    log(f"processor chroma on {job.stem}: {tuple(feats.shape)}; chroma_frames({seconds:g}) = {want}")
    if tuple(feats.shape) != (want, 12):
        raise SystemExit(f"frame count mismatch: processor {tuple(feats.shape)} vs ({want}, 12)")
    return int(feats.shape[0])


# ----------------------------------------------------------------------------- CLI
def parse_shard(text: str) -> tuple[int, int]:
    try:
        i, n = (int(x) for x in text.split("/"))
    except ValueError as exc:
        raise SystemExit(f"bad --shard {text!r}: want I/N") from exc
    if not (n > 0 and 0 <= i < n):
        raise SystemExit(f"bad --shard {text!r}: want I/N with 0 <= I < N")
    return i, n


def load_rows(captions: Path) -> list[dict]:
    """The file's JSON rows. A missing file, a line that is not a JSON object or a row
    without clip_path is a SystemExit naming the file and line."""
    if not captions.is_file():
        raise SystemExit(f"captions file not found: {captions}")
    rows: list[dict] = []
    for k, line in enumerate(captions.read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except ValueError as exc:
            raise SystemExit(f"{captions}:{k}: not JSON ({exc})") from exc
        if not isinstance(row, dict) or not row.get("clip_path"):
            raise SystemExit(f"{captions}:{k}: row has no clip_path")
        rows.append(row)
    return rows


def parse_content(text: str) -> frozenset[str]:
    return frozenset(c.strip() for c in text.split(",") if c.strip())


def build_jobs(captions_files: list[Path], rows_by_file: dict[Path, list[dict]], *,
               midi_dir: Path | None, chroma_dir: Path | None, contents: frozenset[str] | None = OUD_CONTENTS,
               all_content: bool = False, tuning_correct: bool = True, seconds: float = 30.0,
               root: Path = REPO) -> list[Job]:
    """One Job per eligible row (content in `contents`; every row with all_content). Output
    dirs: the explicit --midi-dir / --chroma-dir, else default_dirs() of the clip's own set
    dir; a clip outside a <set>/clips/<split>/ layout with no explicit dirs is a SystemExit.
    The job's seconds are the row's, `seconds` when the row has none."""
    jobs: list[Job] = []
    for cap in captions_files:
        for k, r in enumerate(rows_by_file[cap], 1):
            if not all_content and (contents is None or r.get("content") not in contents):
                continue
            mdir, cdir = midi_dir, chroma_dir
            if mdir is None or cdir is None:
                dflt = default_dirs(resolve_clip(r["clip_path"], root), tuning_correct)
                if dflt is None:
                    raise SystemExit(f"{cap}:{k}: {r['clip_path']} is not under <set>/clips/<split>/, so no default "
                                     "output dir can be derived from it; pass --midi-dir and --chroma-dir")
                mdir, cdir = mdir or dflt[0], cdir or dflt[1]
            jobs.append(Job(r, cap, mdir, cdir, float(r.get("seconds") or seconds)))
    return jobs


def shard_jobs(jobs: list[Job], i: int, n: int) -> list[Job]:
    """Shard I/N by song (first-seen order), so one recording's clips share a process."""
    by_song: dict[str, list[Job]] = {}
    for j in jobs:
        by_song.setdefault(j.song, []).append(j)
    return [j for song in list(by_song)[i::n] for j in by_song[song]]


def main(argv: list[str] | None = None) -> int:
    """0 when every eligible clip has a MIDI or a listed skip; 1 when some clips failed to load."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--captions", nargs="+", required=True, help="one or more set captions.jsonl")
    ap.add_argument("--midi-dir", default=None,
                    help="default: the clip's own <set>/midi (<set>/midi_a440 with --no-tuning-correct)")
    ap.add_argument("--chroma-dir", default=None,
                    help="default: the clip's own <set>/chroma_midi (<set>/chroma_midi_a440 with --no-tuning-correct)")
    ap.add_argument("--device", default="mps", help="CREPE device: mps (default) or cpu")
    ap.add_argument("--limit", type=int, default=0, help="only the first N eligible rows")
    ap.add_argument("--shard", default="", help="I/N: every N-th eligible clip starting at I (0-based)")
    ap.add_argument("--min-conf", type=float, default=0.6, help="CREPE confidence a note needs (stem_notes default)")
    ap.add_argument("--min-note-ms", type=float, default=100.0)
    ap.add_argument("--legato", action=argparse.BooleanOptionalAction, default=True,
                    help="sustain plucked notes through the ring-out and merge re-attacks under 120 ms (default on)")
    ap.add_argument("--tuning-correct", action=argparse.BooleanOptionalAction, default=True,
                    help="quantise on the grid shifted by the clip's tuning offset (default); "
                         "--no-tuning-correct rounds on the A440 grid")
    ap.add_argument("--content", default=DEFAULT_CONTENT,
                    help=f"comma-separated content labels that are eligible (default {DEFAULT_CONTENT})")
    ap.add_argument("--all-content", action="store_true", help="every row whatever its content")
    ap.add_argument("--seconds", type=float, default=30.0,
                    help="clip length the chroma is framed for, for rows without their own \"seconds\"")
    ap.add_argument("--write-midi-captions", "--write-chroma-dir", dest="write_midi_captions", action="store_true",
                    help="write <captions stem>_midi.jsonl (_midi_a440 on the A440 grid) next to each captions file: "
                         "only the rows with a MIDI, chroma_dir pointing at the MIDI chroma, midi_path set; "
                         "the input file is not rewritten")
    ap.add_argument("--render-check", type=int, default=0, help="render the MIDI of the first N processed clips to WAV")
    ap.add_argument("--render-dir", default=None, help="where --render-check writes (default: system temp dir)")
    ap.add_argument("--verify-processor", action="store_true",
                    help="load the real melody processor and check its frame count on the first loadable clip")
    args = ap.parse_args(argv)

    captions_files = [Path(c) for c in args.captions]
    rows_by_file = {c: load_rows(c) for c in captions_files}
    all_jobs = build_jobs(captions_files, rows_by_file,
                          midi_dir=Path(args.midi_dir) if args.midi_dir else None,
                          chroma_dir=Path(args.chroma_dir) if args.chroma_dir else None,
                          contents=parse_content(args.content), all_content=args.all_content,
                          tuning_correct=args.tuning_correct, seconds=args.seconds)
    jobs = all_jobs
    if args.limit:
        jobs = jobs[:args.limit]
    if args.shard:
        i, n = parse_shard(args.shard)
        jobs = shard_jobs(jobs, i, n)
    if not jobs:
        n_rows = sum(len(r) for r in rows_by_file.values())
        seen = sorted({str(r.get("content")) for rows in rows_by_file.values() for r in rows})
        print(f"no eligible clips: {n_rows} rows read, content values {seen}, eligible "
              f"{'any' if args.all_content else sorted(parse_content(args.content))}"
              f"{' (empty after --limit/--shard)' if all_jobs else ''}; use --content or --all-content",
              file=sys.stderr, flush=True)
        print(json.dumps({"clips": 0, "processed": 0, "skipped": 0, "resumed": 0, "failed": 0,
                          "rows_read": n_rows}), flush=True)
        return 0
    if args.verify_processor:
        for j in jobs:
            try:
                verify_processor(j, j.seconds)
                break
            except CLIP_ERRORS as exc:
                print(f"FAILED {j.row['clip_path']}: {exc} (verify-processor tries the next clip)",
                      file=sys.stderr, flush=True)
        else:
            print("verify-processor: no clip could be loaded", file=sys.stderr, flush=True)
    summary = run(jobs, device=args.device, min_conf=args.min_conf, min_note_ms=args.min_note_ms,
                  legato=args.legato, tuning_correct=args.tuning_correct, seconds=args.seconds,
                  render=args.render_check,
                  render_dir=Path(args.render_dir) if args.render_dir else None)
    summary["shard"] = args.shard or "all"
    if args.write_midi_captions:
        dirs_of = {j.row["clip_path"]: (j.midi_dir, j.chroma_dir) for j in all_jobs}
        written: dict[str, int] = {}
        for cap in captions_files:
            out = midi_captions_path(cap, args.tuning_correct)
            written[str(out)] = write_midi_captions(out, rows_by_file[cap], dirs_of, tuning_correct=args.tuning_correct)
            print(f"wrote {out}: {written[str(out)]} rows with a MIDI (of {len(rows_by_file[cap])})", flush=True)
        summary["midi_captions"] = written
    print(json.dumps(summary), flush=True)
    if summary["failed"]:
        print(f"{summary['failed']} clips failed to load (see FAILED lines above)", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
