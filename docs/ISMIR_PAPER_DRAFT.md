# SomaliMusicCorpus: The First Labeled Dataset of Traditional Somali Music for Music Information Retrieval

**Working draft — target venue: ISMIR.**
**Status:** collection secured, pipeline built and unit-tested, local subset inventoried; corpus-scale empirical numbers pending the full processing run. Placeholders marked `⟨…⟩` are to be filled from the finalised corpus before submission. This paper is the *dataset* paper for the Harvard corpus; `docs/ISMIR_DRAFT.md` is the companion *platform/method* draft — the two share the scale-mapping methodology (§6) but make different contributions.

Khalid Ibrahim
Somali Music Preservation Foundation, Minneapolis, MN, USA
`research@somalimusicarchive.com`

---

## Abstract

We present **SomaliMusicCorpus-HAR-v1**, the first labeled dataset of traditional Somali music for music information retrieval. The corpus derives from the Maryan "Aryette" Omar Ali Collection at Harvard University's Archive of World Music (AWM Spec Coll 103): 605 digitised cassette recordings spanning 1955–1991, documenting *heello*, *qaraami*, and praise-song repertoire performed by the era's leading artists — Magool, Faduumo Qaasim, Sahra Axmed, Cumar Dhuule, Maxamed Suleebaan and others — accompanied by *oud* (Somali *kaban*), organ, guitar, violin, clarinet, saxophone, and frame drums. Somali music is transmitted orally, has no written notation tradition, and to our knowledge is entirely absent from every public MIR corpus. We contribute (1) the annotated corpus, with structured metadata cross-referenced from the Harvard HOLLIS catalog including per-track recording dates recovered for a substantial subset; (2) an open, resumable processing pipeline — enhancement (DeepFilterNet), source separation (Demucs), lyric transcription (Whisper large-v3, Somali), pitch tracking (CREPE) mapped onto a Somali pentatonic reference with per-frame **microtonal deviation quantified in cents**, and MERT embeddings for similarity; (3) baseline models — a genre classifier (0.42 M parameters) and the first scale-degree classifier for any East African tradition (0.10 M parameters, real-time capable); and (4) an empirical characterisation of Somali pentatonic tuning, including a diachronic test of whether intonation drifted toward 12-tone equal temperament as Western instruments entered the ensembles after the mid-1960s. Mean per-degree deviations of ⟨μ_do…μ_la⟩ cents across ⟨M⟩ million voiced frames are reported. The dataset card, schema, and code are released under a community-governance model with the catalog metadata under CC BY 4.0.

## 1. Introduction

The overwhelming majority of the audio on which MIR systems are trained and evaluated is Western: commonly cited estimates put the Western share of large music-AI training corpora above 90%, and the canonical benchmark datasets — GTZAN [20], FMA [5] — contain no East African material at all. Somali music is an extreme case of this absence. It is not under-represented; as far as we can determine it is **unrepresented**: no public MIR dataset, benchmark, or pretrained model documents it.

This absence is compounding a preservation emergency. Somali music of the twentieth century — the *heello* popular song that carried nationalist politics in the 1950s, the *qaraami* love-song repertoire, the theatre songs of Mogadishu's playhouses — was an oral tradition captured almost exclusively on radio transcription discs and consumer cassettes. The Somali civil war destroyed much of Radio Mogadishu's archive; what survives is scattered across diaspora private collections on decaying tape. The performers who could re-record or authenticate this repertoire are elderly or gone. Each year of delay is measured in irrecoverable songs.

One collection changes what is computationally possible. Maryan "Aryette" Omar Ali (d. 2011), a Somali collector and scholar-collaborator, assembled over decades a private cassette library of Somali popular song, now held and digitised by Harvard University's Archive of World Music [15]. It is, to our knowledge, the largest institutionally preserved corpus of twentieth-century Somali music, and its catalog metadata is published under CC BY 4.0.

This paper makes four contributions:

