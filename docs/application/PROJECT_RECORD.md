# Project record: SomaliMusicCorpus and QaraamiGen

*Khalid Ibrahim. Written 2026-09-08 from the repository as it stands at that date. Every number
below traces to a file named in the "Where everything is" section. This is the account I use for
the research statement, for the conversation with faculty, and for my own memory of what was done
and in what order.*

## 1. What this project is

Somali music has no dedicated dataset, benchmark or model in the music-information-retrieval
literature. Twentieth-century Somali song, the *heello* and *qaraami* repertoires, survives on
aging cassette in a handful of archives and in the memories of elderly performers. This project
builds the computational side of preserving it, in three tracks that share one codebase:

1. **Musicology.** A method for measuring intonation on archival cassette audio, with a per-track
   pentatonic grid that absorbs key, tape speed and reference-pitch assumptions in one fitted
   parameter, and the first quantitative description of the Somali tonal system from recordings.
2. **Generative modelling.** Whether a general text-to-music model can learn something of the
   tradition from the tapes without the tapes leaving their rights holders, how to know that it
   has, and how to steer it toward what the tradition sounds like rather than what the tape sounds
   like.
3. **Preservation infrastructure.** An invite-only archive platform (field recording, transcription,
   analysis, search, lessons, a research API) with a rights model enforced in code, and a
   governance model aligned with the CARE principles.

The generative track is the one this record covers in most detail, because it is the most recent
and the one the demo page shows.

## 2. Timeline

| when | what |
| --- | --- |
| 2024 | A dataset strategy document (`docs/DATASET_STRATEGY.md`) framed the idea commercially. Superseded in spirit by the research and governance framing below; see §9 on what not to circulate. |
| April 2026 | First fine-tuning attempts, before this repository: a naive full-decoder MusicGen fine-tune with NaN loss, and a cloud MusicGen-medium run with no held-out metrics. Both superseded; kept only as history on the archived old Mac. |
| 2 to 5 July 2026 | Repository created. The platform built in phases: monorepo, authentication, mobile field recording and upload, archive browser, lessons, search, subscriptions, admin dashboard, Whisper transcription, CREPE pitch analysis, MERT embeddings and similarity search, database repositories, research API, first ISMIR draft (`docs/ISMIR_PAPER_DRAFT.md`). |
| 12 July 2026 | Publication and funding plan; embedding audit finds same-cassette nearest neighbours at 13× chance, which fixed cassette-level splits as the standard (`docs/PUBLICATION_PLAN.md`). |
| 17 to 18 July 2026 | LoRA fine-tuning of MusicGen-small on the Harvard corpus at two learning rates: held-out loss rises from 4.63 to about 6.7 nats and never recovers. Written up as a negative result. |
| 9 August 2026 | The same collapse on the private oud collection rules out the data. A five-condition probe finds the cause in the training harness (§5). The first corrected run beats the base model at every checkpoint (`docs/OUD-LORA-RESULTS.md`). |
| 2 September 2026 | Work moves to the M5 Max; the harness runs ten times faster (1.0 s/step vs 9.7). |
| 3 September 2026 | Harvard corpus rerun under the corrected harness, 1,500 and 3,000 steps; every checkpoint beats base. A DeepFilterNet-denoised variant run as a negative control. |
| 4 September 2026 | `deploy-v1`: local inference service with hot-swapped adapters, demo page, load test, evaluation package with two model cards. `scale-v1` begins: corpus inventory across three sources (43.1 h), 30-second dataset, MusicGen-medium and MusicGen-large runs, vocal-model survey. |
| 5 September 2026 | Medium and large results: per-song held-out cross-entropy gains of 0.102 and 0.128 nats with bootstrap intervals that exclude zero (`docs/eval/SCALING_REPORT.md`). |
| 6 to 7 September 2026 | Listening page with a blind paired-comparison protocol; shareable demo page generated from the run artifacts (`docs/demo/`). |
| 8 September 2026 | First blind test on the large adapter (preferred 11 of 16, called noisy in 7). Stage 5, preference optimisation: reward model, DPO trainer, four rounds, one failure kept on record (`docs/eval/PREFERENCE_OPT.md`). |

Commit counts: 64 in July, 54 in August, 31 in September to date.

