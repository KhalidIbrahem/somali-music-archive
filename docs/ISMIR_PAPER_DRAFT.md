# SomaliMusicCorpus: A Labeled Dataset of Twentieth-Century Somali Song for Music Information Retrieval

**Working draft v2.2 — submission strategy in `PUBLICATION_PLAN.md`: arXiv + ISMIR 2026 LBD (dev-subset version, Aug–Sept 2026) → ICASSP 2027 method paper (Sept 16, 2026) → TISMIR / ISMIR 2027 dataset paper (full corpus).**
**Status:** all quantitative statements below are computed from data on disk by `apps/ai-service/scripts/analyze_corpus.py`, `scripts/analyze_embeddings.py`, and (new in v2.2, §§7.5–7.6) `scripts/phase2_train.py`, `scripts/phase3_pcs_run.py`, `scripts/phase4_ablation.py`, and are reproducible from the released code; numbers marked *(dev subset)* come from the 105-track development subset (§§3–7.4) or the 119-track local subset (§§7.5–7.6: the 105 MP3 tracks plus 15 additional WAV-only tracks, audited in `data/manifest.csv`) and will be recomputed on the full 605-track corpus before the dataset-paper submission. Nothing in this draft is a placeholder; every reference is verified.

Khalid Ibrahim
Somali Music Preservation Foundation, Minneapolis, MN, USA
`research@somalimusicarchive.com`

---

## Abstract

Somali music has, to our knowledge, no dedicated dataset anywhere in the music-information-retrieval literature. We present **SomaliMusicCorpus**, a labeled corpus built from the Maryan "Aryette" Omar Ali Collection at Harvard University's Archive of World Music (AWM Spec Coll 103): 605 digitized tracks drawn from a 504-cassette collection of twentieth-century Somali song — *heello*, *qaraami*, theatre and praise songs, 1955–1991 — with structured metadata recovered from the Harvard finding aid, including exact recording dates for a subset of tracks. We contribute (1) the annotated corpus and its open, resumable processing pipeline; (2) a method for measuring intonation in archival cassette audio that fits a pentatonic reference grid *per track*, making the measurement invariant to key, tape speed, and A440 assumptions — deviations that smear to 63 cents against a fixed grid concentrate to a median per-track dispersion of 26 cents after alignment, with 86% of voiced frames within a quarter tone of the fitted grid *(dev subset: 105 tracks, 706,483 gated frames)*; and (3) a pre-registered diachronic test of whether intonation moved toward equal temperament as Western fixed-pitch instruments entered Somali ensembles: on date-stamped tracks (1964–1976) we find **stability, not drift** (median dispersion 25.7 vs 26.8 cents, Mann–Whitney p = 0.47; n = 13 + 6, preliminary). An embedding-space audit adds a caution with reach beyond this corpus: MERT nearest neighbours retrieve same-cassette material at 13× chance (66% vs 5%), quantifying the channel leakage that makes cassette-level evaluation splits mandatory on archival audio. Two downstream probes sharpen that caution into results. LoRA fine-tuning of a text-to-music model (MusicGen-small) on the corpus *degrades* held-out token loss at both learning rates tested (4.63 → 6.70 nats at best) while voiced melodic content in its outputs halves — on hiss-dominated archival audio, generative adaptation learns the channel, not the tradition. And a transcription ablation quantifies a harm long suspected: standard Western major/minor key correction alters 77% of detected notes on this repertoire and *lowers* pentatonic scale conformity (0.898 → 0.862), whereas a scale-aware quantization stage that snaps only within-tolerance notes preserves the 11% of notes that carry ornamental or microtonal inflection — marked, never "corrected". Annotations, schema, and code are released under community governance; audio remains with Harvard Library. The corpus positions Somali song alongside recent East African, Arab, and cross-cultural corpus work, and doubles as a stress test for MIR robustness on real archival material.

## 1. Introduction

Music information retrieval is built on corpora, and the corpora are not evenly distributed. The canonical benchmarks contain no East African material [20, 5]; recent surveys and corpus projects for non-Western traditions [17, 18, 4] have reached Turkish makam [33], Carnatic and Hindustani music [31], Arab-Andalusian repertoire [32], Greek traditional song [30], Persian dastgah [43], and, in East Africa, Ethiopian *kiñit* [3]. Somali music is absent from all of it: we find no dedicated Somali dataset, benchmark, or model in the MIR literature, and Somali-language resources are thin even in speech and NLP [22, 34, 35, 42].

The absence is not for lack of material worth studying. Twentieth-century Somali song — the *heello* that carried nationalist politics in the 1950s [8], the *qaraami* repertoire whose surviving performance practice Somali scholarship is racing to document [36], the theatre songs of Mogadishu's playhouses — is a modally organized, predominantly pentatonic tradition transmitted with minimal notation, performed by ensembles that absorbed the *oud* (Somali *kaban*), violin, organ, electric guitar, and saxophone across four decades. It survives mainly on aging tape: radio archives were scattered or destroyed in the civil war, and preservation today is led by diaspora collectors and Somali institutions such as the Redsea Cultural Foundation in Hargeysa [36], alongside holdings at a small number of research libraries.

One collection makes computational study possible at scale. Maryan "Aryette" Omar Ali (d. 2011), a Djibouti-born collector and lifelong connoisseur of Somali popular song — co-author, with historian Lidwien Kapteijns, of the standard scholarly treatments of the repertoire [9, 10] — assembled a private cassette library that Harvard's Archive of World Music now preserves as **AWM Spec Coll 103: Somali Songs, 1955–1991** [15]: 504 audiocassettes, cataloged at track level (974 entries), digitized, and served for research listening with openly licensed catalog metadata.

