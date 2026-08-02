# Publication & Funding Plan — SomaliMusicCorpus

*Written 2026-07-12. Companion to `ISMIR_PAPER_DRAFT.md` (v2.1) and `PROFESSOR_BRIEF.md`.*

## 1. Honest verdict: is the paper publishable?

**Yes — at specific levels, on a specific timeline. Not yet at its target level as-is.**

**Publishable now (August–September 2026):** as an arXiv preprint, an ISMIR Late-Breaking/Demo
(4 pages, non-archival), or an ICASSP method paper. The method contribution (per-track
pentatonic grid alignment on cassette sources) and the new channel-leakage audit
(§7.3: same-cassette nearest-neighbour rate 66% vs 5% chance) are real, novel,
reproducible findings that stand on the 105-track dev subset.

**Not yet publishable as the full ISMIR/TISMIR dataset paper**, for one dominant reason:
the corpus the title promises (605 tracks) has only been 17% processed. A dataset paper
is judged on the dataset. The full-corpus Colab run is the single blocking task — every
other gap is secondary to it.

**Class level, honestly stated.** With the full-corpus run and started expert annotation,
this is a competitive ISMIR dataset-track / TISMIR submission — the venue has published
exactly this shape of work (EMIR for Ethiopian kiñit, Lyra for Greek, Saraga for Indian
art music, and TISMIR published the Erkomaishvili 1966 Georgian tape corpus — the closest
structural relative). It is **not** a NeurIPS/ICML-class ML paper and should not be dressed
as one; its value is corpus + method + cultural coverage, which is precisely what
ISMIR/TISMIR/DLfM exist to publish. Strengths a reviewer will credit: first dedicated
Somali dataset in MIR (claim survived an adversarial 63-agent review; hedged correctly);
unusual reproducibility discipline (133 tests, every number regenerated from code —
verified again today); state-of-the-art ethics/governance section; honest negative-space
(deferred ornament and per-degree claims). Weaknesses a reviewer will probe: dev-subset
numbers; era test n = 19 (underpowered, correctly framed as preliminary); no expert labels
yet → no genre baselines; access model dependent on the Harvard relationship (annotations-only
release is accepted practice — Erkomaishvili and ORD-CC32 do the same — but a signed
research-access letter would de-risk review); single author with a foundation affiliation
(a second author — an ethnomusicologist, or outreach to Kapteijns — would materially help
both review odds and the work itself).

## 2. What changed today (all verified, all reproducible)

- Re-verified every quantitative claim in the draft against `data/analysis/corpus_analysis.json` — all match.
- Ran the embedding audit for the first time (`scripts/analyze_embeddings.py`):
  new **§7.3 + Figure 4**; k-means–cassette ARI 0.34; **same-cassette top-1 neighbour
  66.4% vs 5.0% chance (13×)**. Added `same_cassette_audit()` to the released script with
  known-answer unit tests so the paper's chain-of-custody discipline holds (now 133 tests).
- Resolved the last two references: [28] = arXiv:2411.08234 (draft had a wrong 2403 prefix);
  [43] Nava = *Advanced Signal Processing* 3(2), 125–134, **2019** (draft said 2023).
  Zero unverified references remain.

## 3. Venue strategy (real dates, checked 2026-07-12)

| # | Venue | Deadline | Role |
|---|-------|----------|------|
| 1 | **arXiv (cs.SD)** | none — target **August 2026** | Citable preprint for PhD/grant applications. Post with dev-subset numbers clearly marked if the full run isn't done; replace with v2 when it is. |
| 2 | **ISMIR 2026 Late-Breaking/Demo** (Abu Dhabi, Nov 8–12) | call not yet posted; historically **Sept–Oct** | 4 pages, non-archival (doesn't burn the main-track submission). Puts the work in front of the exact community — including potential advisors — one month before PhD applications. Watch ismir2026.ismir.net. |
| 3 | **ICASSP 2027** (Toronto, May 2027) | **Sept 16, 2026** | The *method* paper: grid alignment + leakage audit on archival cassettes. "Under review at ICASSP" on a December application. |
| 4 | **TISMIR** (journal, rolling) | none — target **Oct–Nov 2026** | The dataset paper's natural journal home (published Erkomaishvili). Requires full-corpus numbers. |
| 5 | **ISMIR 2027 main track** | ~April 2027 | The definitive dataset paper, with expert labels; decision lands before PhD offers are decided on. |
| 6 | DLfM 2027 | ~Jan 2027 (2026 ed. passed) | Backup/companion for the archival-musicology audience (the makam and Arab-Andalusian corpora were DLfM papers). |

**Recommended play: 1 + 2 now, 3 if September bandwidth allows, 4 after the full run, 5 as the flagship.**
These are complementary, not redundant: LBD is non-archival, ICASSP takes the method slice,
TISMIR/ISMIR take the dataset.

## 4. Blocking work, in priority order

1. **Full 605-track corpus run** (Colab; the Drive-FUSE throttling fix is documented in
   memory/harvard-colab-run). Re-run `analyze_corpus.py` + `analyze_embeddings.py`, regenerate
   figures, swap every *(dev subset)* marker. Est. one focused week including reruns.
2. **LaTeX/PDF typesetting** (paper is markdown today; arXiv and every venue need PDF —
   ISMIR template for 2/5, IEEE for 3).
3. **DOI + release**: Zenodo deposit of annotations/schema/code, dataset card, so the paper
   can cite a resolvable artifact.
4. **Harvard research-access letter** (email the Archive of World Music; even an
   acknowledgment-in-progress strengthens §8).
5. **Expert annotation started** (genre labels, 2–3 named annotators): needed for venue 4/5,
   not for 1/2/3.
6. **A second author / advisor-collaborator**: ethnomusicologist or MIR faculty; also fixes
   the single-author review optics.

## 5. MIT PhD timeline (Fall 2027 entry; applications due ~Dec 15, 2026)

- **Aug:** arXiv preprint live. **Sept:** email potential advisors with `PROFESSOR_BRIEF.md`
  + preprint. **Oct–Nov:** LBD (if accepted) presented at ISMIR Abu Dhabi — the single best
  networking event in this field, one month before applications. **Dec:** application cites
  preprint + LBD + ICASSP-under-review + released dataset with DOI + the live archive platform.
- **Honest fit note:** MIT is not a major MIR hub. The strongest MIR groups are UPF-MTG
  (Barcelona — birthplace of CompMusic, the tradition this paper writes itself into), QMUL
  C4DM (London), NYU MARL, JKU Linz, and McGill/Montréal. At MIT the plausible homes are the
  Media Lab (music/HCI groups) and CSAIL audio — apply, but apply as a *portfolio* including
  the actual MIR powerhouses; an ISMIR-community paper is worth the most exactly where
  ISMIR people review admissions.

## 6. Grants (US, realistic for the Foundation)

The paper + DOI'd dataset is the credibility anchor; grants fund the *preservation program*,
not the paper. Candidates: **CLIR Recordings at Risk** (Mellon-funded, $10–50k, currently
between cycles — watch clir.org; fits the field-recording/digitization program);
**NEH Humanities Collections & Reference Resources** (institutional applicant required);
**IMLS National Leadership Grants** (tentative Nov 13, 2026); **ACLS Digital Justice**;
locally **Minnesota State Arts Board / MN Humanities Center / Knight Foundation (St. Paul)**.
Most require the Foundation to have (or fiscal-sponsor into) 501(c)(3) status — verify that
first; it gates everything institutional.
