# Somali Music AI — Complete Dataset Strategy
## From Zero to Million-Dollar Dataset
### Author: Khalid Ibrahim | 2024

---

## THE REALITY OF YOUR DATASET'S VALUE

Before anything else, understand what you are building and why it is worth money.

The AI music market is $5.2 billion in 2024, growing to $60 billion by 2034.
Every major AI lab — Google DeepMind, Meta, OpenAI, Stability AI — is
desperately buying or licensing audio training data.

The problem: 94% of all music AI training data is Western.
Somali music has ZERO representation in any major dataset.

This means your dataset is not competing — it is the ONLY ONE.
That is not a niche. That is a monopoly on a data category.

A dataset of 500 clean, labeled, consented Somali traditional music recordings
is worth — conservatively — $500,000 to $2,000,000 in licensing value.
Here is exactly how to build it, protect it, and monetize it.

---

## PART 1 — WHAT MAKES A DATASET WORTH MILLIONS

### The four value drivers (in order of importance)

1. EXCLUSIVITY
   Does this data exist anywhere else? If no — you own a monopoly.
   Your Somali music recordings from Ahmed Ali Egal exist NOWHERE ELSE.
   That exclusivity is the primary source of value.

2. QUALITY
   Is the audio clean, high-resolution, free of noise?
   32-bit float WAV at 96kHz from a dedicated recorder
   in an acoustically treated room = research-grade quality.
   This is what separates a $50 dataset from a $500,000 dataset.

3. PROVENANCE
   Do you have documented proof of who recorded it, when, where,
   with whose consent, under what license?
   Provenance is what makes the dataset legally usable commercially.
   Without it, no serious AI company will touch it.
   This is where most datasets fail. Yours will not.

4. ANNOTATION (LABELS)
   Is every file labeled with structured metadata?
   Genre, artist, poet, region, era, instruments, occasion,
   pitch data, transcript, cultural context.
   A raw audio file is worth $0.001.
   A labeled, annotated audio file is worth $1.00–$10.00.
   500 files × $10 average = $5,000 minimum floor.
   1,000 files × $10 = $10,000.
   But a complete, exclusive, culturally governed Somali corpus
   at the dataset level (not per-file) licenses for $100k–$500k+.

---

## PART 2 — THE THREE LAYERS OF YOUR DATASET

### Layer 1 — Primary field recordings (the core)
What: Direct recordings of Ahmed Ali Egal and other elder musicians
Format: WAV 96kHz 32-bit float, separate tracks (voice + oud)
Volume: 50–100 hours of raw session audio
Processed into: 2,000–5,000 labeled clips of 10–30 seconds each
Who owns it: You + the Somali Music Foundation (non-profit)
License: CC BY-NC 4.0 for research / proprietary for commercial

This is the most valuable layer. It exists nowhere else on earth.

### Layer 2 — Augmented data (expand from your primary data)
What: AI-generated variations of your primary recordings for training
Technique: Pitch shifting (±2 semitones), time stretching (0.85x–1.15x),
           harmonic mixing, reverb augmentation, noise injection
Result: From 500 clips → 5,000 training examples
Purpose: AI models need volume. Augmentation multiplies your dataset
         without requiring more recording sessions.
Tool: Python + librosa + audiomentations library
Value: Augmented versions remain yours — they derived from your primary data.

### Layer 3 — Supplementary sources (add breadth)
What: Legally obtained existing Somali music recordings
Sources:
  - Radio Mogadishu archive (contact the Somali National TV)
  - BBC Somali Service archive (they recorded Somali music 1950s–1990s)
  - Smithsonian Folkways (they have some Horn of Africa recordings)
  - UCLA Ethnomusicology Archive (field recordings from Horn of Africa)
  - Library of Congress (some Somali recordings in ethnomusicology collection)
  - Community contributions from diaspora musicians (with consent)
Process: Contact each institution, request research access or licensing,
         re-annotate with your Somali-specific metadata schema
Value: Adds historical breadth and cross-validates your primary data