1. **The corpus.** SomaliMusicCorpus-HAR-v1: 605 audio tracks (from 974 catalog entries) spanning 1955–1991, with structured per-track metadata — title, performers, cassette/side provenance, and, for a substantial subset, exact recording dates recovered from catalog titles (e.g. *"Milgo, 1966-08-25"*) — validated against a published JSON Schema.
2. **The pipeline.** An open, resumable, fully local processing chain (enhancement → separation → transcription → pitch → embeddings) whose scientific core (the scale mapping) is a pure, unit-tested module with no ML dependency.
3. **Baselines.** The first genre classifier for Somali music and the first scale-degree classifier for any East African tradition, with honest, track-split evaluation.
4. **An empirical finding.** The first corpus-scale measurement of Somali pentatonic intonation, including a test of *tuning drift*: did the arrival of equal-tempered instruments (organ, electric guitar) after the mid-1960s pull sung and *oud* intonation toward 12-TET? The collection's 36-year span makes this question answerable for the first time.

## 2. Related Work

**Computational study of non-Western tonal systems.** The CompMusic project [17, 18] established corpus-building and analysis methodology for art-music traditions outside the Western canon. Pitch-histogram analysis of Turkish makam [2, 3] demonstrated that stable, culturally specific intervals diverging from 12-TET can be recovered from recordings. Most directly relevant, Moelants, Cornelis and Leman analysed tone scales in Central African recordings from the Royal Museum for Central Africa and found systematic departures from equal temperament [13, 4], and the Tarsos platform [19] operationalised precise pitch analysis for ethnic musics. Our work extends this line to a tradition with no prior computational baseline, and adds a *diachronic* dimension rarely available: a dated corpus straddling the arrival of Western instruments.

**African music in MIR datasets.** Existing African-music resources are few and concentrated on West and Central Africa (e.g. RMCA archive studies [4, 13]). Surveys of ethnic-music MIR [4] note that access, provenance, and annotation — not audio scarcity — are the binding constraints. The Horn of Africa is essentially blank. SomaliMusicCorpus-HAR-v1 is, to our knowledge, the first labeled Somali entry in this literature.

**Somali music scholarship.** The *heello* genre's development from work-song and *belwo* roots is documented by Johnson [8]; Somali oral poetics by Andrzejewski and Lewis [1]. Abdullahi Qarshe, "the father of Somali music," seeded the modern urban repertoire in the 1940s–50s [7]. Kapteijns — working *with Maryan Omar Ali herself* — analysed the popular love songs of exactly the period this collection preserves [9, 10]; our dataset is in a precise sense the audio companion to that scholarship. None of this literature has previously had machine-readable audio annotations to work against.

**Models.** We build on Whisper [16] for multilingual ASR (with known caution for low-resource languages and sung material; cf. massively multilingual speech work [14] and early Somali ASR [22]), CREPE [11] for frame-level f0 with confidence, Demucs [6] for vocal/accompaniment separation, DeepFilterNet [12] for enhancement of noisy tape transfers, and MERT [21] for self-supervised music representations. Dataset ethics and governance draw on the CARE principles [23] and the MIR-ethics literature [24].

## 3. The Maryan Omar Ali Collection

**Provenance.** Maryan "Aryette" Omar Ali collected Somali popular music from the 1950s onward, in Somalia and in diaspora. Her collaboration with historian Lidwien Kapteijns produced the standard scholarly treatment of Somali popular love songs [9]; her tapes went to Harvard's Archive of World Music, Loeb Music Library, as **AWM Spec Coll 103: Somali Songs, 1955–1991** [15]. Harvard digitised the cassettes and published finding-aid metadata under CC BY 4.0; audio is served for research listening.

**Contents.** The HOLLIS finding aid enumerates 974 track-level entries organised by cassette and side. Our audio acquisition (institution-friendly, rate-limited) retrieved 605 tracks. Performers include Magool, Faduumo Qaasim, Sahra Axmed, Cumar Dhuule, Maxamed Suleebaan, Xasan Aadan Samatar, Hibo Maxamed, Dalays, Faysal Cumar Mushteeg, and ensembles of Radio Mogadishu and the National Theatre; genres are dominated by *heello* and *qaraami*, with theatre songs and praise songs. Instrumentation moves from voice + *oud* (+ frame drum) in early material to organ, electric guitar, violin, clarinet and saxophone in later material — the instrumentation gradient that powers the era analysis of §6.3.

