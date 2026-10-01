"""Minimal repro: MusicGen train-mode loss vs eval-mode loss on identical weights.

    python musicgen_dropout_repro.py [cpu|mps|cuda]

Runs in under a minute on a laptop (musicgen-small, 5 s of tokens). Prints the
decoder dropout config, the number of functional-dropout attributes and of
nn.Dropout modules (total and decoder-only; the decoder has no nn.Dropout at
all), and the loss in eval mode, train mode, train mode with every nn.Dropout
module at p=0, and train mode with the functional attributes at 0.

Reproduced on transformers 4.57.6 and 5.17.0 (torch 2.14.0).
"""
import sys, time, torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration

device = sys.argv[1] if len(sys.argv) > 1 else ("mps" if torch.backends.mps.is_available() else "cpu")
name = "facebook/musicgen-small"
t0 = time.time()
torch.manual_seed(0)
proc = AutoProcessor.from_pretrained(name)
# transformers >= 5 routes T5 attention through SDPA, and torch's MPS SDPA kernel refuses dropout > 0 in
# train mode (NotImplementedError). Eager attention gives identical losses; only needed on mps.
attn = "eager" if device == "mps" else None
model = MusicgenForConditionalGeneration.from_pretrained(name, dtype=torch.float32, attn_implementation=attn).to(device)
cfg = model.config.decoder
print(f"transformers decoder config: dropout={cfg.dropout} attention_dropout={cfg.attention_dropout} "
      f"activation_dropout={cfg.activation_dropout} layers={cfg.num_hidden_layers}")

# Count the places dropout is applied functionally (float attrs read by F.dropout(..., training=self.training))
attrs = [(n, a, getattr(m, a)) for n, m in model.named_modules()
         for a in ("dropout", "activation_dropout", "attention_dropout")
         if isinstance(getattr(m, a, None), float) and getattr(m, a) > 0]
n_drop_total = sum(isinstance(m, torch.nn.Dropout) for m in model.modules())
n_drop_decoder = sum(isinstance(m, torch.nn.Dropout) for m in model.decoder.modules())
n_attrs_decoder = sum(n.startswith("decoder.") for n, _, _ in attrs)
print(f"functional dropout attributes > 0: {len(attrs)} total, {n_attrs_decoder} in decoder  "
      f"(nn.Dropout modules: {n_drop_total} total, {n_drop_decoder} in decoder)")

# Targets: 5 s of the model's own tokens, so the sequence is in-distribution.
inputs = proc(text=["solo oud, slow"], padding=True, return_tensors="pt").to(device)
with torch.no_grad():
    model.eval()
    audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=250)  # (1, 1, samples)
    codes = model.audio_encoder.encode(audio).audio_codes[0]  # (1, K, T)
labels = codes.transpose(1, 2)  # (1, T, K) as MusicgenForConditionalGeneration expects
# The hub config.json has decoder.decoder_start_token_id = null; forward(labels=...) reads that
# field (generate() reads generation_config, which has 2048) and raises without this line.
# Separate defect: docs/oss/transformers_musicgen_decoder_start_issue.md
model.config.decoder.decoder_start_token_id = model.decoder.config.pad_token_id
print(f"labels shape {tuple(labels.shape)}")

def loss(train_mode: bool, p_override=None):
    model.train(train_mode)
    if p_override is not None:
        for n, a, _ in attrs: setattr(dict(model.named_modules())[n], a, p_override)
    torch.manual_seed(0)
    with torch.no_grad():
        return model(**inputs, labels=labels).loss.item()

print(f"eval mode                        loss = {loss(False):.4f}")
print(f"train mode                       loss = {loss(True):.4f}")
mods = dict(model.named_modules())
for m in model.modules():
    if isinstance(m, torch.nn.Dropout): m.p = 0.0
print(f"train mode, nn.Dropout p=0       loss = {loss(True):.4f}")
for n, a, _ in attrs: setattr(mods[n], a, 0.0)
print(f"train mode, functional attrs=0   loss = {loss(True):.4f}")
print(f"({device}, {time.time()-t0:.0f} s)")
