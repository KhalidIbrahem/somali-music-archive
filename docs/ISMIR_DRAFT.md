# Quantifying Microtonality in Somali Pentatonic Song: An Open, Culturally‑Governed MIR Pipeline for an Absent Tradition

**Working draft — target venue: ISMIR (International Society for Music Information Retrieval).**
**Status:** methodology complete; empirical results pending corpus finalisation. Placeholders marked `⟨…⟩` are to be filled from the finalised corpus before submission.

Khalid Ibrahim
Somali Music Preservation Foundation, Minneapolis, MN, USA
`research@somalimusicarchive.com`

---

## Abstract

Somali traditional music — *heello*, *qaraami*, *buraanbur*, and other Qaraami Melodies is a living oral tradition with, to our knowledge, **no representation in any major music‑information‑retrieval (MIR) corpus or audio training dataset**. It is transmitted voice‑to‑voice, without notation, and its pitch organisation does not align cleanly with twelve‑tone equal temperament (12‑TET). We present (1) an open, provenance‑complete corpus of Somali traditional recordings with structured cultural metadata, and (2) an end‑to‑end MIR pipeline that transcribes lyrics (Whisper), extracts a monophonic pitch track (CREPE), maps each frame onto a Somali pentatonic reference and **quantifies its microtonal deviation from 12‑TET in cents**, and computes self‑supervised audio embeddings (MERT) for content‑based similarity search over a `pgvector` index. The scale‑mapping component is deliberately dependency‑free and unit‑tested, and its reference frequencies are refined empirically against a master performer's ear rather than assumed from Western theory. We report the pitch‑deviation distribution across the corpus, discuss the cultural‑governance model under which the data is collected and licensed, and describe a documented Research API through which the annotated corpus is made available to the ethnomusicology community. Our aim is both scientific — characterising a previously uncharacterised tonal system — and preservationist: making an endangered tradition legible to computation without flattening it into a Western frame.

---



## 1. Introduction

The overwhelming majority of music that MIR systems are trained and evaluated on is Western and equal‑tempered. Estimates commonly cited in the community put the Western share of large music‑AI training corpora above 90%. Whole tonal systems — Arabic *maqam*, Turkish *makam*, Indian *raga*, and many African oral traditions — are under‑represented or absent, and the tools built on 12‑TET assumptions systematically misdescribe them.

Somali music is an extreme case: it is not merely under‑represented but, as far as we can determine, **entirely absent** from public MIR datasets. This is a preservation emergency as much as a scientific gap. The tradition is oral; when a master performer dies, repertoire and performance practice can be lost irretrievably. Recordings from the mid‑twentieth‑century Radio Mogadishu era survive only on decaying tape and in private collections.

This paper makes three contributions:

1. **A corpus.** An open, consented, provenance‑documented collection of Somali traditional recordings annotated with genre, artist, poet, region, era, instrumentation, occasion, lyric transcript, and frame‑level pitch analysis.
2. **A microtonality method.** A transparent procedure for mapping detected pitch onto a Somali pentatonic reference and quantifying the per‑note deviation from equal temperament in cents — the paper's central MIR contribution.
3. **A platform and access model.** A reproducible pipeline plus a rate‑limited Research API and an explicit cultural‑governance framework, so that the corpus is usable by researchers while remaining accountable to the community it comes from.

We deliberately treat the Somali scale's reference pitches as *empirical unknowns to be measured*, not as constants inherited from Western theory. The reference table is seeded from the tuning of the *oud* (Somali *kaban*) and then refined against the performances of a master artist whose ear we take as ground truth.

## 2. Related Work

**Computational analysis of non‑Western tonal systems.** The CompMusic project [Serra 2011] established computational methodologies for art‑music traditions outside the Western canon, including Turkish *makam* and Carnatic music. Work on *makam* pitch histograms and tuning analysis [Bozkurt et al. 2009] demonstrated that stable, culturally specific intervals can be recovered from recordings and that they diverge measurably from 12‑TET. Our scale‑mapping method is in this lineage but targets a tradition — Somali pentatonic song — for which no computational baseline yet exists.