This paper contributes:

1. **A corpus.** 605 digitized tracks with typed, schema-validated metadata parsed from the finding aid — title, performers, cassette/side provenance, and, for a subset, exact recording dates embedded in catalog titles (e.g. *"Milgo, 1966-08-25"*) — plus audio-quality audits, transcripts flagged for sung/spoken reliability, frame-level pitch data, and embeddings.
2. **A measurement method for archival intonation.** Per-track alignment of a pentatonic interval grid that absorbs key transposition, cassette speed error, and reference-pitch assumptions in a single fitted parameter (§5). On the development subset this turns an uninterpretable 63-cent fixed-grid smear into a coherent picture: Somali song concentrates 86% of its voiced frames within a quarter tone of a track-specific pentatonic grid.
3. **A diachronic test with a preliminary answer.** Because part of the corpus is date-stamped across the very years Western fixed-pitch instruments entered Somali ensembles, the corpus can ask — apparently for the first time for any Horn of Africa tradition — whether intonation regularized toward equal temperament. Preliminary result: no detectable drift (§6.3).
4. **Infrastructure.** An open, resumable pipeline (inventory → quality audit → enhancement → separation → transcription → pitch → embeddings → assembly) whose scientific core is dependency-free and unit-tested (151 tests), with honest, cassette-level evaluation splits — a design choice validated empirically by the embedding audit of §7.3.
5. **Two downstream stress tests with honest verdicts.** A controlled negative: LoRA adaptation of MusicGen-small on the corpus collapses held-out token loss at two learning rates and its generations inherit the tapes' noise floor rather than their melody (§7.5) — the generative face of §7.3's channel-leakage result. And a controlled positive: a pentatonic-aware transcription stage — the same per-track grid philosophy as §5, applied to note events — against which Western key correction is shown to alter 77% of notes and measurably damage scale conformity (§7.6).

We write "to our knowledge" deliberately throughout: Ethiopian music has labeled datasets [3] and classifiers whose corpora may incidentally contain Somali-adjacent material; our claim is that no *dedicated, labeled, documented* Somali music dataset exists, and we would welcome correction.

## 2. Related Work

**Corpora for under-represented traditions.** The CompMusic project [17, 18] set the template: Turkish makam [33], Carnatic/Hindustani (Saraga [31]), and Arab-Andalusian [32] corpora with culturally specific annotations. Recent dataset papers extend the model to Greek traditional music (Lyra [30]) and, closest to us geographically and methodologically, Ethiopian *kiñit* classification (EMIR: 600 expert-labeled recordings across four pentatonic modes) [3]. Our corpus differs in being *archival* rather than curated from modern recordings — its nearest structural relatives are the Erkomaishvili corpus of 1966 Georgian chant tapes [29] and the ORD-CC32 dataset of 1932 Cairo Congress recordings [37], both of which confront historical audio with modern MIR tooling.

**Tuning and scale measurement from audio.** Pitch-histogram analysis recovering culturally specific intervals goes back to Turkish makam work [2] and the Tarsos platform [19]; Moelants, Cornelis and Leman measured African tone scales from the Royal Museum for Central Africa archive and found systematic departures from 12-TET [13, 4]. Cross-culturally, DaMuSc [26] aggregates measured scales, and Phillips & Brown [27] estimate a universal vocal pitch-class imprecision of roughly 24 cents — a number our aligned-dispersion measurements land on almost exactly (§6.2). Recent African-repertoire work measures cents deviations on Ghanaian seperewa recordings [28]. Our contribution to this line is procedural: a per-track grid-alignment step that makes such measurements defensible on *cassette* sources, where playback-speed error otherwise masquerades as tuning (§5.2).

**Somali music scholarship.** Johnson documents the development of *heello* [8]; Andrzejewski & Lewis the poetic system it sets [1]; Abdullahi Qarshe's foundational role is recorded in his Bildhaan interview [7]. Kapteijns — writing *with Maryan Omar Ali herself* — analyzed the popular love songs of exactly the period this collection preserves [9, 10]. Jama Musse Jama's *Qaraami: The Fading Melody of Somali Classic Music* (2023) is the first book-length scholarly documentation of *qaraami* and contains the first published notations of five *qaraami* melodies [36] — evidence both of the tradition's minimal-notation history and of active Somali-led preservation that any external project must complement, not claim to replace.

**Models on low-resource and sung material.** Whisper [16] supports Somali with weak reported performance; Somali ASR research spans a 2006 Radio Hargeisa system [22] and modern low-resource work from a 1.57-hour seed corpus [34, 35]. Whisper-based lyric transcription is an active ISMIR topic [40, 41], with known hallucination behavior on singing that we gate explicitly (§4). CREPE [11] provides frame-level f0 with confidence; Demucs [6] and DeepFilterNet [12] serve the listening platform (deliberately *not* the tuning analysis — §4); MERT [21] provides embeddings, with recent evaluations of such foundation models on world-music corpora [39] motivating a MERT-probe baseline.

**Ethics of cultural datasets.** We operationalize the CARE principles [23] and the MIR-ethics literature [24] as concrete governance mechanisms (§8).

## 3. The Maryan Omar Ali Collection

**Provenance.** Maryan "Aryette" Omar Ali (born in Djibouti; schooled in Hargeisa; died 2011 in Toronto) collected Somali popular song across a lifetime spanning the Somali homelands and diaspora. Her collaboration with Lidwien Kapteijns produced the reference scholarship on Somali popular love songs [9, 10]; her tapes became Harvard's **AWM Spec Coll 103** — *Somali Songs, 1955–1991: The Maryan "Aryette" Omar Ali Collection* — 504 audiocassettes at the Archive of World Music, Eda Kuhn Loeb Music Library [15]. Harvard digitized the collection and published a track-level finding aid (974 entries) under CC BY 4.0; audio streams for research listening.