**What the catalog encodes (and what we recover).** Catalog titles carry structure beyond a name: side and track position (*"Side A. Track 1: Wisiisi (Longing)"*), performer attributions (*"Songs by Xasan Aadan Samatar"*), play provenance (*"Songs from the play Luul iyo Leyla"*), and — critically — embedded recording dates (*"Milgo, 1966-08-25"*). Our inventory stage parses all of these into typed columns. On the local development subset (105 tracks, 22.6 hours; median track 8.7 min across 31 cassettes), 18% of tracks carry an exact recording date (1964–1976 in that subset); the full-corpus fraction is ⟨…⟩. Tracks without explicit dates are bounded by the collection span and assigned era strata by the instrumentation classifier (§7.3).

**Audio condition.** These are consumer-cassette transfers of radio and stage material, several generations from any master. Our quality audit estimates signal-to-noise ratios of roughly 7–13 dB on sampled tracks (frame-percentile method) with negligible digital clipping. This motivates the enhancement and separation stages, and it defines the dataset's realistic role: not a hi-fi training corpus, but the *only* extant computational record of a tradition — and a stress test for MIR robustness on archival material.

## 4. Dataset Construction

The pipeline (open source, `apps/ai-service` of the platform repository) is nine resumable stages; every stage skips existing outputs, checkpoints a progress ledger after every ten tracks, and logs with per-track correlation ids. All processing is local; no audio leaves the processing machine.

1. **Inventory (Phase A).** Filename parsing + HOLLIS catalog join (catalog row order is the join key, verified by title match), SHA-1 duplicate detection, ffprobe durations, recording-date extraction → `harvard_inventory.csv`.
2. **Quality audit (B1).** Per-track peak/RMS, percentile-frame SNR estimate, clipping fraction, leading/trailing silence; tracks under 15 dB SNR are *flagged*, never dropped.
3. **Enhancement (B2).** DeepFilterNet [12]; SNR logged before/after.
4. **Separation (B3).** Demucs `htdemucs_ft` two-stem [6]: `vocals.wav` (→ transcription) and `no_vocals.wav` — the *oud* and ensemble (→ pitch analysis).
5. **Normalisation (B4).** −23 LUFS (EBU R128 [25]) with an 80 Hz high-pass against cassette-transport rumble.
6. **Transcription (C).** Whisper large-v3 [16], Somali, transcribe + translate passes, word timestamps. Because Whisper hallucinates fluent text over melisma, a sung/spoken gate (compression-ratio, log-probability and no-speech statistics) flags sung segments; sung-segment "lyrics" are stored but marked unreliable, never treated as ground truth. Per-corpus vocabulary and recurring poetic formulae are aggregated separately.
7. **Pitch and scale (D).** CREPE full-capacity, Viterbi decoding, 10 ms steps, confidence gate 0.80, on the instrument stem. Each retained frame maps to the Somali pentatonic reference (§6) with signed cents deviation; note events are segmented and classified as glissando / vibrato / grace note / straight tone under published thresholds; per-track aggregates (dominant degrees, duration-weighted modal center, interval bigrams, ornament rates) are computed by pure, unit-tested functions.
8. **Embeddings (F).** MERT-v1-95M [21], layer-and-time averaged per 30 s window, track-averaged, L2-normalised, stored in `pgvector` for cosine retrieval.
9. **Assembly (G).** All artifacts merge into one master record per track, validated against a published JSON Schema (draft 2020-12); exports: full JSON, CSV, HuggingFace dataset, and a `_lite` variant without file paths for sharing.

**Quality control.** The scale-mapping core is dependency-free and unit-tested (30+ tests, including known-answer tests for cents arithmetic); the schema has adversarial tests (a deviation beyond ±100 cents — impossible under nearest-degree mapping — must *fail* validation); train/validation splits are deterministic per-track hashes so numbers cannot drift as the corpus grows; and every reported metric carries its example count.

## 5. Annotation Schema

Each record carries: identity and provenance (`track_id`, catalog URL, cassette/side, license); descriptive metadata (title, performers, recording date, era stratum); AI-derived fields (Somali and English transcripts with confidence and singing ratio, dominant scale degrees, modal center, tempo, per-degree mean cents deviation, ornament counts, detected instrumentation, embedding id); audit fields (SNR, clipping, silence); and artifact paths. Genre labels are two-tier: `genre_labeled` (expert-assigned; the training target) and `genre_predicted` (model output with confidence) are never conflated. The schema enumerates the label vocabularies — *heello*, *qaraami*, *dhaanto*, praise song — and the five scale degrees, so a malformed or out-of-vocabulary record is rejected at export time, not discovered by a downstream user.