---

## PART 3 — THE LEGAL STRUCTURE (this is what makes it worth money)

### The consent chain — document everything

Every recording in your dataset must have a documented consent chain.
No gap. No assumption. No "I think he agreed."

The chain for your primary recordings:

Step 1 — Verbal consent recording
  Before every session: record Ahmed saying he agrees.
  File: 00_consent_YYYY-MM-DD.wav
  Keep forever. Never delete.

Step 2 — Written contributor agreement
  A one-page document in Somali and English.
  He signs it. You sign it. Two copies — one for him, one for you.
  What it says:
    - He grants the Somali Music Foundation a non-exclusive license
      to use, reproduce, and distribute his recordings for cultural
      preservation, education, and non-commercial research purposes.
    - He retains the right to be credited by name on every use.
    - He can withdraw consent at any time for future recordings
      (existing recordings remain in the archive).
    - He will receive [compensation structure — see Part 5].
    - The commercial licensing revenue share is [percentage].

Step 3 — Cultural Advisory Board approval
  Before any commercial licensing, the Board reviews and approves.
  Board composition: Ahmed Ali Egal, 2 other Somali elders,
  1 ethnomusicologist, 1 legal advisor.

Step 4 — License assignment to the Foundation
  The Foundation holds the master license.
  You as the director control commercial licensing decisions
  subject to Board approval for material uses.

### The three license tiers for your dataset

TIER 1 — Research (free / low cost)
  License: Creative Commons CC BY-NC 4.0
  Who gets it: University researchers, PhD students, academic labs
  Cost: Free (with registration and terms acceptance)
  Conditions: Must cite the dataset, cannot use commercially,
              must share derived research outputs publicly
  Why offer free: This generates citations, publications,
                  and academic credibility that make the dataset
                  MORE valuable for commercial licensing.

TIER 2 — Commercial research license
  License: Proprietary — annual license agreement
  Who gets it: AI companies doing R&D (not yet production)
  Cost: $5,000–$25,000/year depending on company size
  Conditions: Can train models with dataset, cannot redistribute
              the raw audio, must credit the Foundation
  Examples: Smaller AI music startups, university spinoffs

TIER 3 — Full commercial license
  License: Proprietary — negotiated deal
  Who gets it: Major AI labs (Google, Meta, Apple, Spotify, Amazon)
  Cost: $100,000–$500,000+ one-time or $50,000–$200,000/year
  Conditions: Fully negotiated — typically includes revenue share,
              attribution requirements, exclusivity windows,
              and Foundation governance rights over AI outputs
  This is the million-dollar scenario.

---

## PART 4 — DATASET STRUCTURE (technical)

### File naming — use this from day one, without exception

Primary audio files:
{YYYY-MM-DD}_{ArtistSlug}_{SessionID}_{TrackNum}_{Genre}_{TitleSlug}.wav

Examples:
2024-01-15_ahmed-ali-egal_S001_T01_heello_caasimada-jacaylka.wav
2024-01-15_ahmed-ali-egal_S001_T02_qaraami_jacaylka-dheer.wav
2024-01-15_ahmed-ali-egal_S001_T02_qaraami_jacaylka-dheer_VOICE.wav
2024-01-15_ahmed-ali-egal_S001_T02_qaraami_jacaylka-dheer_OUD.wav

Metadata files (one per audio file, same name, .json extension):
2024-01-15_ahmed-ali-egal_S001_T01_heello_caasimada-jacaylka.json

Consent files:
2024-01-15_ahmed-ali-egal_S001_consent.wav
2024-01-15_ahmed-ali-egal_S001_consent-form.pdf

### Master metadata schema (JSON)

