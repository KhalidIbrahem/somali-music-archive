# Draft issue for `huggingface/transformers` — not yet filed

*Split out of `docs/oss/transformers_musicgen_dropout_issue.md` on 2026-09-24.
Verified on transformers 5.17.0 (fresh `uv` venv, `~/ai/tf-latest`) and 4.57.6
(the training env). Line numbers are for 5.17.0 unless marked. Khalid files it
himself; nothing here has been posted.*

---

## Title

MusicGen: `forward(labels=...)` raises "set the decoder_start_token_id" on every released checkpoint, while `generate()` and `prepare_decoder_input_ids_from_labels()` find the token fine

## Environment

| item | value |
| --- | --- |
| transformers | 5.17.0 (latest release, 2026-09-24); also reproduced on 4.57.6 |
| torch | 2.14.0 |
| Python | 3.11.16 |
| platform | macOS 26 (Darwin 25.6.0), Apple M5 Max, arm64 |
| devices | `cpu` (device-independent; the error is raised before any tensor work) |
| checkpoints | `facebook/musicgen-small`, `-medium`, `-large` (all three hub `config.json` files have `"decoder": {"decoder_start_token_id": null, "bos_token_id": 2048, "pad_token_id": 2048}`, and all three `generation_config.json` files have `"decoder_start_token_id": 2048`). `facebook/musicgen-melody` ships the same config values but its model class takes a different path and is unaffected, see Root cause. |

## Minimal reproduction (a few seconds on CPU)

```python
import torch
from transformers import MusicgenForConditionalGeneration

m = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small").eval()
labels = torch.randint(0, 2048, (1, 10, 4))   # (batch, frames, codebooks)
ids = torch.tensor([[3, 4, 5]])               # any text tokens

print(m.generation_config.decoder_start_token_id)          # 2048
print(m.config.decoder.decoder_start_token_id)             # None
print(m.prepare_decoder_input_ids_from_labels(labels)[0, 0])  # tensor(2048)  <- works, uses bos_token_id

m(input_ids=ids, labels=labels)
# ValueError: Make sure to set the decoder_start_token_id attribute of the model's configuration.
```

The same call succeeds after either of

```python
m.config.decoder.decoder_start_token_id = m.config.decoder.bos_token_id   # 2048
# or
m(input_ids=ids, decoder_input_ids=m.prepare_decoder_input_ids_from_labels(labels), labels=labels)
```

## Expected

Passing `labels` to `MusicgenForConditionalGeneration.forward` should work out
of the box on the released checkpoints, the way it does for every other
seq2seq model in the library and the way the model's own
`prepare_decoder_input_ids_from_labels` already does.

## Actual

`forward` raises on every released MusicGen checkpoint. Users who follow the
usual pattern (`Trainer`, or `model(**batch, labels=codes)` in a hand-written
loop) hit the error immediately and patch the config by hand. `Trainer` is
partly shielded because `DataCollatorForSeq2Seq` calls
`prepare_decoder_input_ids_from_labels`, which uses a different token source
and succeeds.

## Root cause

Three code paths in `modeling_musicgen.py` need "the token to put in front of
the shifted labels", and they read it from three different places:

| path | line (5.17.0) | line (4.57.6) | reads |
| --- | --- | --- | --- |
| `MusicgenForConditionalGeneration.forward`, labels given, no `decoder_input_ids` | 1534–1536 | 1814–1816 | `self.config.decoder.decoder_start_token_id` → `None` on every hub checkpoint |
| `MusicgenForConditionalGeneration.prepare_decoder_input_ids_from_labels` | 1803 | 2100 | `self.config.decoder.bos_token_id` → 2048 |
| `MusicgenForCausalLM.forward`, labels given | 708 | 936 | `self.config.bos_token_id` → 2048 |
| `generate()` | 1651 → `_get_decoder_start_token_id` (1856) | — | `self.generation_config.decoder_start_token_id` → 2048 |

`shift_tokens_right` (line 86; the raise is on line 95) is shared by all
three `forward`/`prepare` paths and only checks for `None`.

The hub configs were written by the conversion script with
`decoder_start_token_id: null` inside `decoder` and `2048` in
`generation_config.json`. Nothing in the model class bridges the two, so the
only path that reads the config field is the one that fails.
`musicgen_melody/modeling_musicgen_melody.py` does **not** have the bug: its
`MusicgenMelodyForConditionalGeneration.forward` already shifts with
`self.config.decoder.bos_token_id` (line 1527 in 5.17.0), which is exactly the
fallback proposed below. So the two sibling models already disagree with each
other on this.

On 5.17.0 the top-level `MusicgenConfig` no longer has a
`decoder_start_token_id` attribute at all (`AttributeError`, not `None`), so
the old workaround of setting it on the outer config does not even parse; the
field has to be set on `config.decoder`.

## Proposed fix

Make the labels path fall back the same way the other two paths and the
melody model do. In `MusicgenForConditionalGeneration.forward`:

```python
if (labels is not None) and (decoder_input_ids is None and decoder_inputs_embeds is None):
    decoder_input_ids = shift_tokens_right(
        labels,
        self.config.decoder.pad_token_id,
        self.config.decoder.decoder_start_token_id
        if self.config.decoder.decoder_start_token_id is not None
        else self.config.decoder.bos_token_id,
    )
```

or, equivalently, route it through `self._get_decoder_start_token_id()` so
`forward` and `generate` agree by construction. Either way the released
checkpoints train without config surgery.

Hub-side, the `config.json` files should also get
`"decoder_start_token_id": 2048` inside `decoder`, matching their
`generation_config.json`; that can ride in the same hub PRs as the
`"dropout": 0.0` change from the companion issue.

### Test

`tests/models/musicgen/test_modeling_musicgen.py` (sketch; the label reshape
must be checked against what `MusicgenTester` actually produces):

```python
def test_forward_with_labels_without_decoder_start_token_id(self):
    # Hub checkpoints ship decoder.decoder_start_token_id=None and rely on
    # bos_token_id; forward(labels=...) must not require the user to set it.
    config, inputs = self.model_tester.prepare_config_and_inputs_for_common()
    config.decoder.decoder_start_token_id = None
    model = MusicgenForConditionalGeneration(config).eval()
    labels = inputs["decoder_input_ids"].reshape(-1, config.decoder.num_codebooks, inputs["decoder_input_ids"].shape[-1]).transpose(1, 2)
    out = model(input_ids=inputs["input_ids"], labels=labels)
    self.assertIsNotNone(out.loss)
```

## Relation to the dropout issue

Independent bug, found by the same repro
(`docs/oss/musicgen_dropout_repro.py`, which works around it with one line so
the dropout numbers can be reproduced on their own). The dropout issue is the
one that silently ruins fine-tuning; this one is the loud error that every
fine-tuner hits first and patches without reading further.