## 6. The Somali Pentatonic Scale — Empirical Analysis

### 6.1 Reference and method

Somali melody is predominantly anhemitonic pentatonic. We seed a reference table from common *oud* tuning (D root):

| Degree | Ref. Hz | Nearest 12-TET |
|:------:|:-------:|:--------------:|
| do | 293.66 | D4 |
| re | 329.63 | E4 |
| mi | 369.99 | F♯4 |
| sol | 440.00 | A4 |
| la | 493.88 | B4 |

For every retained CREPE frame with frequency *f*, the nearest degree *n\** is assigned and the deviation computed as `cents(f) = 1200·log₂(f / f_{n*})`; 0 = on the reference, ±50 = a quarter tone. Crucially the reference is an *initial estimate, not an assertion*: octave-folded per-degree deviation distributions over the corpus re-estimate the tradition's actual intervals, so the method measures Somali tuning rather than grading it against a Western ruler. For per-degree aggregation we measure against the *fixed* degree under study (not the nearest-snap label), avoiding relabeling bias at degree boundaries.

### 6.2 Corpus-scale intonation

_To be computed on the full 605-track run:_ per-degree deviation histograms across ⟨M⟩ voiced frames (Figure 1); mean absolute deviation ⟨μ⟩ cents (σ = ⟨σ⟩); the largest systematic offset on ⟨degree⟩ at ⟨d⟩ cents. The hypothesis from Somali *oud* practice is that *mi* (the third degree) sits measurably flat of F♯ — a neutral-third tendency shared with several maqam-adjacent traditions; the corpus will confirm, refute, or refine this.

### 6.3 Tuning drift across eras (the diachronic finding)