## 3. Data: what exists, where it came from, and its rights

### 3.1 Sources

| source | content | hours | rights status |
| --- | --- | --- | --- |
| Maryan "Aryette" Omar Ali Collection, Harvard Archive of World Music, AWM Spec Coll 103 | 504 cassettes of Somali song 1955–1991; 974 catalogue entries; 605 tracks retrieved; a 119-track local subset used for modelling (105 MP3 + 15 WAV), 11,386 fifteen-second clips | 22.6 (local subset) | Catalogue metadata CC BY 4.0. Audio not rights-cleared for redistribution; written permission from the Loeb Music Library requested and outstanding. |
| Private oud (kaban) qaraami collection | 40 files, 28 unique songs after byte-level deduplication; oud-led, sung, hand drums; home recordings | 5.4 | Rights remain with the performers and holder. Performer name withheld on the platform and on every public-facing artifact. Not redistributed. |
| Qaraami imports recovered from my own GarageBand and Logic session archives | 197 unique recordings inside 382 project files | 15.1 | Mixed and partly unknown. Research use only. |
| **total** | 342 files, 330 unique | **43.1** | **0 hours cleared for public release** |

Inventory and characterisation of all three: `docs/data/CORPUS_INVENTORY.md`, measured by
`apps/ai-service/scripts/corpus_inventory.py` (ffprobe duration and format, Silero VAD vocal estimate,
harmonic-percussive ratio). The VAD is a speech detector and undercounts singing badly; most of the
43 hours is sung qaraami.

Acquisition of the Harvard audio: downloaded from Harvard's public research-streaming endpoints at the
URLs listed in the CC BY 4.0 catalogue export, rate-limited, without circumventing any access control,
for research use. 605 of 974 entries were retrieved; the full inventory including unretrieved entries is
kept so that missingness is analysable (`data/harvard_inventory.csv`).

### 3.2 Processing pipeline for the corpus (musicology and platform)

`apps/ai-service/scripts/process_harvard.py`, nine resumable stages, each skipping existing outputs
and logging with per-track correlation IDs. No audio is sent to any third-party API.

1. **Inventory**: filename and catalogue parsing, SHA-1 duplicate detection, recording-date recovery from
   catalogue titles.
2. **Quality audit**: peak and RMS, percentile-frame SNR (median 9.5 dB on the dev subset; 100 of 105 tracks
   below 15 dB), clipping fraction, silence bounds. Low-SNR tracks are flagged, never dropped.
3. **Enhancement** (DeepFilterNet) and 4. **Separation** (Demucs): for the listening platform and the
   transcription front end only, never upstream of any measurement or any training set (see §3.4).
5. **Normalisation**: −23 LUFS with an 80 Hz high-pass, for playback copies.
6. **Transcription**: Whisper large-v3, Somali, with a sung/spoken gate; sung segments are stored but
   flagged unreliable and never used as lyric ground truth.
7. **Pitch**: torchcrepe at 10 ms, confidence gate, per-track pentatonic grid alignment.
8. **Embeddings**: MERT-v1-95M, window-averaged, L2-normalised.
9. **Assembly**: one schema-validated record per track; exports as JSON, CSV, JSONL in Hugging Face
   format, and a path-free "lite" variant (`data/dataset/`, dataset card `data/DATASET_CARD.md`).

The dev subset (105 tracks, 22.6 h, 31 cassettes) has been through every stage. The full 605-track run
is the single blocking task for the dataset paper.

### 3.3 Dataset construction for fine-tuning

Two recipes, same principles, separate outputs. Neither writes audio or tokens into git.

*15-second sets (MusicGen-small runs).* `oud_prepare.py` and `phase1_preprocess.py`: byte-level
deduplication by SHA-256; 32 kHz mono; peak normalisation then −14 LUFS; 15-second segments with 50%
overlap; quiet segments dropped; captions from measurement (tempo by librosa, tonic by the project's own
pentatonic detector) plus catalogue metadata; song-level 80/10/10 splits by sorted SHA-256 so a song is in
exactly one split. Harvard: 11,386 clips. Oud: 1,921 clips (1,512 / 133 / 276).

