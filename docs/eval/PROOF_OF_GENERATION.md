# Proof of generation — the Generate page plays model output, not a recording

Date 2026-09-28. Service `com.qaraamigen.musicgen-api` on this Mac
(`127.0.0.1:8765`, launchd pid 33788, device `mps`, 15 h uptime at the time of
the tests, code `services/musicgen-api/app.py` unchanged, adapter `large` =
`runs/qaraami_large_r32/ckpt_step_2750` on `facebook/musicgen-large`). No
training was running (`tmux ls`: no server). Every number below was produced in
this session by the scripts named; the raw files are in `data/proof_generation/`
(git-ignored, audio and embeddings never committed). Companion:
`PROOF_OF_GENERATION_DEMO.md`, a live version of tests 1 and 2 for a screen
recording.

## The request

```json
POST /generate  {"prompt": "Somali qaraami led by the oud (kaban), moderate tempo, pentatonic melody, intimate recording",
                 "duration": 15, "cfg": 3.0, "seed": 73, "adapter": "large", "score": false}
```

Six generations were made against the live service, in this order, one at a
time (the service runs batch size 1 and a single worker per engine):

| file (`data/proof_generation/`) | prompt | seed | service id | request id | SHA-256 (first 16) |
| --- | --- | --- | --- | --- | --- |
| `seed73_a.wav` | qaraami (above) | 73 | `c9857e56e6cc4ae8` | `4d7e03eb1027` | `9ba959767f6296e1` |
| `seed73_b.wav` | qaraami | 73 | `cb36701d6d814d60` | `b2ed414a711d` | `9ba959767f6296e1` |
| `seed74.wav` | qaraami | 74 | `1d0a8e85e4c54d26` | `64ec1c0a2f0f` | `aebc4867b04e0c97` |
| `seed75.wav` | qaraami | 75 | `d8c8e1ab900742b7` | `31b62696ffcf` | `a90f6ea1e5c6dc68` |
| `seed73_dhaanto.wav` | "Somali dhaanto, fast, hand drums" | 73 | `bcfd2072568b4674` | `85d2ccabb10c` | `b8da22133dc947b1` |
| `trace_seed73.wav` | qaraami | 73 | `5ab84d0064624f21` | `c23cae452d76` | `9ba959767f6296e1` (fresh process, test 4) |
| `webpath_seed73.wav` | qaraami | 73 | `765a568a352d4045` | `8d8a74cfe9db` | `9ba959767f6296e1` (through the Generate page's route, below) |

The last row went the way the Generate page goes: `POST
http://localhost:8000/demo/generate` on the AI service
(`apps/ai-service/routers/demo.py` → `services/musicgen_client.generate`, which
adds `score: true`) → the MusicGen service. It returned the same bytes as the
direct request, plus a PCS of 0.929 (voiced 0.73, tonic A♯). It was made while
test 5's MERT job shared the GPU, so its 128 s generation time is not
representative and is not used in test 3.

Every file is 956,204 bytes: 478,080 samples of 16-bit PCM at 32 kHz = 14.94 s
(MusicGen emits 50 tokens per second; 15 × 50 = 750 tokens decode to 14.94 s).
Full hashes are in `data/proof_generation/compare.json`.

## 1. Determinism — same seed, same bytes

`seed73_a.wav` and `seed73_b.wav` (two separate HTTP requests, two separate
files written by the service 41 s apart):

| measure | value |
| --- | --- |
| SHA-256 equal | yes (`9ba959767f6296e12ff9e1894e330493fdb5bad85a1b5d60954d0444d39b385c` both) |
| bytes equal | yes (956,204 = 956,204) |
| max sample difference | 0.0 |
| mean sample difference | 0.0 |
| Pearson r | 1.000000 |

The same request in a **fresh process** (test 4's trace process: new Python
interpreter, model weights loaded from disk again, the route called through
Starlette's TestClient) produced `trace_seed73.wav` with the same SHA-256 and a
max sample difference of 0.0 against `seed73_a.wav`. Determinism therefore
comes from `torch.manual_seed(seed)` before sampling (`app.py`, `Engine.generate`),
not from anything cached inside the running service.

## 2. Variation — new seed or new prompt, new audio

Compared with `seed73_a.wav` (same length, sample-aligned):

| other clip | Pearson r | max abs sample diff | mean abs sample diff | SHA-256 equal |
| --- | --- | --- | --- | --- |
| `seed74.wav` (seed 74, same prompt) | 0.0089 | 1.015 | 0.112 | no |
| `seed75.wav` (seed 75, same prompt) | −0.0034 | 1.338 | 0.158 | no |
| `seed73_dhaanto.wav` (seed 73, other prompt) | 0.0228 | 1.080 | 0.144 | no |

Between the three "other" clips r is −0.005 to 0.013. Sample-level correlation
near zero is what two unrelated 32 kHz waveforms give; the max differences are
of the order of full scale (peaks 0.83–0.97). RMS levels also differ
(0.143, 0.052, 0.157, 0.128), so these are not the same material re-gained.

## 3. Compute — time and memory per generation, from the service's own log

The service logs one JSON line per request to
`~/ai/musicgen-api/logs/musicgen-api.log` (launchd `StandardOutPath`) and
returns its own timings; `/health` reports process-wide `torch.mps` memory
counters. `proof_generate.py` polled `/health` every 0.5 s during each request.

| run | `generation_seconds` (model.generate only) | `total_seconds` (route) | log `ms` | MPS allocated idle → peak | MPS driver idle → peak |
| --- | --- | --- | --- | --- | --- |
| seed73_a | 40.57 | 40.94 | 40940 | 15,790 → 16,960 MB | 16,810 → 19,196 MB |
| seed73_b | 40.49 | 40.82 | 40820 | 15,790 → 16,962 MB | 16,896 → 19,119 MB |
| seed74 | 40.67 | 40.99 | 40990 | 15,790 → 16,962 MB | 17,920 → 19,111 MB |
| seed75 | 40.57 | 40.90 | 40900 | 15,790 → 16,960 MB | 17,920 → 19,111 MB |
| seed73_dhaanto | 40.61 | 40.94 | 40940 | 15,790 → 16,940 MB | 16,896 → 19,095 MB |

Log lines (`msg: "generated"`, `adapter: "large"`, `detail.seed` 73/73/74/75/73)
are copied into `compare.json` under `service_log_lines`; timestamps 14:02:28,
14:03:09, 14:03:50, 14:04:31, 14:05:12 UTC. About 2.7 s of compute per second
of audio; the 15.8 GB resident on the GPU at idle are the loaded small and large
models plus adapters, and the ~1.2 GB rise during a request is the sampling
state (KV cache and logits) that `torch.mps.empty_cache()` releases afterwards.
Process RSS stayed at 2.2–2.3 GB (weights live in MPS memory). Wall-clock as
measured by the client, 40.8–41.0 s, matches the service's figures. Serving a
stored file would take milliseconds and move no GPU memory.

## 4. No file playback — the `/generate` code path and a file-access trace

**Code path** (`services/musicgen-api/app.py`, read-only; line numbers of the
file as committed):

1. `generate()` (L643): validates the body, resolves the engine for the
   adapter, checks the queue, allocates `gen_id = uuid4().hex[:16]` and
   `out = OUTPUT_DIR / f"{gen_id}.wav"`.
2. `Engine.generate()` (L411): `torch.manual_seed(seed)`; the text goes through
   the processor (tokeniser, in memory); `self.model.generate(**inputs,
   do_sample=True, guidance_scale=cfg, max_new_tokens=seconds*50)` under
   `set_adapter(adapter)`; the returned tensor is written with
   `sf.write(out_path, wav, sr, subtype="PCM_16")`; `torch.mps.empty_cache()`.
3. `record_timing()` (L518): writes `OUTPUT_DIR/timings.json`.
4. Only with `score: true` (which the web page's path sets): `Engine.pcs()`
   (L427) `sf.read`s the clip it just wrote, to score it.
5. `generate()` writes `OUTPUT_DIR/{gen_id}.json` (the metadata) and returns.
6. `GET /audio/{gen_id}` (L693) serves `OUTPUT_DIR/{gen_id}.wav` with
   `FileResponse`.

Files the request path opens: the output WAV (write, then read for PCS or for
`/audio`), `timings.json` (write) and `{gen_id}.json` (write). There is no
other `open`, `sf.read`, `torch.load`, `np.load`, `glob` or directory walk in
the request path; the only reads of weights are in `Engine.load()` at startup
(the base model from the Hugging Face cache, the LoRA adapter from
`runs/.../ckpt_step_2750/`).

**Trace, inside the process** (`proof_trace.py`): a fresh interpreter installed
`sys.addaudithook` before importing the unchanged `app.py`, loaded only the
large engine, then called the real `/generate` route through Starlette's
TestClient with the seed-73 request. 8,645 audit events were recorded
(`trace_events.jsonl`, summary in `trace_summary.json`):

| phase | `open` events | what |
| --- | --- | --- |
| import | 2,238 | Python modules |
| load_engine | 4,940 | modules, package metadata, and the model files: `models--facebook--musicgen-large/.../config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json`, `special_tokens_map.json`, `pytorch_model-00001-of-00002.bin`, `pytorch_model-00002-of-00002.bin`, `pytorch_model.bin.index.json`, and `runs/qaraami_large_r32/ckpt_step_2750/adapter_config.json`; zero `.wav/.mp3/.flac/.m4a/.npy/.npz/.pt` files |
| generate (41.4 s) | 22 | 20 lazy imports of `.py`/`.pyc` in `anyio`, `torch` and the stdlib, then two writes: `trace_outputs/timings.json` and `trace_outputs/5ab84d0064624f21.json`. **Zero** audio or token files, zero reads of anything under `data/` or `runs/` |
| after_generate | 3 | the `GET /audio` read of the output WAV (`r`) and the test script saving its copy |
| control | 1 | a deliberate `open()` of the output WAV, to show the hook was live |

Limits of this trace, stated plainly: an audit hook sees Python-level opens
only. `libsndfile`'s write of the output WAV and the `safetensors` Rust loader's
read of `adapter_model.safetensors` (327 MB, in the same directory as the
`adapter_config.json` that was seen) happen in native code and do not appear.
A native library could in principle open a file without the hook noticing.

**Trace, outside the process** (`proof_generate.py`): during each of the five
live generations `lsof -p 33788` was sampled every 0.25 s (121–124 samples per
request) and diffed against the idle baseline of 196 open regular files (shared
libraries, Metal shader caches, the two log files, no audio and no weights).
Across all five requests **no new regular file** was seen open. This covers
native opens too, but as a sampler it misses opens shorter than 250 ms (it also
did not catch the service's own 20 ms write of the output WAV). `fs_usage`
would give a complete syscall trace but needs root, which the project rules
forbid, so it was not run.

Together: the code has no read of any audio or token file in the request path;
the in-process trace confirms the Python side; the out-of-process sampler saw
nothing opened natively either. A one-second-or-longer read of a stored
recording anywhere in the request would have appeared in the sampler.

## 5. Not a copy of training data — nearest neighbours in the large adapter's corpus

**Corpus.** `runs/qaraami_large_r32/config.json` names
`data/scale_captions.jsonl` as its captions; its `split == "train"` rows are the
clips the adapter saw: 7,857 rows, 7,612 distinct 30 s clips after removing 245
duplicate rows (the same clip path listed twice), 252 songs, sources
`harvard_raw` 4,189 rows, `band_qaraami` 2,755, `oud_ilkacase` 913. All files
present under `data/scale_clips/train/`. (`proof_nn.py`; results in
`data/proof_generation/nn_report.json`.)

**Two feature spaces.**

- *MERT*: the project's own embedding, `reward_model.embed_mert`
  (MERT-v1-95M, all layers and time mean-pooled, L2-normalised, cached in
  `data/reward/cache`), cosine similarity of the whole clip. A whole-recording
  fingerprint: it says "same kind of recording", not "same passage".
- *Chroma*: `librosa.feature.chroma_cqt` at 22,050 Hz, hop 1024 (21.5 frames/s),
  then the **maximum over every 15 s window** of each training clip of the
  Pearson correlation between that window's chroma sequence and the query's.
  A local copy detector: a 15 s passage lifted from anywhere in a training
  clip correlates at ≈ 1 with its source window.

**Controls, run through exactly the same search.** A *positive control*: a
15 s excerpt cut at 7.3 s from a random training clip
(`band_qaraami_04dcad8135b7_seg000`), queried as if it were a generation. And
the distributions a "not suspicious" result has to sit inside: random real
pairs, real pairs from the same song (other segments of the same performance),
each real clip's nearest neighbour, and generated–generated pairs (the four
proof clips plus the 32 base/adapter clips of `data/ab_large`).

### MERT (cosine similarity, whole clip)

Seed-73 output, ten nearest training clips:

| rank | similarity | clip | source |
| --- | --- | --- | --- |
| 1 | 0.9168 | `band_qaraami_6ee8dab6ad92_seg024` | band_qaraami |
| 2 | 0.9122 | `band_qaraami_6ee8dab6ad92_seg027` | band_qaraami |
| 3 | 0.9119 | `band_qaraami_6ee8dab6ad92_seg023` | band_qaraami |
| 4 | 0.9109 | `band_qaraami_6ee8dab6ad92_seg005` | band_qaraami |
| 5 | 0.9108 | `band_qaraami_6ee8dab6ad92_seg001` | band_qaraami |
| 6 | 0.9106 | `band_qaraami_6ee8dab6ad92_seg002` | band_qaraami |
| 7 | 0.9103 | `band_qaraami_6ee8dab6ad92_seg013` | band_qaraami |
| 8 | 0.9100 | `band_qaraami_6ee8dab6ad92_seg016` | band_qaraami |
| 9 | 0.9092 | `band_qaraami_6ee8dab6ad92_seg000` | band_qaraami |
| 10 | 0.9087 | `band_qaraami_6ee8dab6ad92_seg012` | band_qaraami |

All ten are segments of one band recording at a near-constant 0.909–0.917,
the signature of a shared recording character (ensemble, room, tape), not of a
particular passage: a copied passage would make one segment stand out. The
other proof clips: seed 74 max 0.872 (six songs in its top ten), seed 75
max 0.937 (one song), dhaanto max 0.933 (three songs).

Context (same embedding, same corpus):

| pair type | n | mean | median | p95 | max |
| --- | --- | --- | --- | --- | --- |
| real–real, random pairs | 19,997 | 0.817 | 0.821 | 0.926 | 0.9999 |
| real–real, same song, other segment | 1,158 | 0.966 | 0.981 | 0.997 | 0.9999 |
| real clip → nearest other real clip, other song | 500 | 0.967 | 0.969 | 0.9999 | 1.0 |
| real clip → nearest other real clip, any | 500 | 0.996 | 0.997 | 1.0 | 1.0 |
| generated–generated pairs (36 clips) | 630 | 0.771 | 0.775 | 0.897 | 0.975 |
| `ab_large` generated clip → nearest training clip | 32 | 0.907 | 0.903 | 0.949 | 0.950 |
| **seed-73 output → nearest training clip** | 1 | **0.917** | | | |
| positive control (real 15 s excerpt) → its own song's other segments | | **0.991** (ranks 1–2) | | | |

The seed-73 clip's best match, 0.917, is below the median nearest-neighbour
similarity between two *different* real clips (0.969) and far below the
same-song band (median 0.981) where the real excerpt lands (0.991). It sits
inside the range the other generated clips occupy (0.87–0.95). Two caveats:
MERT mean-pooling is coarse (random real pairs average 0.82, and the excerpt
scored only 0.940 against its own 30 s source clip because half of that clip
is not in the excerpt), and the corpus contains near-duplicate clips (nearest
neighbours at 0.9999 across "different" songs), which is a corpus-hygiene
observation, not a generation finding. The chroma test below is the sharper
copy detector.

### Chroma (max windowed correlation, 15 s query against every window)

Chroma at 21.5 frames/s gives 322 frames for the 15 s query and 646 per
training clip, so each clip is scanned at 325 window positions. The search was
run twice, with the explicit window-matrix definition (`proof_nn.py`) and a
cross-correlation implementation (`proof_chroma.py`); they agree to 2.6 × 10⁻¹⁶
and give the same maxima.

Seed-73 output, ten nearest training clips:

| rank | max window r | clip | source |
| --- | --- | --- | --- |
| 1 | 0.5187 | `band_qaraami_04dcad8135b7_seg007` | band_qaraami |
| 2 | 0.4778 | `band_qaraami_95c20092dcb6_seg000` | band_qaraami |
| 3 | 0.4658 | `band_qaraami_51c621e2ad4d_seg004` | band_qaraami |
| 4 | 0.4578 | `band_qaraami_8cc6b83abbe8_seg000` | band_qaraami |
| 5 | 0.4514 | `band_qaraami_09504e3833cf_seg000` | band_qaraami |
| 6 | 0.4040 | `band_qaraami_04dcad8135b7_seg008` | band_qaraami |
| 7 | 0.3817 | `band_qaraami_09504e3833cf_seg002` | band_qaraami |
| 8 | 0.3783 | `band_qaraami_9957fe94a1a9_seg000` | band_qaraami |
| 9 | 0.3722 | `harvard_raw_b38c849c8110_seg102` | harvard_raw |
| 10 | 0.3667 | `band_qaraami_51c621e2ad4d_seg010` | band_qaraami |

Seven songs in the top ten, none of them the MERT top hit; seed 74 max 0.397,
seed 75 max 0.342, dhaanto max 0.343.

Context (same search, same corpus):

| query → reference | n | mean | median | p95 | max |
| --- | --- | --- | --- | --- | --- |
| real 15 s excerpt → a random other real clip | 300 | 0.088 | 0.087 | 0.195 | 0.331 |
| real excerpt → another segment of the same song | 238 | 0.419 | 0.378 | 0.840 | 0.988 |
| real excerpt → nearest clip of any other song, whole corpus | 100 | 0.590 | 0.479 | 0.9994 | 1.0 |
| real excerpt → nearest other clip, any song | 100 | 0.777 | 0.822 | 0.9995 | 1.0 |
| generated → generated (36 clips) | 630 | 0.024 | 0.006 | 0.273 | 0.548 |
| `ab_large` generated clip → nearest training clip | 32 | 0.410 | 0.377 | 0.592 | 0.604 |
| **seed-73 output → nearest training clip** | 1 | **0.519** | | | |
| **positive control: real excerpt → its own source clip** | 1 | **0.963**, rank 1 of 7,612; best clip of any other song 0.315 | | | |

The positive control shows what a copied passage looks like: the 15 s excerpt
of `band_qaraami_04dcad8135b7_seg000` finds its source at r = 0.963 (not 1.0
only because the 7.3 s cut is not frame-aligned), ranked first, with the next
segment of the same song at 0.759 and every other song below 0.32. The
seed-73 output's best window anywhere in the 7,612 clips is 0.519, in the
band where a genuinely different real excerpt lands against its nearest
neighbour in another song (median 0.479) and where the other generated clips
land (0.377 median, 0.604 max). Its top hit happens to be another segment of
the control's song; that is the random draw of the control (seed 73 of the
sampler), and it changes neither number.

Corpus observations that fell out of the search, for the record and not part
of the proof: 245 of the 7,857 train rows are duplicate paths (all in
`oud_ilkacase`: 913 rows, 668 distinct clips), and about 5 % of real excerpts
find a near-verbatim match (r ≥ 0.999) under a *different* song hash, so the
corpus holds some duplicate recordings across song IDs.

**Verdict for test 5.** No training clip is suspiciously close to the seed-73
output. In MERT space the best match (0.917) is below the typical similarity
between two different real clips' nearest neighbours; in the windowed chroma
space a real copied passage scores 0.96 and the output's best is 0.52, an
ordinary value for unrelated qaraami material. The search covers the 7,612
distinct training clips of the adapter; it does not cover the base model's own
(Meta) training data, which is not available, so "not a copy of *this*
corpus" is the exact claim.

## 6. Conclusion

The audio the Generate page plays is computed by the model when the request
arrives. Asking the service twice for seed 73 gave two files with the same
SHA-256 and zero sample difference, and a fresh process that loaded the weights
from disk, and the page's own route through the AI service, produced those same
bytes again; changing the seed or the prompt gave waveforms with sample
correlation near zero. Each request took about 41 s of GPU work for 15 s of
audio and moved about 1.2 GB of GPU memory, as the service's own log and health
endpoint record. The request path in `app.py` opens nothing but the file it is
writing and its metadata; an audit hook inside a copy of the service saw no
audio, token or data file opened during generation, and a 4 Hz `lsof` sampler
on the live process saw no new file at all across five generations. The output
is not a stored recording of the training set either: against all 7,612
training clips of the large adapter, its best whole-clip MERT similarity
(0.917) and its best 15 s chroma window match (0.52) are both ordinary values
for unrelated qaraami, while a real copied passage scored 0.96 in the same
search. Two things remain outside what was measured: native file opens inside
libraries (the in-process hook cannot see them, the sampler could miss one
shorter than 250 ms, and `fs_usage` needs root), and the base model's own
training data, which is not on this machine. Within those limits every test
came out the way a generating model, and not a playback, would produce.

## Files

- `data/proof_generation/` (git-ignored): the six WAVs above, `runs.json`
  (requests, responses, memory traces, lsof diffs), `compare.json` (tests 1–3),
  `trace_events.jsonl` + `trace_summary.json` (test 4), `mert_embeddings.npz`,
  `chroma_train.npz`, `nn_report.json` (test 5), `webpath_seed73.json`.
- Scripts, kept beside the data in `data/proof_generation/scripts/`:
  `proof_generate.py` (tests 1–3 and the lsof sampler), `proof_trace.py`
  (test 4), `proof_compare.py` (numbers for 1–3), `proof_nn.py` (test 5, MERT
  and the reference chroma search), `proof_chroma.py` (test 5, the fast chroma
  search and context distributions).
- The 15 s positive-control excerpt (`_positive_control_excerpt.wav`) is cut
  from a band recording of the corpus: it stays in the git-ignored folder and
  does not leave the machine (`docs/DATA_PROVENANCE.md`).
