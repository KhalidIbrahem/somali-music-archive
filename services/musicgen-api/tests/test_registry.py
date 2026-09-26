"""Unit tests for the inference service's adapter registry (services/musicgen-api/app.py):
merging adapters.extra.json into the built-in ADAPTERS with validation, the engine
map (a full_decoder entry gets its own "<base>::<name>" engine, a LoRA entry on an
unlisted base adds an engine), rights flags, the full-decoder state-dict loader,
both engine load paths with the model classes faked, and the /health, /adapters,
/generate and /demo shapes through FastAPI's TestClient. No model is loaded, no
network, no GPU: the lifespan (which loads models) is never entered.

Run:  ~/ai/musicgen-env/bin/python -m pytest services/musicgen-api/tests -q
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest
import torch

HERE = Path(__file__).resolve().parent
SERVICE = HERE.parent
REPO = SERVICE.parents[1]

# --- a registry the module reads at import (before `import app`) -------------------------------
_TMP = Path(tempfile.mkdtemp(prefix="qg-registry-"))
atexit.register(shutil.rmtree, _TMP, ignore_errors=True)
REGISTRY = _TMP / "adapters.extra.json"
FULL_CKPT = _TMP / "runs/qaraami_medium_full/ckpt_step_1000"
FULL_CKPT.mkdir(parents=True)
(FULL_CKPT / "decoder.safetensors").write_bytes(b"")  # exists, so the entry is not "missing"
ENTRIES = [
    {"name": "qaraami_large", "kind": "lora", "path": "runs/qaraami_large/ckpt_step_2750", "base": "facebook/musicgen-large",
     "corpus": "isolated oud + Ahmed full mixes", "trained": "2026-10-01, LoRA r=128", "metrics": {"val_ce": {"base": 4.4, "adapter": 4.1}},
     "listening_gate": "not yet performed", "rights": "releasable", "best_step": 2750},
    {"name": "qaraami_medium_full", "kind": "full_decoder", "path": str(FULL_CKPT), "base": "facebook/musicgen-medium",
     "corpus": "isolated oud", "trained": "2026-10-02, full decoder", "metrics": {}, "listening_gate": "passed (Khalid, 2026-10)",
     "rights": "releasable"},
    {"name": "qaraami_large_all", "kind": "lora", "path": "runs/qaraami_large_all/ckpt_step_3000", "base": "facebook/musicgen-large",
     "rights": "research_only", "best_step": "3000"},  # best_step not an int -> parsed from the path
    {"name": "qaraami_melody", "kind": "lora", "path": "runs/qaraami_melody/ckpt_step_2000", "base": "facebook/musicgen-melody"},  # no rights -> research_only
    {"name": "bogus_kind", "kind": "flash", "path": "runs/x/ckpt_step_0001", "base": "facebook/musicgen-small"},   # skipped
    {"name": "no_base", "kind": "lora", "path": "runs/x/ckpt_step_0001"},                                          # skipped
    {"name": "no_path", "kind": "lora", "base": "facebook/musicgen-small"},                                        # skipped
    {"name": "base", "kind": "lora", "path": "runs/x/ckpt_step_0001", "base": "facebook/musicgen-small"},         # reserved name
    {"name": "bad name!", "kind": "lora", "path": "runs/x/ckpt_step_0001", "base": "facebook/musicgen-small"},    # bad name
    "not an object",                                                                                             # skipped
]
REGISTRY.write_text(json.dumps(ENTRIES))
os.environ["MUSICGEN_ADAPTERS_EXTRA"] = str(REGISTRY)
os.environ["MUSICGEN_API_ENV_FILE"] = str(_TMP / "no-such-env")  # never read the real token in tests
os.environ["MUSICGEN_API_TOKEN"] = "test-token"
os.environ["MUSICGEN_OUTPUT_DIR"] = str(_TMP / "outputs")
# The expectations below assume the default engine pair, whatever the developer's shell exports.
os.environ["MUSICGEN_ENGINES"] = "facebook/musicgen-small,facebook/musicgen-large"
os.environ.pop("MUSICGEN_BASE_MODEL", None)
os.environ.setdefault("HF_HUB_OFFLINE", "1")
sys.path.insert(0, str(SERVICE))
import app as service  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(service.app)  # no `with`: the lifespan (model loading) does not run
AUTH = {"Authorization": "Bearer test-token"}
FULL_KEY = "facebook/musicgen-medium::qaraami_medium_full"


# --- registry merge / validation -----------------------------------------------------------------

def test_registry_merges_builtins_and_valid_entries() -> None:
    assert set(service.ADAPTERS) == {"oud", "harvard_raw", "large", "qaraami_large", "qaraami_medium_full", "qaraami_large_all", "qaraami_melody"}
    assert service.ADAPTERS["oud"]["kind"] == "lora" and service.ADAPTERS["oud"]["rights"] == "releasable"
    assert service.ADAPTERS["harvard_raw"]["rights"] == "research_only" and service.ADAPTERS["large"]["rights"] == "research_only"
    assert service.ADAPTERS["oud"]["best_step"] == 500 and service.ADAPTERS["large"]["best_step"] == 2750


def test_invalid_entries_are_skipped() -> None:
    for bad in ("bogus_kind", "no_base", "no_path", "bad name!"):
        assert bad not in service.ADAPTERS
    assert service.ADAPTERS  # and "base" was not turned into an adapter
    assert service.ADAPTER_ENGINE["base"] == service.DEFAULT_BASE


def test_paths_resolve_repo_relative_or_absolute() -> None:
    assert service.ADAPTERS["qaraami_large"]["path"] == REPO / "runs/qaraami_large/ckpt_step_2750"
    assert service.ADAPTERS["qaraami_medium_full"]["path"] == FULL_CKPT


def test_rights_default_conservative_and_best_step_from_path() -> None:
    assert service.ADAPTERS["qaraami_melody"]["rights"] == "research_only"  # no rights given
    assert service.ADAPTERS["qaraami_large_all"]["best_step"] == 3000       # "3000" (str) -> parsed from ckpt_step_3000
    assert service.ADAPTERS["qaraami_melody"]["listening_gate"] == "not yet performed"
    assert service.ADAPTERS["qaraami_melody"]["corpus"] == "an unnamed corpus"


def test_normalise_entry_rules() -> None:
    ok = service.normalise_entry({"name": "x1", "kind": "lora", "path": "runs/x/ckpt_step_0250", "base": "facebook/musicgen-small", "rights": "releasable"}, "t")
    assert ok is not None and ok[0] == "x1" and ok[1]["rights"] == "releasable" and ok[1]["best_step"] == 250
    assert service.normalise_entry({"name": "x2", "kind": "adapter", "path": "p", "base": "b"}, "t") is None      # unknown kind
    assert service.normalise_entry({"name": "x3", "kind": "lora", "path": "p"}, "t") is None                        # missing base
    assert service.normalise_entry({"name": "x4", "kind": "lora", "path": "p", "base": "  "}, "t") is None          # blank base
    assert service.normalise_entry({"name": "x5", "kind": "lora", "base": "b"}, "t") is None                        # missing path key
    assert service.normalise_entry({"name": "base", "kind": "lora", "path": "p", "base": "b"}, "t") is None         # reserved
    assert service.normalise_entry(["not", "a", "dict"], "t") is None
    for bad in (".hidden", "_under", "-x", "qaraamié", "a" * 41, "ok\n"):
        assert service.normalise_entry({"name": bad, "kind": "lora", "path": "p", "base": "b"}, "t") is None
    bad_rights = service.normalise_entry({"name": "x6", "kind": "lora", "path": "p", "base": "b", "rights": "public"}, "t")
    assert bad_rights is not None and bad_rights[1]["rights"] == "research_only"
    kept = service.normalise_entry({"name": "x7", "kind": "full_decoder", "path": "p", "base": "b", "rights": "releasable", "run": "runs/x", "metrics": "nope"}, "t")
    assert kept is not None and kept[1]["run"] == "runs/x" and kept[1]["metrics"] == {} and kept[1]["kind"] == "full_decoder"


def test_load_extra_adapters_missing_invalid_duplicates_and_override(tmp_path: Path) -> None:
    builtin = {"oud": dict(service.BUILTIN_ADAPTERS["oud"])}
    assert set(service.load_extra_adapters(tmp_path / "absent.json", builtin)) == {"oud"}
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert set(service.load_extra_adapters(bad, builtin)) == {"oud"}
    bad.write_text(json.dumps({"name": "dict-not-list"}))
    assert set(service.load_extra_adapters(bad, builtin)) == {"oud"}
    reg = tmp_path / "reg.json"
    reg.write_text(json.dumps([
        {"name": "a", "kind": "lora", "path": "runs/a/ckpt_step_0250", "base": "facebook/musicgen-small", "rights": "releasable", "corpus": "first"},
        {"name": "a", "kind": "lora", "path": "runs/a/ckpt_step_0500", "base": "facebook/musicgen-small", "rights": "releasable", "corpus": "second"},
        {"name": "oud", "kind": "lora", "path": "runs/oud_v2/ckpt_step_0750", "base": "facebook/musicgen-small", "rights": "releasable", "corpus": "override"},
    ]))
    merged = service.load_extra_adapters(reg, builtin)
    assert merged["a"]["corpus"] == "second" and merged["a"]["best_step"] == 500  # later duplicate wins
    assert merged["oud"]["corpus"] == "override" and merged["oud"]["path"] == REPO / "runs/oud_v2/ckpt_step_0750"  # registry beats builtin


# --- engines -------------------------------------------------------------------------------------

def test_engine_key_for_full_decoder_and_added_bases() -> None:
    assert service.engine_key("qaraami_medium_full", service.ADAPTERS["qaraami_medium_full"]) == FULL_KEY
    assert FULL_KEY in service.ENGINES
    eng = service.ENGINES[FULL_KEY]
    assert eng.kind == "full_decoder" and eng.adapter_name == "qaraami_medium_full" and eng.base_model == "facebook/musicgen-medium" and eng.key == FULL_KEY
    assert service.ADAPTER_ENGINE["qaraami_medium_full"] == FULL_KEY
    # LoRA entries share their base's engine; a LoRA base absent from MUSICGEN_ENGINES gets one
    assert service.ADAPTER_ENGINE["qaraami_large"] == "facebook/musicgen-large" == service.ADAPTER_ENGINE["large"] == service.ADAPTER_ENGINE["qaraami_large_all"]
    assert "facebook/musicgen-melody" in service.ENGINES and service.ENGINES["facebook/musicgen-melody"].kind == "lora"
    assert service.ADAPTER_ENGINE["base"] == "facebook/musicgen-small"
    assert service.engine_for("base") is service.ENGINES["facebook/musicgen-small"]
    assert service.engine_for("nope") is None


def test_build_engines_pure() -> None:
    adapters = {
        "l1": {"kind": "lora", "base": "m/a"}, "l2": {"kind": "lora", "base": "m/a"},
        "f1": {"kind": "full_decoder", "base": "m/a"}, "l3": {"kind": "lora", "base": "m/b"},
    }
    engines, amap = service.build_engines(adapters, ["m/a"])
    assert set(engines) == {"m/a", "m/a::f1", "m/b"}
    assert amap == {"base": "m/a", "l1": "m/a", "l2": "m/a", "f1": "m/a::f1", "l3": "m/b"}
    assert engines["m/a::f1"].kind == "full_decoder" and engines["m/b"].kind == "lora"


def test_provenance_names_kind_and_research_only() -> None:
    p = service.provenance("qaraami_medium_full")
    assert "full-decoder fine-tune" in p and "isolated oud" in p and service.RIGHTS_LINE in p and "Research-only" not in p
    q = service.provenance("qaraami_large_all")
    assert "LoRA adapter" in q and service.RESEARCH_ONLY_LINE in q
    assert service.provenance("base").startswith(f"Generated by {service.DEFAULT_BASE} with no adapter")
    assert service.is_research_only("harvard_raw") and not service.is_research_only("oud") and not service.is_research_only("base")


class _Decoder(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.lin = torch.nn.Linear(3, 2)


class _Model(torch.nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.decoder = _Decoder()


def test_load_decoder_state_plain_prefixed_and_mismatch(tmp_path: Path) -> None:
    from safetensors.torch import save_file

    src = _Model()
    plain = tmp_path / "plain" / "decoder.safetensors"
    plain.parent.mkdir()
    save_file({k: v.contiguous() for k, v in src.decoder.state_dict().items()}, str(plain))
    dst = _Model()
    assert service.load_decoder_state(dst, plain) == 2
    assert torch.equal(dst.decoder.lin.weight, src.decoder.lin.weight)
    prefixed = tmp_path / "prefixed.safetensors"  # keys taken from the whole model carry "decoder."
    save_file({f"decoder.{k}": v.contiguous() for k, v in src.decoder.state_dict().items()}, str(prefixed))
    dst2 = _Model()
    assert service.load_decoder_state(dst2, prefixed) == 2 and torch.equal(dst2.decoder.lin.bias, src.decoder.lin.bias)
    partial = tmp_path / "partial.safetensors"
    save_file({"lin.weight": src.decoder.lin.weight.contiguous()}, str(partial))
    with pytest.raises(ValueError, match="1 missing"):
        service.load_decoder_state(_Model(), partial)
    extra = tmp_path / "extra.safetensors"
    save_file({**{k: v.contiguous() for k, v in src.decoder.state_dict().items()}, "other.weight": torch.zeros(1)}, str(extra))
    with pytest.raises(ValueError, match="1 unexpected"):
        service.load_decoder_state(_Model(), extra)
    assert service.decoder_weights_file(tmp_path / "ckpt") == tmp_path / "ckpt" / "decoder.safetensors"
    assert service.decoder_weights_file(prefixed) == prefixed


def test_full_decoder_engine_fails_fast_when_weights_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setitem(service.ADAPTERS["qaraami_medium_full"], "path", tmp_path / "nowhere")
    eng = service.Engine("facebook/musicgen-medium", kind="full_decoder", adapter_name="qaraami_medium_full")
    monkeypatch.setattr(service, "model_class", lambda name: pytest.fail("the base model must not be loaded when the weights are missing"))
    eng.load()
    assert eng.state == "failed" and eng.error.startswith("adapter missing") and eng.loaded_adapters == []
    assert eng.missing_adapters == {"qaraami_medium_full": str(tmp_path / "nowhere" / "decoder.safetensors")}
    assert not service.is_loaded("qaraami_medium_full")


class _FakeBase(torch.nn.Module):
    """Stands in for MusicgenForConditionalGeneration: a decoder and a config."""

    def __init__(self) -> None:
        super().__init__()
        self.decoder = _Decoder()
        self.config = type("C", (), {"decoder": type("D", (), {"decoder_start_token_id": 0})()})()


def test_full_decoder_engine_loads_with_faked_model(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import transformers
    from safetensors.torch import save_file

    ckpt = tmp_path / "ckpt_step_0750"
    ckpt.mkdir()
    src = _FakeBase()
    save_file({k: v.contiguous() for k, v in src.decoder.state_dict().items()}, str(ckpt / "decoder.safetensors"))
    monkeypatch.setitem(service.ADAPTERS["qaraami_medium_full"], "path", ckpt)
    monkeypatch.setattr(service, "DEVICE", "cpu")
    seen = {}
    fake_cls = type("FakeCls", (), {"from_pretrained": staticmethod(lambda name, **kw: seen.setdefault("base", _FakeBase()))})
    monkeypatch.setattr(service, "model_class", lambda name: fake_cls)
    monkeypatch.setattr(transformers.AutoProcessor, "from_pretrained", staticmethod(lambda name: "processor"))
    eng = service.Engine("facebook/musicgen-medium", kind="full_decoder", adapter_name="qaraami_medium_full")
    eng.load()
    assert eng.state == "ready", eng.error
    assert eng.loaded_adapters == ["qaraami_medium_full"] and eng.processor == "processor"
    assert torch.equal(seen["base"].decoder.lin.weight, src.decoder.lin.weight)
    assert seen["base"].config.decoder.decoder_start_token_id == service.BOS
    assert not eng.model.training  # eval()
    assert isinstance(eng._use("qaraami_medium_full"), type(service.nullcontext()))


def test_lora_engine_loads_present_adapters_with_faked_peft(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    import peft
    import transformers

    class FakePeft(torch.nn.Module):
        def __init__(self, base, path, adapter_name):
            super().__init__()
            self.names = [adapter_name]
            self.paths = [path]

        @classmethod
        def from_pretrained(cls, base, path, adapter_name):
            return cls(base, path, adapter_name)

        def load_adapter(self, path, adapter_name):
            self.names.append(adapter_name)
            self.paths.append(path)

    for name in ("large", "qaraami_large"):  # present; qaraami_large_all stays missing
        d = tmp_path / name
        d.mkdir()
        monkeypatch.setitem(service.ADAPTERS[name], "path", d)
    monkeypatch.setitem(service.ADAPTERS["qaraami_large_all"], "path", tmp_path / "missing")
    monkeypatch.setattr(service, "DEVICE", "cpu")
    monkeypatch.setattr(service, "model_class", lambda name: type("F", (), {"from_pretrained": staticmethod(lambda n, **kw: _FakeBase())}))
    monkeypatch.setattr(transformers.AutoProcessor, "from_pretrained", staticmethod(lambda name: "processor"))
    monkeypatch.setattr(peft, "PeftModel", FakePeft)
    eng = service.Engine("facebook/musicgen-large")
    eng.load()
    assert eng.state == "ready", eng.error
    assert eng.loaded_adapters == ["large", "qaraami_large"]  # registry order, missing one skipped
    assert eng.missing_adapters == {"qaraami_large_all": str(tmp_path / "missing")}  # ... and recorded, for /health and /generate
    assert eng.model.names == ["large", "qaraami_large"] and eng.model.paths == [str(tmp_path / "large"), str(tmp_path / "qaraami_large")]


# --- HTTP surface (no lifespan: engines stay "pending" unless a test marks them) ------------------

@pytest.fixture
def ready_engines(monkeypatch: pytest.MonkeyPatch):
    """Mark every engine ready with its adapters loaded (as after a successful start)."""
    for key, eng in service.ENGINES.items():
        monkeypatch.setattr(eng, "state", "ready")
        names = [n for n, i in service.ADAPTERS.items() if service.engine_key(n, i) == key]
        monkeypatch.setattr(eng, "loaded_adapters", names)
        monkeypatch.setattr(eng, "load_seconds", 1.0)
    monkeypatch.setattr(service.ENGINES[FULL_KEY], "state", "loading")  # one still loading
    monkeypatch.setattr(service.ENGINES[FULL_KEY], "loaded_adapters", [])
    yield


def test_health_shape_with_kind_rights_and_engines(ready_engines) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    h = r.json()
    assert h["ok"] is True and h["base_model"] == "facebook/musicgen-small"
    assert set(h) >= {"adapters_loaded", "adapters_research_only", "engines", "adapter_details", "queue", "memory", "uptime_seconds", "registry"}
    assert set(h["adapters_loaded"]) == {"oud", "harvard_raw", "large", "qaraami_large", "qaraami_large_all", "qaraami_melody"}
    assert set(h["adapters_research_only"]) == {"harvard_raw", "large", "qaraami_large_all", "qaraami_melody"}
    assert h["engines"][FULL_KEY]["kind"] == "full_decoder" and h["engines"][FULL_KEY]["state"] == "loading"
    assert h["engines"]["facebook/musicgen-large"]["kind"] == "lora" and h["engines"]["facebook/musicgen-large"]["base_model"] == "facebook/musicgen-large"
    rows = {d["id"]: d for d in h["adapter_details"]}
    assert list(rows)[0] == "base"
    for d in rows.values():
        assert set(d) >= {"id", "base_model", "size", "kind", "rights", "research_only", "listening_gate", "best_step", "engine", "loaded", "engine_state", "timing"}
    assert rows["base"]["kind"] == "base" and rows["base"]["research_only"] is False and rows["base"]["listening_gate"] is None
    assert rows["oud"] | {} == rows["oud"] and rows["oud"]["rights"] == "releasable" and rows["oud"]["listening_gate"].startswith("passed")
    assert rows["harvard_raw"]["research_only"] is True and rows["qaraami_large_all"]["rights"] == "research_only"
    full = rows["qaraami_medium_full"]
    assert full["kind"] == "full_decoder" and full["engine"] == FULL_KEY and full["loaded"] is False and full["engine_state"] == "loading"
    assert full["listening_gate"] == "passed (Khalid, 2026-10)" and full["best_step"] == 1000 and full["size"] == "Medium 1.5B"
    assert rows["qaraami_melody"]["size"] == "Melody 1.5B" and rows["qaraami_melody"]["engine"] == "facebook/musicgen-melody"


def test_health_not_ok_before_default_engine_loads() -> None:
    h = client.get("/health").json()
    assert h["ok"] is False and h["adapters_loaded"] == []
    assert {d["id"] for d in h["adapter_details"]} == {"base", *service.ADAPTERS}


def test_adapters_route_needs_token_and_carries_flags(ready_engines) -> None:
    assert client.get("/adapters").status_code == 401
    assert client.get("/adapters", headers={"Authorization": "Bearer wrong"}).status_code == 401
    r = client.get("/adapters", headers=AUTH)
    assert r.status_code == 200
    a = r.json()["adapters"]
    assert a["qaraami_medium_full"]["kind"] == "full_decoder" and a["qaraami_medium_full"]["engine"] == FULL_KEY
    assert a["qaraami_medium_full"]["path"] == str(FULL_CKPT) and a["qaraami_medium_full"]["loaded"] is False
    assert a["qaraami_large_all"]["research_only"] is True and a["qaraami_large"]["research_only"] is False
    assert service.RESEARCH_ONLY_LINE in a["harvard_raw"]["provenance"] and service.RESEARCH_ONLY_LINE not in a["oud"]["provenance"]


def test_generate_unknown_and_not_ready_adapters(ready_engines) -> None:
    body = {"prompt": "a slow oud piece", "duration": 2}
    assert client.post("/generate", json={**body, "adapter": "nope"}, headers=AUTH).status_code == 404
    r = client.post("/generate", json={**body, "adapter": "qaraami_medium_full"}, headers=AUTH)
    assert r.status_code == 503 and FULL_KEY in r.json()["detail"] and r.headers["Retry-After"] == "30"
    assert client.post("/generate", json={**body, "adapter": "oud"}).status_code == 401


def test_generate_missing_weights_and_failed_engine_do_not_ask_to_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    """A registered adapter whose checkpoint was missing when its (now ready) engine
    loaded, and an adapter on a failed engine: neither clears without a restart, so
    no Retry-After, and /health names the reason in the adapter row."""
    large = service.ENGINES["facebook/musicgen-large"]
    monkeypatch.setattr(large, "state", "ready")
    monkeypatch.setattr(large, "loaded_adapters", ["large", "qaraami_large"])
    monkeypatch.setattr(large, "missing_adapters", {"qaraami_large_all": "/runs/qaraami_large_all/ckpt_step_3000"})
    melody = service.ENGINES["facebook/musicgen-melody"]
    monkeypatch.setattr(melody, "state", "failed")
    monkeypatch.setattr(melody, "error", "RuntimeError: boom")
    body = {"prompt": "a slow oud piece", "duration": 2}
    r = client.post("/generate", json={**body, "adapter": "qaraami_large_all"}, headers=AUTH)
    assert r.status_code == 404 and "Retry-After" not in r.headers
    assert "registered but not loaded" in r.json()["detail"] and "/runs/qaraami_large_all/ckpt_step_3000" in r.json()["detail"]
    r = client.post("/generate", json={**body, "adapter": "qaraami_melody"}, headers=AUTH)
    assert r.status_code == 503 and "Retry-After" not in r.headers and "boom" in r.json()["detail"]
    r = client.post("/generate", json={**body, "adapter": "qaraami_medium_full"}, headers=AUTH)  # its engine is still pending
    assert r.status_code == 503 and r.headers["Retry-After"] == "30"
    rows = {d["id"]: d for d in client.get("/health").json()["adapter_details"]}
    assert rows["qaraami_large_all"] | {} == rows["qaraami_large_all"]
    assert rows["qaraami_large_all"]["loaded"] is False and rows["qaraami_large_all"]["engine_state"] == "ready"
    assert rows["qaraami_large_all"]["error"] == "adapter weights missing: /runs/qaraami_large_all/ckpt_step_3000"
    assert rows["qaraami_melody"]["error"] == "RuntimeError: boom" and rows["qaraami_large"]["error"] is None and rows["qaraami_large"]["loaded"] is True
    assert rows["qaraami_medium_full"]["error"] is None  # pending: nothing wrong yet
    assert service.adapter_error("nope") is None and service.adapter_error("base") is None


def test_demo_page_is_served() -> None:
    """/demo serves static/index.html as is (that page belongs to another component;
    its adapter list and rights display are not asserted here)."""
    r = client.get("/demo")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert 'id="adapter"' in r.text and "/generate" in r.text


# --- cross-check with the registration script -----------------------------------------------------

def test_register_adapter_entry_is_accepted_by_the_service(tmp_path: Path) -> None:
    from scripts import register_adapter as ra  # apps/ai-service is on sys.path through app.py

    run = tmp_path / "runs" / "demo_run"
    ckpt = run / "ckpt_step_0500"
    ckpt.mkdir(parents=True)
    (ckpt / "adapter_config.json").write_text("{}")
    (run / "loss.csv").write_text("step,train_loss,val_loss,lr,sec_per_step,mps_driver_gb\n0,,4.5,0.0,,8\n500,,4.2,1e-5,,8\n")
    captions = tmp_path / "caps.jsonl"
    captions.write_text(json.dumps({"clip_path": "c.wav", "caption": "x", "song_sha256": "s", "split": "test", "source": "ahmed_oud", "rights": "ahmed_ilkacase_consented", "seconds": 30.0}) + "\n")
    cfg = {"model": "facebook/musicgen-large", "rank": 128, "alpha": 256, "lr": 3e-5, "total_steps": 6000, "targets": ["q_proj", "fc1"], "captions": str(captions)}
    hist = ra.rights_histogram(captions)
    entry = ra.build_entry("demo_run", run, ckpt, "lora", cfg["model"], ra.decide_rights(hist, None), ra.corpus_text(captions), cfg, {}, None, hist, None)
    entry["listening_gate"] = entry["listening_gate"] or "not yet performed"
    norm = service.normalise_entry(entry, "test")
    assert norm is not None
    name, info = norm
    assert name == "demo_run" and info["kind"] == "lora" and info["rights"] == "releasable" and info["best_step"] == 500
    assert info["path"] == ckpt.resolve() and info["metrics"]["val_ce"] == {"base": 4.5, "adapter": 4.2}
    assert service.engine_key(name, info) == "facebook/musicgen-large"


def test_register_adapter_name_rule_is_the_services() -> None:
    """register_adapter refuses exactly the names the service would drop at start-up."""
    from scripts import register_adapter as ra

    assert ra.NAME_RE.pattern == service.NAME_RE.pattern
    for name in (".hidden", "_under", "-x", "qaraamié", "base", "bad name!", "a" * 41, "ok\n", "qaraami_large", "Ok.name-1", "7up", "a" * 40):
        served = service.normalise_entry({"name": name, "kind": "lora", "path": "p", "base": "b"}, "t") is not None
        assert served == ra.valid_name(name), name
