# Draft issue for `huggingface/transformers` — not yet filed

*Drafted 2026-09-24 from the QaraamiGen fine-tuning work. Every number below was
produced by `docs/oss/musicgen_dropout_repro.py` on this machine on that date.
Khalid files it himself; nothing here has been posted.*

---

## Title

MusicGen: `train()` mode doubles the loss of the pretrained checkpoints because the hub configs carry `dropout=0.1`, a value the models were never trained with

## Environment

| item | value |
| --- | --- |
| transformers | 4.57.6 |
| torch | 2.14.0 |
| peft (not needed for the repro) | 0.20.0 |
| Python | 3.11.16 |
| platform | macOS 26 (Darwin 25.6.0), Apple M5 Max, arm64 |
| devices tested | `cpu` and `mps` (same result on both) |
| checkpoints | `facebook/musicgen-small`, `-medium`, `-large` (all three hub `config.json` files have `"decoder": {"dropout": 0.1, "attention_dropout": 0.0, "activation_dropout": 0.0}`) |

## Minimal reproduction (runs in about 20 s on CPU)

`docs/oss/musicgen_dropout_repro.py` — self-contained, no data needed. It loads
`facebook/musicgen-small`, generates 5 s of audio, re-encodes it with the model's
own EnCodec so the labels are in-distribution, then scores the same tokens with
the same weights under four settings:

```
$ python musicgen_dropout_repro.py cpu
transformers decoder config: dropout=0.1 attention_dropout=0.0 activation_dropout=0.0 layers=24
functional dropout attributes > 0: 37  (nn.Dropout modules: 37)
labels shape (1, 247, 4)
eval mode                        loss = 4.8118
train mode                       loss = 9.6970
train mode, nn.Dropout p=0       loss = 9.5071
train mode, functional attrs=0   loss = 4.8118
(cpu, 16 s)
```

On `mps`: eval 4.6730, train 9.6468, train with `nn.Dropout` modules at 0:
9.7517, train with the functional attributes at 0: 4.6730.

## Expected

With the pretrained weights, the train-mode forward pass should be a mildly
regularised version of the eval-mode pass: a loss a few hundredths of a nat
higher, not double. Fine-tuning the decoder (full or LoRA) should therefore
optimise roughly the function that `generate()` uses.

## Actual

`model.train()` on an unmodified checkpoint raises the token cross-entropy from
4.8 to 9.7 nats, above the 7.6 nats of a uniform distribution over the 2048
codes. Setting every `nn.Dropout` module to `p=0` changes nothing, because the
MusicGen decoder does not use `nn.Dropout` modules. Setting the 37 float
attributes read by `nn.functional.dropout(..., training=self.training)` to 0
makes train mode equal eval mode to four decimals.

Fine-tuning under the default config therefore fits a forward path the
evaluation never sees. In our runs (LoRA r=16 on the decoder attention
projections, three learning rates, two corpora) validation loss looked fine at
step 100 and had climbed from 4.5 to 6.7–7.2 by step 1000 while the training
loss "converged" toward 7.2; zeroing the attributes turned the same recipe into
a normal run (val 4.5132 → 4.4785 on unseen songs). The July "negative result"
in our project was entirely this.

## Root cause

1. `MusicgenDecoderConfig.__init__` defaults `dropout=0.1`
   (`configuration_musicgen.py`), and `MusicgenMelodyDecoderConfig` does the same.
2. The conversion script did not override it, so all released hub configs carry
   `dropout: 0.1`.
3. The original models were trained with **no dropout**: audiocraft's
   `config/model/lm/default.yaml` sets `dropout: 0.` for the transformer LM.
4. `modeling_musicgen.py` applies that value functionally at 25 sites in the
   decoder: on the summed codebook embeddings in `MusicgenDecoder.forward`
   (line 594 in 4.57.6) and after self-attention, cross-attention and the FFN in
   each of the 24 `MusicgenDecoderLayer`s (lines 385, 403, 412). The other 12
   of the 37 attributes are `T5Attention.dropout` in the text encoder; those are
   harmless (train-mode text encoder alone: 4.6567 vs 4.6730 eval).

The weights are not robust to a perturbation they never met. A single site is
enough to break the forward pass: keeping only `MusicgenDecoder.dropout` at 0.1
gives 9.59; keeping only layer 0's dropout gives 8.17 (isolation run,
2026-09-24, mps).

A second, smaller defect surfaces in the same repro: the hub configs leave
`decoder_start_token_id` unset, so `model(**inputs, labels=labels)` raises
`ValueError: Make sure to set the decoder_start_token_id attribute` until the
user sets it to `pad_token_id` (2048) by hand.

## Proposed fix

Make the config match the checkpoints, in three parts (diff in
`docs/oss/transformers_musicgen_dropout_fix.diff`):

1. **Default `dropout=0.0`** in `MusicgenDecoderConfig` and
   `MusicgenMelodyDecoderConfig`, with the docstring saying the released models
   were trained without dropout and that users who want it must opt in. This
   only changes behaviour for configs built without an explicit value; the
   published hub configs still say 0.1 and need step 3.
2. **A one-time warning** in `MusicgenForConditionalGeneration.train()` (and the
   melody class) when any of `dropout`, `activation_dropout`,
   `attention_dropout` is non-zero, telling the user the train path will differ
   from the eval path and how to switch it off. Cheap, and it is what would have
   saved us three weeks.
3. **Hub config PRs** for `facebook/musicgen-{small,medium,large,melody,...}`
   setting `"dropout": 0.0` and `"decoder_start_token_id": 2048` (outside this
   repo; listed here so the transformers issue can link them).

### Test

`tests/models/musicgen/test_modeling_musicgen.py`:

```python
def test_train_mode_matches_eval_mode_by_default(self):
    # The released MusicGen checkpoints were trained without dropout; a default
    # config must not turn any on, or fine-tuning optimises a path that
    # generation never uses.
    config, inputs = self.model_tester.prepare_config_and_inputs_for_common()
    model = MusicgenForCausalLM(config).eval()
    torch.manual_seed(0)
    eval_logits = model(**inputs).logits
    model.train()
    torch.manual_seed(0)
    train_logits = model(**inputs).logits
    torch.testing.assert_close(eval_logits, train_logits)
```

The same test, parametrised over the melody model, and a second test asserting
that the warning in (2) fires exactly once for a config with `dropout=0.1`.

## Why this matters beyond one project

Every public "fine-tune MusicGen with LoRA" recipe on top of transformers calls
`model.train()` on these checkpoints. Anyone who did that without noticing that
validation loss diverged from step 250 concluded, as we first did, that their
data was the problem.
