"""published snapshots carry object keys, not absolute media URLs

Revision ID: 0010
Revises: 0009
"""
import json
import re
from urllib.parse import urlsplit

from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# Object keys always start at one of the public prefixes, whatever the media
# domain in front of them was when the version was published.
_KEY = re.compile(r"(?:cards|previews|thumbs)/.+$")


def _key_from_url(url: object) -> str | None:
    if not isinstance(url, str) or not url:
        return None
    m = _KEY.search(urlsplit(url).path)
    return m.group(0) if m else None


def _variants(snapshot: object):
    """Every variant dict in a snapshot, whatever shape the steps are in."""
    for step in (snapshot or {}).get("steps", []) if isinstance(snapshot, dict) else []:
        for var in (step.get("variants") or {}).values():
            if isinstance(var, dict):
                yield var


def to_keys(snapshot: dict) -> bool:
    """Replace every card's frozen URL with its object key, in place. True when
    the snapshot changed."""
    touched = False
    for var in _variants(snapshot):
        if "stepcard_url" not in var and "preview_url" not in var:
            continue
        card, preview = var.pop("stepcard_url", None), var.pop("preview_url", None)
        var["stepcard_key"] = var.get("stepcard_key") or _key_from_url(card)
        var["stepcard_preview_key"] = var.get("stepcard_preview_key") or _key_from_url(preview)
        touched = True
    return touched


def to_urls(snapshot: dict, base: str) -> bool:
    """The inverse, with `base` as the media domain. True when it changed."""
    touched = False
    for var in _variants(snapshot):
        if "stepcard_key" not in var and "stepcard_preview_key" not in var:
            continue
        card, preview = var.pop("stepcard_key", None), var.pop("stepcard_preview_key", None)
        var["stepcard_url"] = f"{base}/{card}" if card else None
        var["preview_url"] = f"{base}/{preview}" if preview else None
        touched = True
    return touched


def _rewrite(rewrite) -> None:
    conn = op.get_bind()
    for vid, snapshot in conn.execute(sa.text("SELECT id, snapshot FROM flow_versions")).fetchall():
        snap = snapshot if isinstance(snapshot, dict) else json.loads(snapshot)
        if rewrite(snap):
            conn.execute(sa.text("UPDATE flow_versions SET snapshot = CAST(:s AS json) WHERE id = :id"),
                         {"s": json.dumps(snap, ensure_ascii=False), "id": vid})


def upgrade() -> None:
    # A snapshot is frozen at publish; the media domain is not. Versions
    # published before this migration froze whatever domain the deployment used
    # at the time (a laptop's localhost, for one), so a citizen would be sent
    # image URLs that only resolved on the machine that published them.
    _rewrite(to_keys)


def downgrade() -> None:
    # Rebuild the URLs with the domain this deployment serves media from — the
    # only one it could honestly write.
    from app.config import get_settings

    base = get_settings().public_media_base_url.rstrip("/")
    _rewrite(lambda snap: to_urls(snap, base))