*30-second set (medium and large runs).* `build_scale_dataset.py` over all three sources: 9,662 clips
from 311 songs, split by song into 7,857 training clips (252 songs), 1,008 validation (29) and 797 test
(30), with a leakage check that asserts no song hash appears in two splits. Captions follow one grammar:
genre, tradition, lead instruments, tempo word and BPM, pentatonic tonic, an era or tape descriptor, and
for catalogue tracks the performer credit. Nothing is asserted that the data does not support: "qaraami"
is used only when a genre word is present or the source is the qaraami corpus, otherwise "Somali song".

*Tokens.* Every clip is encoded once with EnCodec 32 kHz at 2.2 kb/s (4 codebooks at 50 Hz), the
tokenizer every MusicGen size shares (`scale_tokens.py`, `phase1_tokens.py`), with delay-pattern labels
built at training time.

### 3.4 What "cleaning" deliberately did not do

- **No enhancement or separation upstream of measurement or training.** The DeepFilterNet negative
  control (3 September) showed why: on this corpus it removed a median 13 to 15 dB, mostly the 1 to 3 kHz
  band where the oud and the vocal presence live, and its output correlates 0.41 with the raw waveform. An
  adapter trained on the denoised clips is worse than the base model on raw audio (4.8705 vs 4.8363).
- **No dropping of low-quality material.** SNR is recorded and reported, not used to filter.
- **No predicted cultural labels.** Genre and era labels are assigned by Somali scholars or left absent
  (`docs/DATASET_STRATEGY.md` is superseded on this point by `DATA_PROVENANCE.md` and the dataset card).
- **No key correction.** Deviation from twelve-tone equal temperament is treated as signal.

## 4. What can be published, and where

The honest answer first: **no audio from any of the three sources can be published today**, on
Hugging Face or anywhere else, and neither can the adapter weights, which are derived from that audio.
The project's own provenance rules say so, and the rules are enforced in `.gitignore`. What can be
published, and the order I would do it in:

1. **Metadata and annotations for the Harvard dev subset, without audio.** The Hugging Face-format
   export already exists (`data/dataset/somali_music_dataset_v1_huggingface/`, card in
   `data/DATASET_CARD.md`): catalogue metadata under Harvard's CC BY 4.0, audio-derived annotations
   (quality audit, gated transcripts, pitch statistics, embeddings) under CC BY-NC 4.0. This is the release
   the ISMIR draft describes, and it follows the precedent of the Erkomaishvili and ORD-CC32 corpora,
   which released annotations while the audio stayed with the archive. It needs governance sign-off (the
   Cultural Advisory Board named in the card) and, ideally, the Harvard letter, which would de-risk review.
   Embeddings are the item to think hardest about: they are not audio and cannot be turned back into it,
   but they are the most "derived" object in the release.
2. **Code**, under a real licence. `package.json` still says UNLICENSED; the paper promises release under
   community governance. Decide the licence (Apache-2.0 for code is the conventional choice) before any
   professor is pointed at the repository.
3. **The evaluation package and model cards** (`docs/eval/`), which contain numbers, not audio, and are
   already written for a reviewer.
4. **Model outputs**, shared privately with named researchers as research artifacts. The demo page is
   built for exactly this. Public posting of outputs waits on the rights items below.
5. **The adapters**, only after the source rights are cleared.

What unlocks more: written permission from the Loeb Music Library (22.6 h), consent from the oud
collection's holder (5.4 h), and consented field recordings with living musicians under the
Foundation's own programme, which is the only path to a fully publishable source-to-generation demo.

**One item is blocking and urgent, and it is not about publishing more but about publishing less.**
`docs/DATA_PROVENANCE.md` records that the deployed website serves collection audio on the public web in
two places: the machine-listening demonstration page (mixture and four stems of a collection recording)
and the listening-room MP3s, which answer direct URL requests without authentication. Before any faculty
member is invited to look at the project, those must be unpublished or moved behind authenticated
delivery. A professor who finds Harvard audio served publicly will read everything else in that light.

## 5. Training: what was done and what went wrong first

### 5.1 The harness and the defect

Fine-tuning is LoRA on MusicGen's decoder over precomputed EnCodec tokens with delay-pattern labels,
fp32 on Apple silicon, batch size 1 with gradient accumulation, cosine schedule with warm-up, gradient
clipping, gradient checkpointing (`apps/ai-service/scripts/phase2_train.py` for small, `scale_train.py`
for medium and large).

