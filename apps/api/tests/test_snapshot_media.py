"""A published snapshot is frozen; the media domain is not.

Cards are stored in a snapshot as object keys and turned into URLs when they
are sent, so moving the public media domain reaches every already-published
flow without anyone re-publishing it.
"""
import importlib.util
import types
from pathlib import Path

import pytest
from app.config import get_settings
from app.services.content import _variant_public, card_preview_url, card_url

MIGRATION = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0010_snapshot_media_keys.py"


@pytest.fixture
def media_base(monkeypatch):
    """Point the deployment at a media domain, the way an env change would."""
    def use(url: str):
        monkeypatch.setenv("PUBLIC_MEDIA_BASE_URL", url)
        get_settings.cache_clear()
    yield use
    monkeypatch.undo()
    get_settings.cache_clear()


def _variant(**kw):
    base = dict(id="v1", status="completed", stepcard_key="cards/t1/abc.png", stepcard_preview_key="previews/t1/abc.jpg",
                replica_png_key="replicas/t1/abc.png", stepcard_width=1200, stepcard_height=2000, annotations=[])
    return types.SimpleNamespace(**(base | kw))


def test_a_snapshot_card_holds_keys_not_urls():
    pub = _variant_public(_variant())
    assert pub["stepcard_key"] == "cards/t1/abc.png" and pub["stepcard_preview_key"] == "previews/t1/abc.jpg"
    assert "stepcard_url" not in pub and "preview_url" not in pub


def test_moving_the_media_domain_moves_every_published_card(media_base):
    """The whole point: the same frozen card follows the deployment's domain."""
    card = {"stepcard_key": "cards/t1/abc.png", "stepcard_preview_key": "previews/t1/abc.jpg"}
    media_base("http://localhost:8080/media")
    assert card_url(card) == "http://localhost:8080/media/cards/t1/abc.png"
    media_base("https://sop-api.example.gov.tw/media")
    assert card_url(card) == "https://sop-api.example.gov.tw/media/cards/t1/abc.png"
    assert card_preview_url(card) == "https://sop-api.example.gov.tw/media/previews/t1/abc.jpg"


def test_a_card_without_an_image_has_no_url():
    assert card_url(None) is None and card_preview_url(None) is None
    draft = {"stepcard_key": None, "stepcard_preview_key": None, "draft_only": True}
    assert card_url(draft) is None and card_preview_url(draft) is None


def test_a_snapshot_frozen_before_the_keys_still_reads(media_base):
    """Migration 0010 rewrites them, but a version restored from an older dump
    must never leave a citizen without an image."""
    media_base("https://sop-api.example.gov.tw/media")
    old = {"stepcard_url": "http://localhost:8080/media/cards/t1/abc.png", "preview_url": "http://localhost:8080/media/previews/t1/abc.jpg"}
    assert card_url(old) == "http://localhost:8080/media/cards/t1/abc.png"
    assert card_preview_url(old) == "http://localhost:8080/media/previews/t1/abc.jpg"


# ------------------------------------------------------------------ migration 0010

def _migration():
    spec = importlib.util.spec_from_file_location("m0010", MIGRATION)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.parametrize("url, key", [
    ("http://localhost:8080/media/cards/t1/abc.png", "cards/t1/abc.png"),
    ("https://sop-api.example.gov.tw/media/previews/t1/abc.jpg", "previews/t1/abc.jpg"),
    ("http://localhost:8000/media/cards/t1/abc-n3.png", "cards/t1/abc-n3.png"),   # a numbered copy
    ("https://cdn.example.gov.tw/thumbs/t1/abc.jpg", "thumbs/t1/abc.jpg"),        # no /media/ segment at all
    ("https://example.gov.tw/media/something-else.png", None),
    ("", None), (None, None),
])
def test_the_migration_recovers_the_key_from_any_domain(url, key):
    assert _migration()._key_from_url(url) == key


def _old_snapshot():
    return {"steps": [
        {"id": "s1", "variants": {"light": {"variant_id": "v1", "stepcard_key": "cards/t1/a.png",
                                            "stepcard_url": "http://localhost:8080/media/cards/t1/a.png",
                                            "preview_url": "http://localhost:8080/media/previews/t1/a.jpg"},
                                  "dark": {"variant_id": "v2",
                                           "stepcard_url": "http://localhost:8080/media/cards/t1/b.png",
                                           "preview_url": "http://localhost:8080/media/previews/t1/b.jpg"}}},
        {"id": "s2", "variants": {}},
    ]}


def test_the_migration_turns_every_frozen_url_into_a_key():
    m = _migration()
    snap = _old_snapshot()
    assert m.to_keys(snap) is True
    light, dark = snap["steps"][0]["variants"]["light"], snap["steps"][0]["variants"]["dark"]
    assert light == {"variant_id": "v1", "stepcard_key": "cards/t1/a.png", "stepcard_preview_key": "previews/t1/a.jpg"}
    # a card that never carried a key still gets one, recovered from its URL
    assert dark == {"variant_id": "v2", "stepcard_key": "cards/t1/b.png", "stepcard_preview_key": "previews/t1/b.jpg"}
    assert m.to_keys(snap) is False  # nothing left to do, so a re-run is a no-op


def test_the_migration_is_reversible():
    m = _migration()
    snap = _old_snapshot()
    m.to_keys(snap)
    assert m.to_urls(snap, "https://sop-api.example.gov.tw/media") is True
    assert snap["steps"][0]["variants"]["light"] == {
        "variant_id": "v1",
        "stepcard_url": "https://sop-api.example.gov.tw/media/cards/t1/a.png",
        "preview_url": "https://sop-api.example.gov.tw/media/previews/t1/a.jpg",
    }


def test_the_migration_leaves_a_snapshot_without_cards_alone():
    m = _migration()
    assert m.to_keys({"steps": [{"id": "s1", "variants": {}}]}) is False
    assert list(m._variants({})) == [] and list(m._variants(None)) == []
