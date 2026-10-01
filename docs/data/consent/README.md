# Consent records

This folder holds the index of written consent records for people whose
recordings the project trains on. Today it is empty on purpose: the one record
it is waiting for — **Ahmed Ilkacase's**, covering the session corpus in
`docs/DATA_PROVENANCE.md` §8 and the oud collection in §4 — has not been
written down yet. Nothing in this folder is a template to be signed, and no
entry here should ever read as if a record were signed when it is not.

## What goes here — and what never does

**The signed document itself never enters git.** This repository is public
(`origin` is a public GitHub repository), so a scanned PDF, a photographed
signature page, or any identity detail (ID number, phone number, postal
address, date of birth) committed here would be published to the world. The
original — paper or scan — stays in Khalid Ibrahim's private storage, off the
repository, and only its location and date are recorded here.

What is committed is one **text index entry** per person (or per rights
holder), in the "Index" section below, giving:

- the date the record was signed;
- who gave consent (by the name they chose to be credited under, see item 5
  below) and who received it;
- which inventory files it covers, by the names used in
  `docs/data/AHMED_CORPUS_INVENTORY.md` and `data/inventory/`;
- which of the uses listed in item 3 below were granted and which declined;
- who holds the original and where (a description such as "paper original,
  Khalid Ibrahim; scan in private storage", never a path to a shared drive).

## Index

No entries yet. The first will be Ahmed Ilkacase's (§4 oud collection and §8
session corpus of `docs/DATA_PROVENANCE.md`); until it is here, the consent
noted in §8 is the only record of it, and the project publishes nothing built
from the corpus.

| signed | who | covers | uses granted / declined | original held by |
| --- | --- | --- | --- | --- |

## What a record should state

Written in plain language, in the language the person prefers (Somali and/or
English), and read to them before signing if that is what they want:

1. **Who** is giving consent, and who is receiving it (Khalid Ibrahim, for the
   Somali Music AI Preservation Platform / QaraamiGen research programme).
2. **Which recordings**: the sessions and files by the names used in the
   inventory (`docs/data/AHMED_CORPUS_INVENTORY.md`, `data/inventory/ahmed_*.jsonl`,
   `data/inventory/oud_ilkacase.jsonl`), so the record and the corpus match
   one to one; and whether recordings added later are covered or need a new
   record.
3. **What the project may do**, each item said separately so any of them can
   be declined: analyse the recordings (transcription, pitch, embeddings);
   train models on them; evaluate those models; **publish the trained adapters
   (model weights)**; publish model outputs (generated audio) in papers, demos
   and on the website; quote short excerpts of the recordings in research
   writing or listening studies; keep the recordings on the project's machines
   for the life of the project.
4. **What the project may not do** — at minimum, the standing rule that the
   recordings themselves are never redistributed, sold, uploaded to a public
   service or served on the platform without a separate written agreement.
5. **Attribution**: whether the person wants to be named (the caption template
   currently says "performed by Ahmed Ilkacase" and the model cards would
   credit the performer), named under a chosen name, or not named.
6. **Other people on the recordings**: any other performer, and whether their
   consent is also being given or has to be obtained separately.
7. **Withdrawal**: that consent can be withdrawn for future use, what happens
   to already-published adapters and outputs in that case, and how to get in
   touch.
8. **Date and signatures** of both parties.

## Who adds it

Khalid Ibrahim, after the record is signed. Then:

- add the index entry above — text only: no scan, no image, no identity detail
  beyond the name the person chose to be credited under;
- update `docs/DATA_PROVENANCE.md` §4 and §8 with the date and where the
  original is held, and remove the "written consent record pending" wording
  there;
- if the record limits any of the uses in item 3, record the limits in the
  same sections and in the model cards of the adapters concerned.

## What this folder is not for

The Harvard Maryan "Aryette" Omar Ali Collection is a library holding, not a
personal consent matter; its rights and terms record is
`docs/data/HARVARD_TERMS.md` and the pending letter to the Loeb Music Library
is tracked in `docs/DATA_PROVENANCE.md` ("Outstanding items").