**Pitch estimation.** We use CREPE [Kim et al. 2018], a convolutional model that estimates fundamental frequency directly from the time‑domain signal and emits a per‑frame confidence, which we use for gating. For predominantly monophonic sung lines with *oud* accompaniment, frame‑level f0 with confidence is well suited to interval analysis.

**Speech/lyric transcription.** Whisper [Radford et al. 2023] provides multilingual robust ASR; we apply it to Somali‑language lyrics and additionally use its output as a signal in a lightweight *sung‑vs‑spoken* classification, because a hallucinated "transcript" over purely instrumental or heavily melismatic material would pollute a research corpus.

**Music audio representations.** MERT [Li et al. 2023] is a self‑supervised acoustic music model; we use MERT‑v1‑95M to produce fixed‑dimensional embeddings for content‑based retrieval. Approximate nearest‑neighbour search is served by `pgvector` over an IVFFlat cosine index.

**Ethnomusicology and ethics of data.** Our governance model draws on principles of community consent and benefit‑sharing that the ethnomusicology and Indigenous‑data communities have long advocated (e.g., the CARE principles for Indigenous data governance), operationalised here as documented per‑recording consent, soft‑delete‑only retention, and community review of publication.

## 3. The Corpus

**Scope.** Somali traditional genres: *heello*, *qaraami*, *dhaanto*, *buraanbur*, *gabay* (sung poetry), *jiifto*, and instrumental pieces. Sources range from mid‑century Radio Mogadishu transcriptions to contemporary field recordings.

**Size (current / target).** ⟨N_recordings⟩ recordings from ⟨N_artists⟩ artists, spanning ⟨earliest_year⟩–⟨latest_year⟩. A significant sub‑collection derives from the repertoire of Ahmed Ali Egal, a master performer whose recordings anchor the empirical calibration of the scale reference (§5.3).

**Capture quality.** Field capture targets 32‑bit float WAV at high sample rate; archival transcriptions are preserved at their native fidelity. Audio is never re‑encoded through the application tier and is stored under UUID keys, decoupled from the human‑readable catalogue id.