**Contents.** Performers include Magool, Faduumo Qaasim, Sahra Axmed, Cumar Dhuule, Maxamed Suleebaan, Xasan Aadan Samatar, Hibo Maxamed, Dalays, and Faysal Cumar Mushteeg, with Radio Mogadishu and National Theatre ensembles. The material is twentieth-century, mass-mediated urban popular song — we use "Somali song" rather than "traditional music" advisedly — spanning voice-and-*kaban* settings through full arrangements with violin, organ, electric guitar, clarinet, and saxophone. (Radio ensembles included melodic instruments such as violin and flute from the 1950s; what changes across the period is the weight of fixed-pitch, equal-tempered instruments — the gradient behind §6.3's question.)

**What we recover from the catalog.** Catalog titles carry recoverable structure: side and track position (*"Side A. Track 1: Wisiisi (Longing)"*), performer attributions (*"Songs by Xasan Aadan Samatar"*), play provenance (*"Songs from the play Luul iyo Leyla"*), and embedded recording dates (*"Milgo, 1966-08-25"*). Our inventory stage parses these into typed columns, joins them to the audio by catalog row order (verified by title match), hashes every file for duplicate detection, and validates records against a published JSON Schema.

**Acquisition and its limits (stated plainly).** Audio was downloaded from Harvard's public research-streaming endpoints at the URLs listed in the CC BY 4.0 catalog export, rate-limited and without circumventing any access control, for research use by this project. 605 of 974 catalog entries were retrieved; the remainder failed at the source during the acquisition window. We do not redistribute audio: the released dataset consists of *metadata and derived annotations*, and we are pursuing a formal research-access understanding with Harvard Library for anything beyond that. Because 38% of catalog entries lack retrieved audio, corpus-scale claims are claims about the retrieved subset; we release the full inventory including unretrieved entries so the missingness is analyzable.

**Audio condition** *(dev subset, n = 105 tracks / 22.6 h / 31 cassettes)*. These are consumer-cassette transfers, several generations from any master. Frame-percentile SNR estimates: median 9.5 dB (10th–90th percentile 5.7–13.7); 100 of 105 tracks fall below a 15 dB threshold; 7 show measurable digital clipping. This defines the dataset's realistic role: not a hi-fi training corpus but a computational record of a tradition — and a robustness benchmark for MIR tools on the kind of audio real archives actually hold.

## 4. Dataset Construction

The pipeline is nine resumable stages (open source; every stage skips existing outputs, checkpoints a ledger, and logs with per-track correlation IDs). Development-subset processing runs on a single Apple-silicon workstation; the full-corpus run uses investigator-controlled cloud compute against the same code. No audio is sent to third-party inference APIs.

1. **Inventory.** Filename/catalog parsing, SHA-1 duplicate detection, date recovery → `harvard_inventory.csv`.
2. **Quality audit.** Peak/RMS, percentile-frame SNR, clipping fraction, silence bounds; low-SNR tracks are *flagged, never dropped*.
3. **Enhancement** (DeepFilterNet [12]) and **4. Separation** (Demucs [6]) — for the listening platform and transcription front-end only. Both are Western-trained models with unquantified artifact behavior on this material; the tuning analysis therefore runs on **unprocessed transfers** so that no enhancement or separation model sits upstream of the paper's empirical claims.
5. **Normalization.** −23 LUFS (EBU R128 [25]) with an 80 Hz high-pass, for playback copies.
6. **Transcription.** Whisper large-v3 [16], Somali, transcribe + translate, word timestamps. A sung/spoken gate built on compression-ratio, log-probability, and no-speech statistics flags sung segments, whose text is stored but marked *unreliable* — never treated as lyric ground truth [40, 41].
7. **Pitch.** torchcrepe (the CREPE architecture [11] in PyTorch), 10 ms steps, weighted-argmax decoding with 3-frame median smoothing, confidence gate 0.80, on a centered excerpt of up to 6 minutes per track. Capacity is `tiny` for the corpus sweep, validated against `full` on a held-out subset (§7.2); the octave-folded pitch-class analysis (§5) is invariant to the octave errors Viterbi decoding exists to prevent, which is what makes the fast decoder admissible. The gate retains a median 19% of frames *(dev subset)* — a selection toward loud, sustained, periodic material that we report rather than hide: ornaments and transitions are under-sampled by construction, so ornament statistics are exploratory only.
8. **Embeddings.** MERT-v1-95M [21], window-averaged, L2-normalized, for similarity search and probe baselines.
9. **Assembly.** One schema-validated record per track; exports as JSON, CSV, JSONL (HuggingFace format), and a path-free `lite` variant.

**Quality control.** The scale mathematics is a pure module with known-answer tests; the schema rejects impossible records (e.g. per-degree deviations beyond ±150 cents — the true bound for a pentatonic grid with 300-cent gaps); train/validation splits hash the **cassette**, not the track, because tracks dubbed on one tape share deck, speed error, and noise floor — a track-level split would leak recording conditions (a leakage §7.3 quantifies: 66% of nearest embedding neighbours are same-cassette, vs 5% chance). All 133 tests pass in CI without ML dependencies.

## 5. Measuring Intonation in Archival Cassette Audio

### 5.1 The problem with a fixed reference

The naïve method — snap every detected pitch to the nearest degree of a fixed reference table and report deviations — fails three ways on this corpus, and the failures are instructive. First, a fixed table written in Hz *is* an equal-temperament grid in a specific key (ours was seeded as D-rooted major-pentatonic: D4/E4/F♯4/A4/B4), so songs performed in any other key contribute key distance, not intonation. Second, cassette playback-speed error shifts every pitch on a tape by a constant cents offset that a fixed-grid statistic absorbs one-for-one — a quarter-tone of "microtonality" is one badly calibrated tape deck (~3% speed). Third, absolute references presume A440 concert pitch that 1960s Mogadishu radio ensembles had no reason to observe. Empirically the smear is total: against the fixed grid, the development subset shows a mean absolute deviation of 63 cents with 57% of frames beyond a quarter tone — indistinguishable from noise (Fig. 1).

*Figure 1 — `figures/fig1_cents_histograms.png`: per-degree deviation histograms against the fixed grid: the smear that motivates per-track alignment.*

### 5.2 Per-track grid alignment

We therefore fit, per track, the circular offset δ ∈ [0, 1200) cents that best aligns the anhemitonic-pentatonic interval pattern {0, 200, 400, 700, 900} to the track's octave-folded pitch-class histogram (1-cent bins, triangular smoothing, exhaustive search — one parameter per track, fitted on thousands of frames). δ jointly absorbs key, tape speed, and reference pitch; what remains — the deviation of each frame from its nearest *aligned* degree — is the track's interval structure relative to equal temperament, which is the quantity of scholarly interest. Octave folding also makes the statistic invariant to the octave errors of fast pitch decoding. One honest caveat: the fit identifies the pattern's *position*, not which degree is the tonic; the five modal rotations of the pentatonic pattern are correlated, so cross-track *degree labels* carry mode ambiguity. All headline statistics are therefore rotation-invariant track-level dispersions; per-degree tuning profiles await stem-separated, expert-verified analysis on the full corpus.

### 5.3 What the alignment finds *(dev subset, n = 105 tracks, 706,483 gated frames)*

After alignment, the picture inverts: median per-track dispersion (mean |deviation| from the fitted grid) is **25.8 cents** (10th–90th percentile 18.7–34.0), with a median **86%** of frames within a quarter tone of the fitted grid (Fig. 2). Two readings: (i) the anhemitonic-pentatonic model is a good description of this repertoire — a five-degree grid accounts for the large majority of sustained pitch material; (ii) the dispersion that remains sits within two cents of the ~24-cent universal vocal pitch-class imprecision that Phillips & Brown estimate across 418 traditions [27], and above the ~14 cents measured instrumentally on Ghanaian seperewa recordings [28] — consistent with a heterophonic, voice-led ensemble measured through cassette wow and flutter. Distinguishing systematic microtonal structure *within* that band from performance and medium noise is precisely what the stem-separated full-corpus analysis is designed to answer.

*Figure 2 — `figures/fig2_aligned_histogram.png`: pooled deviation after per-track alignment; the concentration, against Fig. 1's smear, is the method's visual argument.*

## 6. The Diachronic Question: Did Equal Temperament Pull?

### 6.1 Why this corpus can ask it

Fixed-pitch, equal-tempered instruments (organ; fretted electric guitar) entered Somali ensembles during exactly the years this collection documents, and a subset of catalog titles carries exact recording dates. If exposure to equal-tempered anchors regularized ensemble intonation, tracks recorded later should show *tighter* dispersion around the fitted grid.

### 6.2 Design (pre-registered before full-corpus analysis)

Unit of analysis: the track (frames are autocorrelated; frame-level tests would pseudo-replicate). Statistic: per-track mean |aligned deviation| — invariant to key, tape speed, and mode-rotation ambiguity, so an era difference cannot be manufactured by tape decks or transposition. Sample: **date-stamped tracks only** — never instrumentation-predicted eras, which would be circular for an instrumentation hypothesis. Test: Mann–Whitney U, two-sided, split at 1970.

### 6.3 Preliminary result: stability, not drift

On the development subset's dated tracks — 13 early (1964–1969) vs 6 late (1973–1976) — median dispersion is 25.7 vs 26.8 cents; Mann–Whitney U = 30.0, **p = 0.47** (Fig. 3). With this n the test is powered only for large effects, so the honest statement is: *no evidence of intonational Westernization across 1964–1976 in this subset, against a design that would have detected a substantial contraction*. The full corpus multiplies the dated sample and extends both tails (1955–1991); either outcome will be informative — drift would quantify Westernization of intonation within one generation; confirmed stability would show a tradition's interval structure surviving its instrumentation.

*Figure 3 — `figures/fig3_era_comparison.png`: per-track dispersions by era, every track visible; group medians marked.*

### 6.4 What we deliberately do not claim

Ornament statistics (glissando/vibrato/grace-note event counts from thresholded f0 trajectories) are computed and released with the dataset, but the confidence gate's selection bias and f0 fragmentation on a fast decoder make event *counts* unreliable (the dev subset's nominal grace-note rate of ~9 events/s is transparently a fragmentation artifact). We release the thresholds as code constants and the counts as exploratory fields, and defer ornament claims until expert-annotated ground truth exists. Per-degree microtonal profiles ("is *mi* sung flat?") are likewise deferred to the stem-separated full-corpus analysis: they require mode disambiguation that dispersion statistics do not.

