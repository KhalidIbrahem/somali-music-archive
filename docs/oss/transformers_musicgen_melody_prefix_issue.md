# Draft issue — `MusicgenMelodyForConditionalGeneration.generate()` ignores text and chroma conditioning (transformers 4.57)

**Status:** draft for Khalid to file at huggingface/transformers. Found 2026-09-26 while
evaluating melody-conditioned adapters; reproduced on transformers 4.57.6, torch 2.14.0,
CPU and MPS, `facebook/musicgen-melody`. Not observed on `facebook/musicgen-*` (text goes
through cross-attention every step there).

## Summary

`MusicgenMelodyForConditionalGeneration` conditions the decoder by **prepending** the
text + chroma prefix to the decoder inputs at the first generation step only; later steps
read it from the KV cache. `prepare_inputs_for_generation` therefore sets
`encoder_hidden_states = None` whenever `past_key_values is not None`
(`modeling_musicgen_melody.py`, "we only want to use conditional signal in the 1st
generation step"). Since `generate()` now passes an **empty `DynamicCache`** into the first
step, `past_key_values` is never `None`, the prefix is dropped at step 1 as well, and the
decoder never sees the conditioning: different captions and different chroma produce
byte-identical token sequences for the same seed.

## Repro (under a minute on CPU)

```python
import torch
from transformers import AutoProcessor, MusicgenMelodyForConditionalGeneration
proc = AutoProcessor.from_pretrained("facebook/musicgen-melody")
model = MusicgenMelodyForConditionalGeneration.from_pretrained("facebook/musicgen-melody").eval()
seen = []
model.decoder.register_forward_pre_hook(lambda m, a, kw: seen.append(kw.get("encoder_hidden_states") is not None), with_kwargs=True)
def run(text):
    seen.clear(); torch.manual_seed(0)
    out = model.generate(**proc(text=[text], padding=True, return_tensors="pt"), do_sample=True, guidance_scale=3.0, max_new_tokens=20)
    return out, seen[0]
a, prefix_a = run("slow oud solo, 80 BPM")
b, prefix_b = run("fast techno with heavy drums, 140 BPM")
print("decoder saw the prefix at step 1:", prefix_a, prefix_b)   # False, False  (expected True)
print("captions change the output:", not torch.equal(a, b))        # False         (expected True)
```

Expected: the first decoder call receives `encoder_hidden_states` (the prefix) and the two
captions give different tokens. Actual: the first call receives `None` and the tokens are
identical; the same holds with `input_features` / audio conditioning.

## Fix

In `prepare_inputs_for_generation`, treat an empty cache like `None`:

```python
if past_key_values is not None and past_key_values.get_seq_length() > 0:
    ...  # strip the prefix, drop encoder_hidden_states
```

(or check `cache_position[0] > 0`). Our project-side workaround wraps the method so the
original is called with `past_key_values=None` while the cache is empty and the cache is
handed back afterwards: `apps/ai-service/scripts/scale_eval.py::patch_melody_generation`.

## Versions

transformers 4.57.6 · torch 2.14.0 · Python 3.11 · macOS 26 (Apple silicon, MPS) and CPU.