For two months every run collapsed: held-out loss rose from 4.6 to 6.7 or worse within 250 steps at
every learning rate on both corpora, while the generations lost half their melodic content. I drafted
that as a finding about archival audio. It was the harness. The Hugging Face MusicGen decoder applies
dropout functionally, through 37 floating-point attributes consumed by `F.dropout` with
`training=self.training`, which a sweep over `nn.Dropout` modules never touches. A five-condition probe on
identical zero-initialised LoRA weights (`probe_train_eval_gap.py`) measured eval-mode loss 4.05 against
train-mode loss 9.74, worse than uniform random over the 2,048-token codebook (7.62); zeroing every
`nn.Dropout`, disabling checkpointing, or putting the encoders in eval mode changed nothing. Setting the
37 attributes to zero makes the training and evaluation paths identical. The medium and large decoders
have 61 such attributes. The failure is a property of the model family, and it is reported as such.

### 5.2 Runs under the corrected harness

| run | model | corpus | LoRA | steps | held-out result |
| --- | --- | --- | --- | --- | --- |
| oud, 9 Aug | small | oud, 15 s | r16 α32, attention | 1,000 | val CE 4.5132 → 4.4785, test 2.6302 → 2.6092, best step 500; listening gate passed |
| harvard_raw, 3 Sep | small | Harvard, 15 s | r16 α32, attention | 3,000 | val 4.6262 → 4.5501, test 4.8363 → 4.7468, best step 2,750; plateau by 2,500 |
| harvard_denoised, 3 Sep | small | Harvard denoised | r16 | 1,500 | negative control: worse than base on raw audio |
| qaraami_medium_r32, 5 Sep | medium 1.5 B | all three, 30 s | r32 α64, attention and FFN, 61.3 M params | 3,000 | per-song test CE 4.1011 → 3.9996, gain +0.102 [0.078, 0.123] |
| qaraami_large_r32, 5 Sep | large 3.3 B | all three, 30 s | r32 α64, 81.8 M params | 3,000 | per-song test CE 4.0750 → 3.9469, gain +0.128 [0.104, 0.152] |

Schedules: lr 1e-4 for small, 5e-5 for medium and large, cosine with 100 warm-up steps, batch 1 × 4
accumulation. Compute: an M1 laptop for the August run (about 9 s/step); the M5 Max for everything since
(small 1.0 s/step, medium about 10 s/step at 11 GB, large about 16 s/step at 16 GB). Every checkpoint of
every corrected run beats its base model on held-out songs.

### 5.3 What the adapters learned, and what they learned that we did not want

On both corpora the small adapters put 64 to 68% more trackable melody into their output than the base
model, learn the cassettes' 25-cent tuning offset (base output sits near A440), and keep pentatonic
conformity similar (oud) or lower (Harvard). The larger models grow the held-out gain and nearly double
the voiced fraction (large: 0.355 → 0.683). They also learn the tape: my own blind test on the large
adapter (8 September, 16 pairs, order randomised per pair) preferred the adapter in 11, the base in 2,
neither in 3, and my notes say "noisy" seven times.

## 6. Evaluation: how the numbers are made

- **Likelihood**: token cross-entropy on unseen songs, averaged within each song and then across songs,
  with a 95% bootstrap interval resampled over songs. The song is the unit of independence on archival
  audio because same-cassette clips share deck, speed error and noise floor; the embedding audit found
  same-cassette nearest neighbours at 13× chance. Cross-entropy is not comparable across corpora or
  across tokenisation conditions.
- **Output**: the Pentatonic Conformity Score (duration-weighted fraction of pitched frames within 50
  cents of the best-fitting anhemitonic pentatonic set after a per-clip tuning fit) read only beside
  the voiced fraction, using the same scorer that measures intonation in the recordings themselves
  (`pcs.py`, `pentatonic.py`). At eight to sixteen prompts PCS is inside scorer noise; the voiced-fraction
  effect is not.
- **Listening**: paired A/B sets with identical prompt and seed, and a blind protocol on the listening
  page that randomises A/B order per pair, hides scores and file names, saves the result with a Wilson
  interval, and flows into the report and the demo page (`ab_listen.py`, results in `data/listening/`).