## 7. Baselines and Validation

### 7.1 Defined protocols

The dataset ships with evaluation code (unit-tested WER, confusion-matrix metrics, MIREX-convention raw pitch accuracy) and two reference architectures: a 0.42 M-parameter mel-spectrogram CNN for genre and a 0.10 M-parameter raw-waveform CNN for scale-degree monitoring (real-time capable on-device; framed explicitly as a *distillation* of the pitch pipeline — its labels are machine-derived, so its evaluation measures agreement, not ground-truth accuracy, until expert-audited windows exist). Genre baselines await expert labels: we report no genre accuracy in this draft because no expert-verified genre annotation yet exists to train on, and we will not report numbers against labels we cannot defend. The strong baseline for both tasks will be MERT [21] + linear probe, following recent foundation-model evaluations on world-music corpora [39].

### 7.2 Pitch-backend validation

Because the corpus sweep uses the fast CREPE capacity, we ran both `tiny` and `full` capacities on a 5-track validation subset and compared per-degree deviation medians. Median agreement is **2.8 cents** — well inside the effects reported — but individual degrees on individual dense-mix tracks can diverge substantially (max 120 cents where the two capacities evidently track different predominant sources). This is precisely why the paper's headline statistics are track-level aligned dispersions pooled over many tracks, and why per-degree tuning claims are deferred to stem-separated analysis. The full validation report (`pitch_backend_validation.json`) and harness ship with the dataset; the check will be repeated at full-corpus scale for camera-ready.