**Annotation schema.** Each recording carries: trilingual title (Somali source of truth), artist and (where known) poet, genre, occasion, region, decade ("era"), instrumentation (voice, *oud*/*kaban*, *shareero*, *durbaan*, …), content language, free‑text field notes, and the AI‑derived fields of §5 (lyric transcript, sung/spoken flag, frame‑level pitch with scale mapping, dominant scale degrees, voiced fraction, and a MERT embedding id).

**Provenance and licensing.** Every recording has documented capture context and an explicit license. Provenance is treated as a first‑class value driver: the corpus is designed to be *legally* usable for scholarship and, where the community consents, for licensing — with the community, not a platform, as the beneficiary.

## 4. System Architecture

The platform is a modular monolith serving a mobile application and a research surface, with a separate Python inference service. The relevant data flow for this paper is:

```
recording (R2 object) ─▶ inference service
                          ├─ Whisper large‑v3        ─▶ transcript, sung/spoken flag
                          ├─ CREPE                    ─▶ f0 frames (t, hz, confidence)
                          │     └─ Somali scale map   ─▶ note label + cents deviation
                          └─ MERT‑v1‑95M              ─▶ 768‑d embedding
                          ▼
                 annotation store (MongoDB metadata + Postgres/pgvector embeddings)
                          ▼
                 Research API  (API‑key auth, per‑key rate limiting, paginated export)
```

Stages are independent so that a failure or re‑run of one (e.g. re‑extracting pitch) does not clobber the results of another. The pitch/scale mathematics is isolated in a pure module with no ML dependencies, so the scientific core is unit‑tested in continuous integration without installing the heavy models.

## 5. Methodology



### 5.1 Lyric transcription and sung/spoken gating

We transcribe with Whisper large‑v3, retaining Somali source text and an English gloss. Because Whisper can hallucinate fluent text over non‑speech, we derive a boolean *is‑singing* signal and treat transcripts over predominantly instrumental material as unreliable, flagging rather than storing them as ground‑truth lyrics. This protects downstream lyric‑based analysis from spurious text.

### 5.2 Pitch extraction

CREPE produces frames `(t_i, f0_i, c_i)` where `c_i ∈ [0,1]` is a confidence. We drop frames with `c_i < τ` (confidence threshold `τ`, a tunable constant) and frames with non‑positive `f0`. The retained frames form the monophonic pitch track used for scale analysis. We additionally report a **voiced fraction** — the share of frames passing the gate — as a coarse descriptor of how sung (vs. instrumental/silent) a recording is.

### 5.3 Somali scale mapping and microtonal quantification (core contribution)

We maintain a reference table of Somali pentatonic scale degrees and their approximate frequencies, seeded from common *oud* tuning (D root):


| Degree | Ref. Hz | Nearest 12‑TET |
| ------ | ------- | -------------- |
| do     | 293.66  | D4             |
| re     | 329.63  | E4             |
| mi     | 369.99  | F♯4            |
| sol    | 440.00  | A4             |
| la     | 493.88  | B4             |


For each retained pitch frame with frequency `f`, we assign the nearest scale degree `n*` by absolute frequency distance and compute the **deviation in cents** from that degree's reference `f_{n*}`:

```
cents(f) = 1200 · log2( f / f_{n*} )
```

By construction, `0` cents is exactly on the reference pitch, `±50` cents is a quarter‑tone, and `±100` cents is a semitone. The per‑frame output is `(t, f, c, note_label, cents_deviation)`; aggregating over a recording yields the **dominant scale degrees** and a per‑degree deviation distribution.

**Empirical calibration.** Crucially, the reference frequencies are *not* asserted as ground truth. They are initial estimates to be **refined against the corpus**, using the recordings of a master performer as the calibration standard — his intonation is the reference against which "in tune" is defined for this tradition. As field data accumulates, the reference table is updated and the cents distributions recomputed; the method therefore *measures* the tradition's tuning rather than imposing a Western one. The quantity of scholarly interest is precisely the systematic, non‑zero deviation of sung pitch from 12‑TET.

### 5.4 Audio embeddings and similarity

We embed each recording with MERT‑v1‑95M into a 768‑dimensional vector, L2‑normalised so that cosine similarity reduces to a dot product. Vectors are stored in PostgreSQL via `pgvector` with an IVFFlat index under `vector_cosine_ops`. Nearest‑neighbour queries (`ORDER BY embedding <=> query`) surface timbrally/structurally similar recordings, filtered to the published subset so that unreviewed material never leaks through a similarity edge. This supports both a listener‑facing "similar recordings" feature and corpus‑level exploration (clustering by genre/era/region).

## 6. Preliminary Results

*All quantitative results below are placeholders to be computed on the finalised corpus.*

- **Pitch‑deviation distribution.** Across ⟨N⟩ recordings and ⟨M⟩ retained frames, the mean absolute deviation from 12‑TET is ⟨μ⟩ cents (σ = ⟨σ⟩). Per‑degree, we observe the largest systematic deviation on ⟨degree⟩ (⟨d⟩ cents), consistent with the tradition's treatment of that scale step as microtonally distinct from its Western neighbour. *(Figure 1: per‑degree cents histograms.)*
- **Voiced fraction by genre.** Sung genres (*heello*, *qaraami*) show voiced fractions of ⟨…⟩; instrumental pieces cluster near ⟨…⟩, validating the sung/spoken gate.
- **Retrieval.** Qualitative inspection of MERT nearest neighbours groups recordings by ⟨genre/era/artist⟩; a small expert‑judged evaluation yields precision@6 of ⟨…⟩. *(Table 2.)*

We emphasise that the **method and infrastructure are complete and reproducible today**; the empirical figures await corpus finalisation and expert annotation, which is the appropriate point at which to freeze numbers for a camera‑ready submission.

## 7. Cultural Governance and Ethics

A corpus of an endangered tradition is not neutral data. Our governance model is explicit:

- **Consent and provenance per recording.** No recording enters the published corpus without documented capture context and license.
- **Community as beneficiary.** The dataset is designed so that any licensing value accrues to the community and its performers, not to a platform intermediary.
- **Non‑destructive retention.** Recordings are soft‑deleted only; the archive is a permanent cultural record and never hard‑deletes material.
- **Editorial review before publication.** Material is moderated into a "published" state deliberately; unreviewed uploads are never exposed through listing, search, similarity, or export.
- **Legibility without flattening.** The microtonality method exists precisely to avoid describing Somali music as "out‑of‑tune Western music"; deviation from 12‑TET is treated as signal, not error.



## 8. Access: the Research API

The annotated corpus is exposed to external researchers through a documented HTTP API. Access is authenticated with issued API keys (stored only as salted hashes; the plaintext key is shown once), scoped to an *academic* or *commercial* tier, and rate‑limited per key. A paginated `dataset` endpoint returns the published corpus projected to a research view — cultural metadata plus the AI fields (transcripts, dominant scale degrees, voiced fraction), with the full frame‑level pitch track available opt‑in because of its size. This lets the ethnomusicology community reproduce and extend the analyses in §5 without direct access to the raw audio store.

## 9. Limitations and Future Work

- **Monophonic assumption.** CREPE targets a single f0; dense heterophonic textures (voice + *oud* + ensemble) are only partially captured. Multi‑pitch and source‑separated analysis is future work.
- **Reference calibration is ongoing.** The scale table is being empirically refined; reported deviations will shift as calibration completes, and per‑region/per‑era reference variation is expected and worth modelling explicitly.
- **Transcription quality for sung Somali.** Whisper is not tuned for melismatic sung Somali; a fine‑tuned or forced‑alignment approach is future work.
- **Corpus scale.** The corpus is growing; statistical claims will strengthen with size and with independent expert annotation of intonation.



## 10. Conclusion

We have described an open corpus and a reproducible MIR pipeline for Somali traditional music — a tradition previously absent from computational study — centred on a transparent method for quantifying its microtonal deviation from equal temperament. By treating the tradition's tuning as something to be *measured against a master performer's ear* rather than assumed, and by wrapping the corpus in explicit cultural governance and an accessible Research API, we aim to make Somali music both scientifically legible and durably preserved. We invite the MIR community to use, critique, and extend the corpus and method.

## Acknowledgements

To the performers and elders whose repertoire this work preserves, and in particular to Ahmed Ali Egal, whose intonation anchors the analysis.

## References (working bibliography — to be completed)

- Radford, A., Kim, J. W., Xu, T., Brockman, G., McLeavey, C., Sutskever, I. *Robust Speech Recognition via Large‑Scale Weak Supervision* (Whisper). 2023.
- Kim, J. W., Salamon, J., Li, P., Bello, J. P. *CREPE: A Convolutional Representation for Pitch Estimation.* ICASSP, 2018.
- Li, Y., et al. *MERT: Acoustic Music Understanding Model with Large‑Scale Self‑Supervised Training.* 2023.
- Serra, X. *A Multicultural Approach to Music Information Research* (CompMusic). ISMIR, 2011.
- Bozkurt, B., et al. *Pitch‑frequency histogram‑based music information retrieval for Turkish makam music.* 2009.
- Carroll, S. R., et al. *The CARE Principles for Indigenous Data Governance.* 2020.
- `pgvector`: open‑source vector similarity search for PostgreSQL.

---

*Draft prepared as SESSION P3‑08. To finalise: fill the ⟨…⟩ placeholders from the corpus, generate Figure 1 (per‑degree cents histograms) and Table 2 (retrieval evaluation) from the Research API export, and complete the bibliography with full ISMIR‑format citations.*