{
  "id": "S001-T01",
  "recording_date": "2024-01-15",
  "session_id": "S001",
  "track_number": 1,

  "files": {
    "master_mix": "2024-01-15_ahmed-ali-egal_S001_T01_heello_caasimada.wav",
    "voice_track": "2024-01-15_ahmed-ali-egal_S001_T01_heello_caasimada_VOICE.wav",
    "oud_track":   "2024-01-15_ahmed-ali-egal_S001_T01_heello_caasimada_OUD.wav",
    "consent":     "2024-01-15_ahmed-ali-egal_S001_consent.wav"
  },

  "technical": {
    "format": "WAV",
    "sample_rate_hz": 96000,
    "bit_depth": "32-bit float",
    "channels": 2,
    "duration_sec": 247.3,
    "file_size_mb": 143.2,
    "recorder": "Zoom H4essential",
    "microphone_voice": "Shure SM7B",
    "microphone_oud": "Rode NT5",
    "acoustic_treatment": true
  },

  "cultural": {
    "title": {
      "somali": "Caasimadda Jacaylka",
      "transliteration": "Caasimadda Jacaylka",
      "english": "Capital of Love"
    },
    "artist": {
      "name": "Ahmed Ali Egal",
      "name_somali": "Axmed Cali Cigaal",
      "role": "singer + oud",
      "affiliation": "Waaberi Band",
      "affiliation_years": "1965-1991",
      "consent_on_file": true
    },
    "poet": {
      "name": "",
      "notes": "Ask Ahmed in next session"
    },
    "composer": {
      "name": "",
      "notes": "Ask Ahmed in next session"
    },
    "genre": "heello",
    "subgenre": null,
    "occasion": "love song",
    "instruments": ["voice", "oud"],
    "language": "so",
    "region_of_origin": "Mogadishu",
    "era_composed": "1970s",
    "era_style": "golden age"
  },

  "ai_generated": {
    "status": "pending",
    "whisper_transcript_somali": null,
    "whisper_transcript_english": null,
    "pitch_data_file": null,
    "spectrogram_file": null,
    "embedding_file": null,
    "genre_predicted": null,
    "quality_score": null,
    "processed_at": null
  },

  "annotation": {
    "annotator": "Khalid Ibrahim",
    "annotation_date": "2024-01-15",
    "annotation_method": "expert + automated",
    "confidence": "high",
    "notes": "He said this song was written for a famous love story in Mogadishu..."
  },

  "license": {
    "holder": "Somali Cultural Music Foundation",
    "type": "CC BY-NC 4.0 for research / proprietary for commercial",
    "consent_type": "verbal + written",
    "consent_date": "2024-01-15",
    "commercial_use": "requires Foundation approval",
    "attribution_required": "Ahmed Ali Egal / Somali Cultural Music Foundation"
  },

  "clips": []
}

### Clip schema (for ML training — derived from master recordings)

After processing, each master recording is sliced into 10–30 second clips.
Each clip gets its own entry in clips[]:

{
  "clip_id": "S001-T01-C001",
  "parent_recording_id": "S001-T01",
  "start_sec": 0.0,
  "end_sec": 15.0,
  "duration_sec": 15.0,
  "clip_file": "clips/S001-T01-C001.wav",
  "source_track": "voice",
  "contains_singing": true,
  "contains_oud": false,
  "contains_speech": false,
  "pitch_data": [
    {"time_sec": 0.010, "frequency_hz": 293.66, "note": "do", "cents_dev": 0.0},
    {"time_sec": 0.020, "frequency_hz": 296.12, "note": "do", "cents_dev": 14.4},
    ...
  ],
  "dominant_notes": ["do", "re", "sol"],
  "scale_coverage": ["do", "re", "mi", "sol"],
  "tempo_bpm": 72,
  "quality": "excellent",
  "augmentation": null
}

---

## PART 5 — HOW TO PAY THE MUSICIANS (the ethical backbone)

This is what separates your dataset from every other one that gets sued.
You pay the musicians. You document the payment. You share the upside.

### The payment structure

Session fee (immediate):
  $100–$200 per 2-hour recording session.
  Pay cash, same day. Always.
  This makes the relationship real and demonstrates your commitment.
  At 20 sessions over 2 years = $2,000–$4,000 total to Ahmed.
  This is affordable now and honored forever.