### 7.3 Embedding-space audit *(dev subset)*

MERT-v1-95M embeddings for all 105 dev-subset tracks were audited *before* any retrieval feature or probe is claimed. k-means (k = 8) cluster assignments agree with **cassette identity** at ARI 0.34 (n = 104 tracks with cassette provenance) and with dated era at ARI 0.20 (n = 19); **66% of tracks' nearest cosine neighbours come from the same physical cassette**, against a 5.0% chance rate given cassette sizes — a 13× over-representation (median top-1 cosine 0.982; Fig. 4). Same-cassette tracks often share performer and ensemble, so this rate mixes genuine musical similarity with channel identity; distinguishing the two requires the expert labels of §7.1. But the practical lesson is already firm, and it is why §4's evaluation splits hash the cassette: on archival single-source audio, a track-level split hands any foundation-model probe the *recording channel* as a shortcut feature. To our knowledge this channel-leakage rate has not previously been quantified for cassette-era archival corpora; we propose same-cassette neighbour rate as a cheap, label-free audit that any archival dataset can report. Neighbour lists and cluster assignments ship with the dataset as exploratory fields.

*Figure 4 — `figures/fig4_embedding_map.png`: t-SNE of MERT embeddings, k-means clusters, date-stamped tracks outlined; generated by `scripts/analyze_embeddings.py`.*

### 7.4 Transcription

Whisper's Somali performance is among its weakest [16], and sung Somali is harder still; our contribution at this stage is the honest *protocol*: spoken/announcer segments and sung segments are evaluated separately against an expert-corrected subset, because a single blended WER would launder hallucination into an average. The corpus thereby doubles as a benchmark for low-resource sung-language ASR [34, 35, 40, 41].

### 7.5 Generative fine-tuning as a stress test: a controlled negative *(dev subset)*

If §7.3 shows the recording channel dominating *learned representations*, the natural next question is whether it also dominates *generative adaptation*. We fine-tuned MusicGen-small (300 M) [44] with LoRA [46] (r = 16, α = 32, dropout 0.05, on all decoder self- and cross-attention projections; 6.29 M trainable parameters), float32 on a single M1/16 GB laptop, on 9,174 fifteen-second clips (95 songs; 32 kHz mono, −14 LUFS) with delay-pattern EnCodec token targets [47] and captions synthesized from measured audio features plus catalog metadata only (genre is never guessed from audio). Splits are song-level by content hash (80/10/10 over 119 tracks); we note plainly that this is *weaker* than the cassette-level splits §4 mandates — but the leakage it permits can only *flatter* the fine-tune's held-out numbers, so the negative result below survives a fortiori.

**Result: held-out token cross-entropy never approaches the base model.** Base MusicGen-small scores 4.63 nats on validation clips and 4.84 on test; the fine-tune's best checkpoint reaches only 6.70 (val) / 6.75 (test) — the adapter jumps to ~6.8 by step 250 at peak lr 1e-4 and the cosine tail recovers barely 0.1 nat over the remaining 1,250 steps. A controlled rerun at peak lr 2e-5 isolates the cause: validation stays flat through step 100 (4.76) and then collapses to the *same* level (6.79) by step 250. Lower learning rate delays the collapse; it does not prevent it — the failure is structural to the data regime (95 songs, ~19 h, SNR median 9.5 dB), not a tuning artifact.

The Pentatonic Conformity Score explains *what* was learned instead. We define **PCS** as the duration-weighted fraction of voiced pitch falling within ±50 cents (a quarter tone) of a degree of the best-fitting anhemitonic-pentatonic set, computed per clip from CREPE-full f0 [11] after fitting a global tuning offset — the same per-track alignment philosophy as §5, at clip scale (median absolute tape offset on real test clips: 26 cents). Scored over 100 generations per model from identical held-out captions:

| group | n scored | PCS mean | voiced fraction |
|---|---|---|---|
| real corpus (test split) | 1,076 | 0.847 | 0.53 |
| base MusicGen-small | 87 | 0.878 | 0.48 |
| LoRA, best checkpoint | 95 | 0.984 | **0.20** |
| LoRA, final checkpoint | 99 | 0.962 | **0.18** |

