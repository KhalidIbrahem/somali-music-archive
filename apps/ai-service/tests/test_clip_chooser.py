import pytest

from scripts.clip_chooser import Clip, title_for, validate_selection


def _clip(prompt: str, vocals: bool = False) -> Clip:
    return Clip(id="x", source="s", path="p.wav", adapterId="oud", model="m", adapter="a",
                checkpoint="c", corpus="k", prompt=prompt, seed=1, vocals=vocals)


def test_title_from_caption():
    assert title_for(_clip("qaraami, solo oud, moderate at 110 BPM, pentatonic melody rooted on G#")) == (
        "Solo oud, 110 BPM, rooted on G♯")
    assert title_for(_clip("Somali song, male vocal, lively at 139 BPM, rooted on C", vocals=True)) == (
        "Song with vocals, lively at 139 BPM, rooted on C")


def test_selection_keeps_known_ids_and_pages_only():
    sel = validate_selection({"listenNote": "n", "clips": [
        {"id": "a", "title": "t" * 200, "pages": ["listen", "evil"]},
        {"id": "b", "pages": []},
    ]}, {"a", "b"})
    assert sel == {"listenNote": "n", "clips": [{"id": "a", "title": "t" * 80, "pages": ["listen"]}]}


def test_selection_rejects_unknown_clip():
    with pytest.raises(ValueError):
        validate_selection({"clips": [{"id": "../../etc/passwd", "pages": ["listen"]}]}, {"a"})