Revenue share (when dataset generates income):
  15–25% of gross dataset licensing revenue goes to contributing musicians.
  Divided proportionally by number of recordings contributed.
  Paid quarterly when revenue exceeds $500.
  Tracked transparently in a shared document Ahmed can see.

Legacy provision:
  If Ahmed passes away while the dataset is still generating revenue,
  payments continue to his designated beneficiary for his lifetime.
  This is written into the contributor agreement.
  This provision costs you nothing if revenue is low.
  It means everything to his family if revenue is high.

### Why this structure matters

Every major lawsuit against Suno, Udio, and other AI music companies
happened because they used artists' data without consent or payment.
Universal Music Group settled for millions. Sony is still in court.

Your dataset has the opposite structure:
- Documented consent
- Documented payment
- Revenue share
- Governance board

This means your dataset is the ONLY commercially licensable
Somali music dataset in existence. That difference in legal standing
is worth more than the recordings themselves.

---

## PART 6 — THE PROCESSING PIPELINE (on your MacBook Pro M4 Max)

Your 128GB MacBook runs this entire pipeline locally, for free.

### Step 1 — Ingest and organize (immediately after each session)

mkdir -p ~/somali-archive/sessions/S001/raw
mkdir -p ~/somali-archive/sessions/S001/processed
mkdir -p ~/somali-archive/sessions/S001/clips
mkdir -p ~/somali-archive/sessions/S001/metadata

# Copy files from SD card, rename to standard format
# Fill in metadata JSON immediately while memory is fresh

### Step 2 — Quality check (Python)

import librosa
import soundfile as sf
import numpy as np

def quality_check(filepath):
    audio, sr = librosa.load(filepath, sr=None, mono=False)
    duration = audio.shape[-1] / sr
    peak_db = 20 * np.log10(np.max(np.abs(audio)) + 1e-9)
    rms_db = 20 * np.log10(np.sqrt(np.mean(audio**2)) + 1e-9)
    snr = peak_db - rms_db

    return {
        "duration_sec": round(duration, 2),
        "sample_rate": sr,
        "channels": audio.shape[0] if audio.ndim > 1 else 1,
        "peak_db": round(peak_db, 2),
        "rms_db": round(rms_db, 2),
        "snr_estimate": round(snr, 2),
        "quality": "excellent" if snr > 40 else "good" if snr > 30 else "fair"
    }

### Step 3 — Whisper transcription (Somali speech → text)

import whisper
model = whisper.load_model("large-v3")  # runs on your M4 Max GPU

def transcribe(filepath, language="so"):
    result_original = model.transcribe(
        filepath,
        language=language,
        task="transcribe",
        word_timestamps=True
    )
    result_english = model.transcribe(
        filepath,
        language=language,
        task="translate"
    )
    return {
        "somali": result_original["text"],
        "english": result_english["text"],
        "segments": result_original["segments"]
    }

### Step 4 — Pitch extraction (melody → scale notes)

import crepe
import soundfile as sf

SOMALI_SCALE_HZ = {
    "do":  293.66,
    "re":  329.63,
    "mi":  369.99,
    "sol": 440.00,
    "la":  493.88,
}

def extract_pitch(filepath):
    audio, sr = sf.read(filepath)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)  # mono

    # Resample to 16kHz for CREPE
    import librosa
    audio_16k = librosa.resample(audio, orig_sr=sr, target_sr=16000)

    time, frequency, confidence, _ = crepe.predict(
        audio_16k, 16000,
        model_capacity='full',
        viterbi=True,
        step_size=10,
        verbose=0
    )

    pitch_data = []
    for t, hz, conf in zip(time, frequency, confidence):
        if conf > 0.80 and hz > 0:
            diffs = {note: abs(hz - target) for note, target in SOMALI_SCALE_HZ.items()}
            nearest_note = min(diffs, key=diffs.get)
            cents_dev = 1200 * np.log2(hz / SOMALI_SCALE_HZ[nearest_note])
            pitch_data.append({
                "time_sec": round(float(t), 3),
                "frequency_hz": round(float(hz), 2),
                "confidence": round(float(conf), 3),
                "note": nearest_note,
                "cents_deviation": round(cents_dev, 2)
            })

    return pitch_data