All pairwise differences are significant (Mann–Whitney, p < 10⁻⁴; base vs. best LoRA p ≈ 3×10⁻¹²). Read jointly, the two columns are the finding: the fine-tune's near-perfect conformity applies to *half as much* trackable melody — its outputs drift toward the corpus's dominant statistical feature, the tape texture itself, and informal listening confirms the generations are noise-like. Note also that the real corpus is *not* a ceiling for PCS: vibrato, ornament, and portamento push real performance frames outside ±50 cents (0.847), so PCS must always be reported with voiced fraction, never alone. Caption tonic adherence is weak for every model (22–28% vs. 8.3% chance). The constructive levers this diagnosis implies — stem-separated or denoised training audio, and the full 605-track corpus — are future work (§9); we publish the negative because a clean method with a negative verdict is exactly what the "stress test" framing of this corpus promises.

### 7.6 Pentatonic-aware music transcription: the cost of Western key correction *(dev subset)*

Commercial and academic transcription stacks assume 12-TET Western tonality and "correct" detected notes toward a major/minor key. For a pentatonic tradition this is not neutral. We built a transcription pipeline — basic-pitch note events [45] (with sub-semitone pitch from its 1/3-semitone contour bins) → tonic and 5-degree set detected from the notes themselves (five modal rotations of the anhemitonic template, duration-weighted, after the per-clip tuning fit) → quantization that snaps only notes within a 50-cent tolerance to the detected degree and leaves the rest **unsnapped and marked**, with a per-note confidence — and ablated the middle stage over 1,073 test clips (3 skipped for having < 5 detected notes):

| condition | scale conformity | notes altered |
|---|---|---|
| (i) basic-pitch raw | 0.898 | — |
| (ii) + Western key correction (Krumhansl–Schmuckler, snap all) | **0.862** | **77.4%** |
| (iii) + pentatonic-aware quantization (ours) | 0.898 | 89.0% snapped; 11.0% preserved & marked |

Conformity is evaluated for all conditions against the scale detected from the *raw* notes, so the reference is common. Western key correction rewrites three quarters of the notes and still *lowers* conformity by 3.7 points — the estimated major/minor key explains this repertoire worse than its own pentatonic set, so "correction" moves notes onto wrong degrees. Our stage is conformity-neutral by construction; its contribution is notational: exact degree pitches for the 89% of notes that belong to the scale, and explicit preservation of the 11% that do not — a fraction consistent with §5.3's finding that ~14% of gated frames fall beyond a quarter tone of the aligned grid. (The independent frame-level estimate of §7.5's PCS on real test clips, 84.7% within ±50 cents, agrees with §5.3's 86% despite a different pitch tracker, granularity, and subset — a useful cross-validation of both pipelines.) **No ground-truth MIDI exists for this corpus**, so note-level F1 is not computable and we say so rather than construct a synthetic truth; conformity-with-reference is the reported metric, and expert-verified transcriptions are future work. The pipeline emits MusicXML and rendered notation with marked notes visually distinguished, and ships in the released code with a public upload-to-score API.

## 8. Ethics, Governance, Access

**Licensing, precisely.** Catalog metadata: CC BY 4.0 (Harvard Library). Our annotations (transcripts, pitch data, embeddings, quality audits, labels): CC BY-NC 4.0, attribution to the Foundation and the collection. Audio: not redistributed; research listening via Harvard Library, and bulk research access only through/with Harvard. We claim no commercial rights over the recordings, and no commercial use of the audio is contemplated or enabled by this release; benefit-sharing commitments below concern the Foundation's separate, consented *field-recording* program with living musicians, not the Harvard material.

**Community governance.** A Cultural Advisory Board (elder musicians, an ethnomusicologist, a legal advisor) reviews releases, aligned with the CARE principles [23, 24]. The enriched corpus — restorations, transcripts, translations, annotations — is offered without fee to Somali institutions, including the Redsea Cultural Foundation (Hargeysa Cultural Center), whose *qaraami* documentation this work is designed to complement [36].

**Positionality.** The project is led by a Somali-speaking engineer and oud student with community access in the Minneapolis diaspora; annotation quality claims will nonetheless rest on a documented multi-annotator protocol with named qualifications, not on any single person's authority.

**Non-flattening.** Deviation from 12-TET is treated as signal, never error; sung-text hallucinations are flagged, never laundered into "lyrics"; Somali orthography leads, with catalog romanizations preserved.

## 9. Conclusion and Future Work

SomaliMusicCorpus makes a musical tradition computationally legible for the first time we know of — from a collection assembled by a Somali woman collector and preserved at Harvard, through a pipeline whose scientific core is small, tested, and honest about what archival cassettes permit. The methodological contribution — per-track pentatonic-grid alignment — turns cassette audio from a confound into a measurement instrument, and the corpus's date-stamped spine lets it ask a question no other Horn-of-Africa resource can: what happened to intonation when equal temperament arrived? The preliminary answer, stability, is itself a statement about the tradition's tonal identity.

Next: (1) full 605-track processing and re-estimation of every number in this paper; (2) expert annotation — genre labels, transcript correction, intonation audit, and expert-verified transcriptions to give §7.6 a true F1 — under a documented multi-annotator protocol with Somali musicians; (3) stem-separated per-degree tuning profiles with mode disambiguation; (4) MERT-probe and fine-tuned Whisper baselines, and revisiting generative adaptation (§7.5) on stem-separated audio at full-corpus scale, where the channel-dominance diagnosis predicts the negative should soften; (5) consented field recordings with living masters as the calibration standard; (6) public release (annotations + code) with DOI, and a research-access pathway for audio with Harvard Library.

## 10. References

