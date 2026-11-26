"""Check on a given transformers build that both MusicGen defects still reproduce.

    python musicgen_main_check.py

#49095: forward(labels=...) raises because config.decoder.decoder_start_token_id is None.
#49094: train-mode loss on the model's own tokens is about twice the eval-mode loss (dropout=0.1 in the hub config).
CPU, musicgen-small, about a minute. Last run: 2026-11-21 on main 2f1bc5e (5.24.0.dev0, torch 2.15.0):
ValueError for #49095; eval loss 4.4363, train loss 10.2944 for #49094.
"""
import sys, torch, transformers
from transformers import AutoProcessor, MusicgenForConditionalGeneration
print("transformers", transformers.__version__, transformers.__file__.split("/src/")[0][-12:], "torch", torch.__version__)
name = "facebook/musicgen-small"
torch.manual_seed(0)
proc = AutoProcessor.from_pretrained(name)
model = MusicgenForConditionalGeneration.from_pretrained(name, dtype=torch.float32)
cfg = model.config.decoder
print("decoder config: dropout", cfg.dropout, "decoder_start_token_id", cfg.decoder_start_token_id, "bos", cfg.bos_token_id, "pad", cfg.pad_token_id)
inputs = proc(text=["solo oud, slow"], padding=True, return_tensors="pt")
with torch.no_grad():
    model.eval()
    audio = model.generate(**inputs, do_sample=True, guidance_scale=3.0, max_new_tokens=250)
    codes = model.audio_encoder.encode(audio).audio_codes[0]
labels = codes.transpose(1, 2)
try:
    with torch.no_grad(): model(**inputs, labels=labels)
    print("#49095: forward(labels=...) works without a workaround")
except Exception as e:
    print("#49095 reproduces:", type(e).__name__, str(e)[:120])
    model.config.decoder.decoder_start_token_id = model.decoder.config.pad_token_id
def loss(train):
    model.train(train); torch.manual_seed(0)
    with torch.no_grad(): return model(**inputs, labels=labels).loss.item()
print(f"#49094: eval loss {loss(False):.4f}  train loss {loss(True):.4f}")