### Step 5 — Audio augmentation (multiply your dataset)

from audiomentations import Compose, PitchShift, TimeStretch, AddGaussianNoise

augment = Compose([
    PitchShift(min_semitones=-2, max_semitones=2, p=0.5),
    TimeStretch(min_rate=0.85, max_rate=1.15, p=0.5),
    AddGaussianNoise(min_amplitude=0.001, max_amplitude=0.005, p=0.3),
])

def augment_recording(audio, sr, n_augmentations=5):
    augmented = []
    for i in range(n_augmentations):
        aug_audio = augment(samples=audio, sample_rate=sr)
        augmented.append(aug_audio)
    return augmented

# From 500 clips → 3,000 training examples

### Step 6 — Generate spectrogram (for visual AI models)

def generate_spectrogram(filepath, output_path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import librosa.display

    audio, sr = librosa.load(filepath, sr=22050)
    mel = librosa.feature.melspectrogram(
        y=audio, sr=sr,
        n_mels=128,
        fmax=4000,
        hop_length=512
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)

    plt.figure(figsize=(10, 4))
    librosa.display.specshow(mel_db, sr=sr, x_axis='time', y_axis='mel',
                             hop_length=512, fmax=4000)
    plt.colorbar(format='%+2.0f dB')
    plt.tight_layout()
    plt.savefig(output_path, dpi=100, bbox_inches='tight')
    plt.close()

### Step 7 — Generate audio embedding (for similarity search)

from transformers import AutoModel, AutoProcessor
import torch

processor = AutoProcessor.from_pretrained("m-a-p/MERT-v1-95M",
                                          trust_remote_code=True)
mert_model = AutoModel.from_pretrained("m-a-p/MERT-v1-95M",
                                       trust_remote_code=True)
mert_model.eval()

def generate_embedding(filepath):
    audio, sr = librosa.load(filepath, sr=24000, mono=True)
    inputs = processor(audio, sampling_rate=sr, return_tensors="pt")

    with torch.no_grad():
        outputs = mert_model(**inputs, output_hidden_states=True)

    all_hidden = torch.stack(outputs.hidden_states).squeeze()
    time_avg = all_hidden.mean(dim=-2)
    embedding = time_avg.mean(dim=0)

    return embedding.tolist()  # 768-dimensional vector

---

## PART 7 — DATASET MILESTONES AND WHAT EACH ONE UNLOCKS

### Milestone 1 — 50 recordings
What it unlocks:
  - First grant application (McKnight Foundation, NEA)
  - First university partnership outreach (MIT, McGill)
  - Working demo for visiting researcher applications
  - Proof of concept for the platform MVP

### Milestone 2 — 200 recordings
What it unlocks:
  - ISMIR dataset paper submission (enough for a dataset paper)
  - First research API with paying academic users ($200–500/month)
  - Google Academic Research Grant application (cloud compute credits)
  - Tier 1 research license published on HuggingFace

### Milestone 3 — 500 recordings
What it unlocks:
  - Fine-tune CREPE on Somali scale (enough training data)
  - Fine-tune Wav2Vec2 for genre classification
  - First commercial licensing pitch to AI companies
  - Smithsonian partnership discussion
  - ICASSP or NeurIPS paper on the model

### Milestone 4 — 1,000 recordings (multiple artists)
What it unlocks:
  - Cross-artist analysis (style comparison research)
  - Fine-tune MusicGen / AudioCraft for Somali music generation
  - Dataset valuation: $500,000–$1,000,000 conservatively
  - Approach Google DeepMind, Meta FAIR, Adobe Research for licensing
  - PhD application with two publications and a live dataset

### Milestone 5 — 5,000 recordings (national scale)
What it unlocks:
  - The definitive Somali music AI corpus
  - UNESCO Memory of the World application
  - Dataset value: $1,000,000–$5,000,000
  - Foundation for generative Somali music model
  - National recognition in Somalia, Ethiopia, Djibouti

---

## PART 8 — WHERE TO PUBLISH AND DISTRIBUTE THE DATASET

### Academic distribution (builds reputation)

HuggingFace Datasets Hub
  - Free to host, widely used by AI researchers
  - Publish the research tier (CC BY-NC 4.0)
  - Include full documentation, metadata schema, sample files
  - Add a research request form for institutions wanting more

Zenodo (CERN's open research archive)
  - Gets a DOI (Digital Object Identifier) — makes it citable
  - A citable dataset is a publishable contribution
  - Every citation increases the dataset's value

Paperswithcode.com
  - List it alongside your ISMIR paper
  - Researchers searching for non-Western music datasets find it

### Commercial distribution (generates revenue)

Direct licensing (you control this)
  - Maintain a license inquiry form on your website
  - All commercial requests go through the Foundation
  - You negotiate directly — no middleman

Data marketplace listing (optional)
  - Scale AI Data Engine accepts cultural datasets
  - Appen Global licenses training data to AI companies
  - AWS Data Exchange lists datasets for commercial licensing
  - Listing on these platforms puts you in front of buyers
    who specifically need training data

---

## PART 9 — THE COMPETITIVE MOAT (why nobody can copy this)

Three things that make your dataset permanently defensible:

1. THE DATA IS GONE IF YOU DON'T COLLECT IT
   Ahmed Ali Egal is 80 years old.
   The knowledge he carries cannot be reconstructed after he passes.
   No budget, no AI, no future technology can recreate
   a recording of him playing the songs he learned in 1965.
   This is not a competitive advantage that erodes.
   It is a historical fact that becomes more valuable with time.

2. THE COMMUNITY OWNS IT
   Your Foundation structure means the Somali community
   has institutional ownership of the dataset.
   No outside company can buy the rights out from under you.
   No investor can force a sale that the community doesn't approve.
   This governance structure is what makes Google, Meta,
   and others want to PARTNER rather than compete.

3. YOU HAVE THE ONLY KEY
   You are the only person who is:
   a) a Somali native speaker
   b) a trained oud player who understands the music technically
   c) an AI engineer who can build the pipeline
   d) trusted by the community to govern the data ethically
   That combination cannot be hired. It cannot be built.
   It is you, specifically. That is the moat.