[1] Andrzejewski, B. W., & Lewis, I. M. (1964). *Somali Poetry: An Introduction.* Oxford: Clarendon Press.
[2] Bozkurt, B. (2008). An automatic pitch analysis method for Turkish maqam music. *Journal of New Music Research*, 37(1), 1–13.
[3] Retta, E. A., Sutcliffe, R., Almekhlafi, E., Enku, Y. K., Alemu, E., Gemechu, T. D., Berwo, M. A., Mhamed, M., & Feng, J. (2023). Kiñit classification in Ethiopian chants, Azmaris and modern music: A new dataset and CNN benchmark. *PLoS ONE*, 18(4), e0284560.
[4] Cornelis, O., Lesaffre, M., Moelants, D., & Leman, M. (2010). Access to ethnic music: Advances and perspectives in content-based music information retrieval. *Signal Processing*, 90(4), 1008–1031.
[5] Defferrard, M., Benzi, K., Vandergheynst, P., & Bresson, X. (2017). FMA: A dataset for music analysis. *Proc. ISMIR*.
[6] Rouard, S., Massa, F., & Défossez, A. (2023). Hybrid transformers for music source separation. *Proc. IEEE ICASSP*, 1–5.
[7] Hassan, M.-R. S. (2002). Interview with the late Abdullahi Qarshe (1994) at the residence of Obliqe Carton in Djibouti. *Bildhaan: An International Journal of Somali Studies*, 2, 65–83.
[8] Johnson, J. W. (1996). *"Heelloy": Modern Poetry and Songs of the Somali.* New ed. London: HAAN Publishing. (Orig. 1974, Indiana University.)
[9] Kapteijns, L., with Ali, M. O. (1999). *Women's Voices in a Man's World: Women and the Pastoral Tradition in Northern Somali Orature, c. 1899–1980.* Portsmouth, NH: Heinemann.
[10] Kapteijns, L., with Ali, M. O. (1996). Sittaat: Somali women's songs for the "Mothers of the Believers". In K. W. Harrow (Ed.), *The Marabout and the Muse: New Approaches to Islam in African Literature* (pp. 124–141). Portsmouth, NH: Heinemann.
[11] Kim, J. W., Salamon, J., Li, P., & Bello, J. P. (2018). CREPE: A convolutional representation for pitch estimation. *Proc. IEEE ICASSP*.
[12] Schröter, H., Escalante-B., A. N., Rosenkranz, T., & Maier, A. (2023). DeepFilterNet: Perceptually motivated real-time speech enhancement. *Proc. Interspeech*, 2008–2009.
[13] Moelants, D., Cornelis, O., & Leman, M. (2009). Exploring African tone scales. *Proc. ISMIR*, 489–494.
[14] Pratap, V., et al. (2024). Scaling speech technology to 1,000+ languages. *JMLR*, 25(97), 1–52.
[15] Harvard Library. *Somali Songs, 1955–1991: The Maryan "Aryette" Omar Ali Collection* (AWM Spec Coll 103; 504 sound cassettes). Archive of World Music, Eda Kuhn Loeb Music Library. Finding aid via HOLLIS for Archival Discovery.
[16] Radford, A., Kim, J. W., Xu, T., Brockman, G., McLeavey, C., & Sutskever, I. (2023). Robust speech recognition via large-scale weak supervision. *Proc. ICML*.
[17] Serra, X. (2011). A multicultural approach in music information research. *Proc. ISMIR*.
[18] Serra, X. (2014). Creating research corpora for the computational study of music: The case of the CompMusic project. *Proc. AES 53rd Int. Conf. on Semantic Audio*.
[19] Six, J., Cornelis, O., & Leman, M. (2013). Tarsos, a modular platform for precise pitch analysis of Western and non-Western music. *Journal of New Music Research*, 42(2), 113–129.
[20] Tzanetakis, G., & Cook, P. (2002). Musical genre classification of audio signals. *IEEE Trans. Speech and Audio Processing*, 10(5), 293–302.
[21] Li, Y., Yuan, R., Zhang, G., et al. (2024). MERT: Acoustic music understanding model with large-scale self-supervised training. *Proc. ICLR*.
[22] Nimaan, A., Nocéra, P., & Bonastre, J.-F. (2006). Automatic transcription of Somali language. *Proc. Interspeech — ICSLP*, Pittsburgh.
[23] Carroll, S. R., Garba, I., Figueroa-Rodríguez, O. L., et al. (2020). The CARE principles for Indigenous data governance. *Data Science Journal*, 19(1), 43.
[24] Holzapfel, A., Sturm, B. L., & Coeckelbergh, M. (2018). Ethical dimensions of music information retrieval technology. *Transactions of the ISMIR*, 1(1), 44–55.
[25] EBU (2020). *R 128: Loudness normalisation and permitted maximum level of audio signals*; ITU-R BS.1770-4.
[26] McBride, J. M., Passmore, S., & Tlusty, T. (2023). Convergent evolution in a large cross-cultural database of musical scales. *PLoS ONE*, 18(12), e0284851.
[27] Phillips, E., & Brown, S. (2022). Vocal imprecision as a universal constraint on the structure of musical scales. *Scientific Reports*, 12, 19820.
[28] Walls, K. L., Roman, I. R., Van Ert, K., Harper, C., & Adu-Gilmore, L. (2024). Analyzing pitch content in traditional Ghanaian seperewa songs. arXiv:2411.08234.
[29] Rosenzweig, S., Scherbaum, F., Shugliashvili, D., Arifi-Müller, V., & Müller, M. (2020). Erkomaishvili dataset: A curated corpus of traditional Georgian vocal music for computational musicology. *Transactions of the ISMIR*, 3(1), 31–41.
[30] Papaioannou, C., Valiantzas, I., Giannakopoulos, T., Kaliakatsos-Papakostas, M., & Potamianos, A. (2022). A dataset for Greek traditional and folk music: Lyra. *Proc. ISMIR*.
[31] Srinivasamurthy, A., Gulati, S., Caro Repetto, R., & Serra, X. (2021). Saraga: Open datasets for research on Indian art music. *Empirical Musicology Review*, 16(1).
[32] Caro Repetto, R., Pretto, N., Chaachoo, A., Bozkurt, B., & Serra, X. (2018). An open corpus for the computational research of Arab-Andalusian music. *Proc. DLfM*.
[33] Uyar, B., Atlı, H. S., Şentürk, S., Bozkurt, B., & Serra, X. (2014). A corpus for computational research of Turkish makam music. *Proc. DLfM*.
[34] Menon, R., Biswas, A., Saeb, A., Quinn, J., & Niesler, T. (2018). Automatic speech recognition for humanitarian applications in Somali. *Proc. SLTU*.
[35] Biswas, A., Menon, R., van der Westhuizen, E., & Niesler, T. (2019). Improved low-resource Somali speech recognition by semi-supervised acoustic and language model training. *Proc. Interspeech*.
[36] Jama, J. M. (2023). *Qaraami: The Fading Melody of Somali Classic Music.* Pisa: Ponte Invisibile / Hargeysa: Redsea Cultural Foundation.
[37] Bozkurt, B. (2025). An open research dataset of the 1932 Cairo Congress of Arab Music (ORD-CC32). arXiv:2506.14503.
[38] Carter-Enyi, A., Rabinovitch, G., & Condit-Schultz, N. (2021). Visualizing intertextual form with arc diagrams. *Proc. ISMIR*.
[39] Papaioannou, C., Benetos, E., & Potamianos, A. (2025). Universal music representations? Evaluating foundation models on world music corpora. *Proc. ISMIR*.
[40] Zhuo, L., Yuan, R., Pan, J., et al. (2023). LyricWhiz: Robust multilingual zero-shot lyrics transcription by whispering to ChatGPT. *Proc. ISMIR*.
[41] Cífka, O., Schreiber, H., Miner, L., & Stöter, F.-R. (2024). Lyrics transcription for humans: A readability-aware benchmark. *Proc. ISMIR*.
[42] Badel, A., Zhong, T., Tai, W., & Zhou, F. (2023). Somali information retrieval corpus: Bridging the gap between query translation and dedicated language resources. *Proc. EMNLP (Findings)*.
[43] Baba Ali, B., Gorgan Mohammadi, A., & Faraji Dizaji, A. (2019). Nava: A Persian traditional music database for the dastgah and instrument recognition tasks. *Advanced Signal Processing*, 3(2), 125–134.
[44] Copet, J., Kreuk, F., Gat, I., Remez, T., Kant, D., Synnaeve, G., Adi, Y., & Défossez, A. (2023). Simple and controllable music generation. *Proc. NeurIPS 36*.
[45] Bittner, R. M., Bosch, J. J., Rubinstein, D., Meseguer-Brocal, G., & Ewert, S. (2022). A lightweight instrument-agnostic model for polyphonic note transcription and multipitch estimation. *Proc. IEEE ICASSP*.
[46] Hu, E. J., Shen, Y., Wallis, P., Allen-Zhu, Z., Li, Y., Wang, S., Wang, L., & Chen, W. (2022). LoRA: Low-rank adaptation of large language models. *Proc. ICLR*.
[47] Défossez, A., Copet, J., Kreuk, F., & Adi, Y. (2023). High fidelity neural audio compression. *Transactions on Machine Learning Research*.