We stratify tracks into **1955–1965** (voice + *oud*; early nationalist *heello*), **1966–1974** (golden age; fuller Radio Mogadishu arrangements), and **1975–1991** (organ/guitar-heavy late period), using recovered dates where present and instrumentation-based era prediction elsewhere (§7.3, with the classifier's error analysed as a sensitivity bound). The test: does the per-degree deviation distribution contract toward 0 cents (12-TET) as fixed-pitch equal-tempered instruments enter the ensemble? Result: ⟨early vs late per-degree means, effect sizes, significance⟩. Either outcome is a finding — drift quantifies Westernisation of intonation within one generation; stability demonstrates the tradition's tonal identity surviving instrumentation change.

### 6.4 Ornament profile

Note-event classification yields corpus rates of glissando, vibrato (4–8 Hz, ≥30 cents), grace notes (<50 ms) and straight tones per genre and era: ⟨table⟩. Melisma density interacts with the transcription baseline (§7.2): sung-flagged segments concentrate where ornament rates peak.

## 7. Baseline Results

All baselines use deterministic per-track splits (≈80/20), never window-level splits, so no cassette leaks across the boundary; every figure reports its n.

### 7.1 Genre classification

A 0.42 M-parameter CNN over 128-bin log-mel spectrograms (4 conv blocks, global average pooling, variable-length input), trained on expert labels over {heello, qaraami, dhaanto, praise_song} with pitch-shift (±2 st), time-stretch (0.85–1.15×) and noise augmentation. Accuracy ⟨…⟩% (macro-F1 ⟨…⟩) against a 4-class majority baseline of ⟨…⟩%; publishable threshold pre-registered at 75%. Confusion concentrates on ⟨heello↔qaraami⟩, consistent with the genres' shared ancestry [8].

### 7.2 Lyric transcription

Whisper large-v3 WER on spoken/announcer segments: ⟨…⟩; on sung segments: ⟨…⟩ (computed on an expert-corrected 50-track subset; WER implementation is unit-tested). We report these separately because sung-Somali ASR is presently unusable as lyric ground truth (§6.4) — publishing that number honestly is part of the dataset's value as a low-resource ASR benchmark.

### 7.3 Scale-degree classification and era prediction

The scale-degree model — 1-D CNN on raw 1 s windows at 16 kHz, **101,798 parameters**, real-time on-device — is trained on machine labels (windows where the CREPE modal degree holds ≥60% of voiced frames; ambiguous windows dropped, unvoiced modelled as an explicit sixth class) and evaluated against ⟨n⟩ expert-audited windows: accuracy ⟨…⟩%, raw pitch agreement within ±50 cents ⟨…⟩ (MIREX convention). Era prediction from instrumentation timbre (organ ⇒ post-1965; electric guitar ⇒ post-1970) reaches ⟨…⟩% against date-stamped tracks, and its confusion bounds the sensitivity analysis of §6.3.

### 7.4 Retrieval

MERT nearest-neighbour retrieval, expert-judged precision@6: ⟨…⟩. K-means (k=8) on track embeddings, t-SNE-visualised (Figure 3): clusters correspond to ⟨genre/era/artist⟩ at adjusted-Rand ⟨…⟩.

## 8. Ethical Considerations

**Provenance and license.** Catalog metadata: CC BY 4.0 (Harvard Library). Audio: digitised archival holdings used for research; the released dataset's audio-derived annotations (transcripts, pitch data, embeddings) are published, while raw audio redistribution follows the Archive's terms — the dataset card states exactly what a downloader receives.

**Community governance.** The corpus is stewarded under a Somali-community model consistent with the CARE principles [23]: a Cultural Advisory Board (elder musicians, an ethnomusicologist, a legal advisor) reviews publication and any commercial use; licensing value accrues to the community and contributing artists' estates, not to a platform intermediary.

**Repatriation.** A standing commitment: the enriched corpus — audio restorations, transcripts, translations, annotations — is offered back to Somali institutions (national archives, universities, Radio Hargeysa/Radio Mogadishu successors) without fee, and the mobile platform makes it accessible to the diaspora community whose heritage it is.

**Non-flattening.** The microtonality method exists precisely so that Somali intonation is measured on its own terms; deviation from 12-TET is treated as signal, never error. Whisper's sung-text hallucinations are flagged, not laundered into "lyrics". Names and orthography follow Somali conventions with romanizations preserved from the catalog.

**Living artists and estates.** Where performers or their estates are identifiable, the governance process contacts them before any commercial licensing tier activates; the archive is soft-delete-only, so nothing is ever silently destroyed.

## 9. Conclusion and Future Work

SomaliMusicCorpus-HAR-v1 makes a musical tradition computationally legible for the first time, from a collection assembled by a Somali woman scholar and preserved at Harvard, processed by an open pipeline whose scientific core is small, pure, and tested. Beyond the corpus and baselines, the diachronic tuning-drift analysis turns a preservation archive into an instrument for answering a musicological question — what happens to an oral tradition's intonation when equal temperament arrives? — that no other dataset can address for the Horn of Africa.

Future work: (1) completing expert audit of machine labels and freezing the empirical numbers; (2) fine-tuning Whisper on the corrected sung-Somali transcripts; (3) multi-pitch analysis of dense heterophony (voice + *oud* simultaneously); (4) expanding beyond the Harvard collection with consented field recordings of living masters (the calibration standard for the scale reference); (5) per-region and per-artist tuning models; (6) HuggingFace release with a data-request tier for the audio-adjacent artifacts.

## 10. References

*(Working bibliography; entries marked ⟦verify⟧ need page/volume confirmation before camera-ready.)*

[1] Andrzejewski, B. W., & Lewis, I. M. (1964). *Somali Poetry: An Introduction.* Oxford: Clarendon Press.
[2] Bozkurt, B. (2008). An automatic pitch analysis method for Turkish maqam music. *Journal of New Music Research*, 37(1), 1–13.
[3] Bozkurt, B., Yarman, O., Karaosmanoğlu, M. K., & Akkoç, C. (2009). Weighing diverse theoretical models on Turkish maqam music against pitch measurements. *Journal of New Music Research*, 38(1), 45–70.
[4] Cornelis, O., Lesaffre, M., Moelants, D., & Leman, M. (2010). Access to ethnic music: Advances and perspectives in content-based music information retrieval. *Signal Processing*, 90(4), 1008–1031.
[5] Defferrard, M., Benzi, K., Vandergheynst, P., & Bresson, X. (2017). FMA: A dataset for music analysis. *Proc. ISMIR*.
[6] Rouard, S., Massa, F., & Défossez, A. (2023). Hybrid transformers for music source separation. *Proc. IEEE ICASSP*.
[7] Hassan, M.-R. S. (2008). Abdillahi Qarshe (1924–1997): The father of Somali music. *Bildhaan: An International Journal of Somali Studies*, 8. ⟦verify⟧
[8] Johnson, J. W. (1974). *Heellooy Heelleellooy: The Development of the Genre Heello in Modern Somali Poetry.* Bloomington: Indiana University Publications.
[9] Kapteijns, L., with Ali, M. O. (1999). *Women's Voices in a Man's World: Women and the Pastoral Tradition in Northern Somali Orature, c. 1899–1980.* Portsmouth, NH: Heinemann.
[10] Kapteijns, L., & Ali, M. O. (2001). Sittaat: Somali women's songs for the "Mothers of the Believers". In *Literature, Cinema and Society in the Horn of Africa*. ⟦verify⟧
[11] Kim, J. W., Salamon, J., Li, P., & Bello, J. P. (2018). CREPE: A convolutional representation for pitch estimation. *Proc. IEEE ICASSP*.
[12] Schröter, H., Escalante-B., A. N., Rosenkranz, T., & Maier, A. (2022). DeepFilterNet2: Towards real-time speech enhancement on embedded devices. *Proc. IWAENC*.
[13] Moelants, D., Cornelis, O., & Leman, M. (2009). Exploring African tone scales. *Proc. ISMIR*.
[14] Pratap, V., Tjandra, A., Shi, B., et al. (2024). Scaling speech technology to 1,000+ languages. *JMLR*, 25.
[15] Harvard Library. *Somali Songs, 1955–1991: The Maryan "Aryette" Omar Ali Collection* (AWM Spec Coll 103). Archive of World Music, Loeb Music Library. Finding aid, HOLLIS for Archival Discovery.
[16] Radford, A., Kim, J. W., Xu, T., Brockman, G., McLeavey, C., & Sutskever, I. (2023). Robust speech recognition via large-scale weak supervision. *Proc. ICML*.
[17] Serra, X. (2011). A multicultural approach in music information research. *Proc. ISMIR*.
[18] Serra, X. (2014). Creating research corpora for the computational study of music: The case of the CompMusic project. *Proc. AES 53rd Int. Conf. on Semantic Audio*.
[19] Six, J., Cornelis, O., & Leman, M. (2013). Tarsos, a modular platform for precise pitch analysis of Western and non-Western music. *Journal of New Music Research*, 42(2), 113–129.
[20] Tzanetakis, G., & Cook, P. (2002). Musical genre classification of audio signals. *IEEE Trans. Speech and Audio Processing*, 10(5), 293–302.
[21] Li, Y., Yuan, R., Zhang, G., et al. (2024). MERT: Acoustic music understanding model with large-scale self-supervised training. *Proc. ICLR*.
[22] Abdillahi, N., Nocera, P., & Bonastre, J.-F. (2006). Automatic transcription of Somali language. *Proc. Interspeech*. ⟦verify⟧
[23] Carroll, S. R., Garba, I., Figueroa-Rodríguez, O. L., et al. (2020). The CARE principles for Indigenous data governance. *Data Science Journal*, 19(1), 43.
[24] Holzapfel, A., Sturm, B. L., & Coeckelbergh, M. (2018). Ethical dimensions of music information retrieval technology. *Transactions of the ISMIR*, 1(1), 44–55.
[25] EBU. (2020). *R 128: Loudness normalisation and permitted maximum level of audio signals.* European Broadcasting Union; ITU-R BS.1770-4.
[26] van der Maaten, L., & Hinton, G. (2008). Visualizing data using t-SNE. *JMLR*, 9, 2579–2605.
[27] McFee, B., Raffel, C., Liang, D., et al. (2015). librosa: Audio and music signal analysis in Python. *Proc. SciPy*.

---

### Reproducibility appendix (to be finalised)

- Code: `apps/ai-service/scripts/process_harvard.py` (pipeline), `scripts/train_somali_model.py` (baselines), `evaluation/evaluate_model.py` (metrics; WER/RPA unit-tested), `data/schema/dataset_schema.json` (record contract).
- Determinism: per-track SHA-1 splits; fixed seeds; append-only label vocabularies.
- Figures: Fig. 1 per-degree cents histograms; Fig. 2 era-stratified deviation distributions; Fig. 3 t-SNE of MERT embeddings — all generated by the pipeline's reporting stage from the assembled dataset, no hand-edited numbers.