---

## PART 10 — THE MILLION DOLLAR PATH (realistic timeline)

Year 1 — Build the asset
  Sessions: 20 recording sessions with Ahmed + 5–10 other musicians
  Output: 500 primary recordings, 3,000 augmented clips
  Revenue: $0 from dataset (invest in building)
  Revenue from consulting: $5,000–10,000/month (fund the project)

Year 2 — Publish and position
  Publication: ISMIR dataset paper (gives the dataset a DOI and citation)
  Research license: $5,000–25,000/year from 2–5 academic institutions
  Platform: First paying subscribers on the app ($2,000–5,000/month)
  Grant income: $50,000–150,000 (McKnight, NEA, Ford Foundation)

Year 3 — Commercialize
  Dataset size: 1,000+ recordings from multiple artists
  Commercial license: First deal with an AI company
  Deal size: $100,000–$500,000 (one-time or annual)
  Platform revenue: $10,000–30,000/month
  Total year 3 income: $250,000–$700,000

Year 4–5 — Scale
  Dataset size: 5,000+ recordings
  Multiple commercial licenses
  UNESCO / Smithsonian institutional partnership
  Dataset valuation: $1,000,000–$5,000,000
  PhD completed or in progress
  Speaking: $5,000–$15,000 per conference or university talk

---

*This document is the dataset strategy for the Somali Cultural Music Foundation.*
*Version 1.0 | Author: Khalid Ibrahim | For internal use and grant applications*