- **Reproducibility**: every table and figure in `docs/eval/` is generated by `eval_report.py`,
  `dpo_report.py` and `build_demo_page.py` from the run artifacts; `scripts/reproduce_oud_smoke.sh`
  re-runs the training smoke test and checks the harness invariants and the base validation loss.

Not claimed: long-form structure (clips are 10 to 30 s); a model of Somali music at large (each adapter
models the collections it saw); significance on the small-model margins; a listening study beyond one
listener.

## 7. Deployment

`services/musicgen-api`: MusicGen-small with the oud and harvard_raw adapters loaded once and hot-swapped
per request, batch size 1, a three-request queue, bearer-token auth, structured logs, a PCS endpoint, and
a provenance line on every output naming the adapter's corpus and stating that source audio is not
distributed. Served by launchd on loopback and a Tailscale address only, never 0.0.0.0. Load test: 10 s of
audio in 8.35 s median, 3.2 GB of GPU memory. Demo at `/demo` (`docs/deploy/DEPLOY.md`).

## 8. Stage 5: steering the model toward the tradition rather than the tape

Direct preference optimisation on the adapter weights (`dpo_train.py`), with a reward measured on the
model's own samples (`reward_model.py`): Mahalanobis distance to the real oud recordings in the MERT
embedding space, fitted on the 1,512 real oud training clips; a hiss measure from the 3 to 10 kHz band
(real cassette 4.5 dB, real oud 8.3, base MusicGen 10.4; on the seven blind pairs I called noisy the noisy
clip reads 4.3 dB against 11.6); and the pentatonic-melody score. Each round samples four clips per
prompt from the oud caption grammar, keeps best and worst as a pair, caches the reference
log-probabilities, and trains with every dropout disabled so that policy and reference are the same
function of the weights (at step one the loss is ln 2 and the margin zero, as it must be). Guards: held-out
oud token cross-entropy, distance and hiss on 40 held-out prompts, MERT-FAD, the spread of the outputs,
and a before/after blind set per round.

| round | distance to real oud (real clips 4.13) | held-out CE | spread (real 0.67) | verdict |
| --- | --- | --- | --- | --- |
| small oud adapter | 5.69 → 4.29 | 4.407 → 4.686 | 0.47 → 0.25 | passed, at a cost |
| medium, first recipe | 4.97 → 7.33 | 4.203 → 5.703 | 0.43 → 0.22 | failed; drifted louder and band-limited; kept on record |
| large, revised recipe | 5.10 → 4.14 | 4.142 → 4.180 | 0.45 → 0.35 | passed |
| medium, revised recipe | 4.97 → 3.54 | 4.203 → 4.269 | 0.43 → 0.26 | passed; concentrates inside the real distribution |

The revised recipe adds a likelihood anchor on real oud clips at every step and a KL budget that ends a
round when the policy's log-ratio on its own chosen clips falls below −0.3 nats per token. Every round
narrows the output distribution; that cost is measured and reported. The large adapter after
optimisation is the model to listen to: `data/ab_showcase_large_30s/` holds eight 30-second clips chosen
best-of-four by reward. Details and the failure analysis: `docs/eval/PREFERENCE_OPT.md`.

## 9. Presenting the work to faculty

**What to send.** The single file `docs/demo/site/QaraamiGen-demo.html` (about 15 MB, every clip and
figure inlined; opens in any browser with no server). It reads as a first-person research note in the
format of a group's demo index: audio pairs on identical prompt and seed, held-out numbers with
intervals, the harness defect, method, the preference-optimisation table, and the rights statement.
Attach it to the email directly, or share it through a link restricted to the recipients' addresses.
Do not put it on a public URL: its clips are model outputs derived from held recordings, and the
provenance rules treat public posting as a separate decision.

**What to say.** Three short paragraphs in your own words: what the tradition is and why the tapes
matter now; the one technical finding a music-ML researcher will recognise (a harness defect that
looked like a negative result for two months, and what the corrected models learned); and one concrete
ask (a conversation about doctoral supervision, and, if it fits, an introduction to Harvard Library for
the research-access letter). Name the rights position in one sentence so it is never a surprise.