---

### Reproducibility appendix

- **Code:** `apps/ai-service/scripts/process_harvard.py` (pipeline), `scripts/analyze_corpus.py` (every number and figure in §§3–6), `scripts/analyze_embeddings.py` (§7.3 audit and Fig. 4), `scripts/validate_pitch_backend.py` (tiny-vs-full check), `scripts/train_somali_model.py` (reference models, cassette-hashed splits), `evaluation/evaluate_model.py` (metrics), `data/schema/dataset_schema.json` (record contract). §7.5: `scripts/build_manifest.py` (audited manifest), `scripts/phase1_preprocess.py` + `phase1_tokens.py` (clips, captions, EnCodec tokens), `scripts/phase2_train.py` (LoRA runs; full hyperparameters and git commit in `runs/*/config.json`, loss curves in `runs/*/loss.csv`), `scripts/pcs.py` + `phase3_pcs_run.py` + `phase3_generate.py` + `phase3_token_loss.py` (PCS and CE tables), per-clip results in `data/eval_pcs/`. §7.6: `scripts/pentatonic.py` (5-rotation template), `scripts/quantize.py` (quantization stages), `scripts/transcribe.py` (basic-pitch → MusicXML/SVG), `scripts/phase4_ablation.py` (Table in §7.6; per-clip rows in `data/transcriptions/ablation.csv`). 151 unit tests.
- **Analysis constants:** pitch step 10 ms; confidence gate 0.80; excerpt ≤ 360 s centered; alignment kernel half-width 20 cents; minimum 300 gated frames per fit; era split 1970. §§7.5–7.6: PCS tolerance ±50 cents; CREPE-full, 20 ms hop, periodicity gate 0.50, minimum 1 s voiced; quantization tolerance 50 cents; clip length 15 s, 50% overlap, quiet-segment drop at 20 dB below file median. All in code, none hand-tuned per result.
- **Figures** are generated by `analyze_corpus.py` from the same JSON the text cites; no hand-edited numbers exist anywhere in the chain.
- **Bibliographic verification:** every reference above was verified against publisher/indexer records.
