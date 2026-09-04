# harvard_ab_listening

8 A/B pairs, 10 s each, 32 kHz PCM_16. `pairNNN_base.wav` = facebook/musicgen-small; `pairNNN_finetuned.wav` = runs/harvard_raw/ckpt_step_1500 (fixed-harness LoRA, lr 1e-4, r16, 1500 steps, 2026-09-03). Prompts: CAPTIONS.txt (seeded sample of 8 distinct Harvard test-split captions, seed 42). Each pair uses the same seed on both sides (42 + pair index), batch size 1, CFG 3.0. Same wavs live in data/eval_gen/harvard_base and harvard_lora1500 for PCS scoring. Built by runs/_tools/harvard_ab_gen.py.