**What to have ready when they answer.** The questions I would expect, with the file that answers each:
how the splits avoid leakage (`docs/eval/EVALUATION.md`, the embedding audit in the paper draft); why
cross-entropy and not FAD as the headline (per-song CE with intervals is the honest metric at these
sizes; FAD is reported where the pool is large enough); what the listening evidence is (one listener so
far, blind, on record; a study with Somali musicians is the next step); what the rights are
(`docs/DATA_PROVENANCE.md`); whether the model is "Somali" (each adapter models the collections it saw;
the claim is the measured shift toward the real recordings, not authenticity).

**What not to circulate.** `docs/DATASET_STRATEGY.md` (the 2024 commercial framing contradicts the
governance position and the CARE alignment the dataset card commits to); the paper draft until its
labelled TODO blocks are resolved, since its abstract still states the superseded July negative; any
page that serves collection audio.

## 10. Toward the application

The MIT Music Technology and Computation programme opened its PhD applications in the fall of 2025 for a
first class entering in 2026; the master's deadline that cycle was 22 December 2025, and the programme
site (musictech.mit.edu) is the place to confirm the PhD date for the coming cycle. Faculty in that
programme and in EECS are the natural readers of this work.

What the record above says a committee will find, and what it will not yet find:

- **Found**: a first dataset for a tradition with none, built with a defensible rights model; a
  measurement method with a real result (86% of voiced frames within a quarter tone of a per-track
  pentatonic grid; no drift toward equal temperament on dated tracks, preliminary); a generative result
  that reverses its own earlier negative with a documented diagnosis; a scaling result with confidence
  intervals; a preference-optimisation stage with its guards and its one failure on record; a deployed
  system; and a codebase where every number regenerates from artifacts.
- **Not yet found**: a listening study with more than one listener; the full-corpus run behind the
  dataset paper; the Harvard letter; a preprint. Those are the items to close between now and the
  deadline, in that order of value per week of work.

Ranked list for the weeks before applications open:

1. Remove the public serving of collection audio on the deployed site (§4). Hours, and blocking.
2. Send the Harvard Loeb Music Library request if it has not been sent, and keep the correspondence.
3. Run the blind listening tests on the optimised models and recruit two or three Somali musicians for a
   small paired-comparison study using the same protocol; the page and the report absorb the results.
4. Resolve the paper draft's TODO blocks and post the corpus-and-method paper to arXiv as the citable
   preprint; the ICASSP method paper if the deadline can be met.
5. Choose a code licence and prepare the annotation-only dataset release for Hugging Face behind
   advisory-board sign-off.
6. Send the demo page to the two professors with the three-paragraph note.

## 11. Where everything is

| what | where |
| --- | --- |
| rights and provenance, per collection, with the outstanding items | `docs/DATA_PROVENANCE.md` |
| corpus inventory across all sources | `docs/data/CORPUS_INVENTORY.md`, `data/inventory/` |
| dataset card and the Hugging Face-format export (metadata and annotations, no audio) | `data/DATASET_CARD.md`, `data/dataset/` |
| processing pipeline | `apps/ai-service/scripts/process_harvard.py` |
| fine-tuning datasets | `oud_prepare.py`, `phase1_preprocess.py`, `build_scale_dataset.py`, `scale_tokens.py` |
| training harness and the defect probe | `phase2_train.py`, `scale_train.py`, `probe_train_eval_gap.py` |
| evaluation package, model cards, scaling report | `docs/eval/` |
| paper draft and publication plan | `docs/ISMIR_PAPER_DRAFT.md`, `docs/PUBLICATION_PLAN.md`, `docs/PROFESSOR_BRIEF.md` |
| inference service and deployment notes | `services/musicgen-api/`, `docs/deploy/` |
| listening page and blind test | `apps/ai-service/scripts/ab_listen.py`, results in `data/listening/` |
| preference optimisation | `reward_model.py`, `dpo_train.py`, `showcase.py`, `dpo_report.py`, `docs/eval/PREFERENCE_OPT.md`, `runs/dpo_*/` |
| demo page and its builder | `docs/demo/site/QaraamiGen-demo.html`, `build_demo_page.py`, `docs/demo/README.md` |
| research statement notes and figure list | `docs/application/` |
