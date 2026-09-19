"""假資料同步 (SPEC §6.5): what Agent B reports it invented on one screen, and
how those values become the platform's shared 示範資料.

A replica reports every piece of fake data it placed. Each row is either 沿用
— a field that was already in the platform's 示範資料 — or 新增, something the
agent had to make up because nobody had thought of it (a card's 刷卡時間, say).
Left alone, the next screen invents a different one; adopted, the whole batch
tells one story. This module is the only place that decides which is which,
so the pipeline, the API and the tests agree.

Dependency-free on purpose (no models, no schemas): the ingestion graph and
the router both reach for it.
"""

from __future__ import annotations

import re

SHARED, NEW = "shared", "new"
KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")
MAX_LABEL, MAX_VALUE = 40, 60


def _text(v) -> str:
    return str(v or "").strip()


def key_from(label: str, taken: set[str]) -> str:
    """A key for a field the agent named. Model-supplied keys are ASCII words
    we can keep; a Chinese label has none, so it gets a short generated one."""
    base = re.sub(r"[^a-z0-9_]+", "_", _text(label).lower()).strip("_")[:36]
    if not base or not base[0].isalpha():
        base = f"field{len(taken) + 1}"
    key = base
    n = 2
    while key in taken or not KEY_RE.match(key):
        key = f"{base}_{n}"[:40]
        n += 1
    return key


def annotate(rows: list, demo_data: list[dict] | None) -> list[dict]:
    """Agent B's report → [{key, label, value, source}], newest wording kept.

    Rows arrive as objects; a plain string is a replica made before the report
    was structured, and counts as 新增 with no field name. A row is 沿用 when
    it names a 示範資料 key or repeats one of its values verbatim.
    """
    fields = [f for f in (demo_data or []) if isinstance(f, dict)]
    by_key = {_text(f.get("key")): f for f in fields if _text(f.get("key"))}
    by_value = {_text(f.get("value")): f for f in fields if _text(f.get("value"))}
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for row in rows or []:
        if isinstance(row, str):
            key, label, value = "", "", _text(row)
        elif isinstance(row, dict):
            key, label, value = _text(row.get("key")), _text(row.get("label")), _text(row.get("value"))
        else:
            continue
        if not value and not label:
            continue
        shared = by_key.get(key) or by_value.get(value)
        if shared is not None:
            key, label = _text(shared.get("key")), _text(shared.get("label")) or label
            value = _text(shared.get("value")) or value
        else:
            key = ""
        dedupe = (label, value)
        if dedupe in seen:
            continue
        seen.add(dedupe)
        out.append({"key": key, "label": label[:MAX_LABEL], "value": value[:MAX_VALUE],
                    "source": SHARED if shared is not None else NEW})
    return out


def unreviewed_count(rows: list) -> int:
    """How many of a replica's reported values are not in the shared set yet."""
    return sum(1 for r in rows or [] if isinstance(r, dict) and r.get("source") == NEW)


def merge(demo_data: list[dict] | None, picks: list[dict]) -> list[dict]:
    """Fold the clerk's choices into the platform's 示範資料: a pick carrying a
    known key rewrites that field (they edited a value everything else uses), as
    does one whose name is already in the set — two screens reporting 刷卡時間
    must not leave the platform with two of them. Anything else is appended.
    Order is kept so the panel does not reshuffle under them."""
    out = [dict(f) for f in (demo_data or []) if isinstance(f, dict)]
    index = {_text(f.get("key")): i for i, f in enumerate(out) if _text(f.get("key"))}
    by_label = {_text(f.get("label")): i for i, f in enumerate(out) if _text(f.get("label"))}
    taken = set(index)
    for p in picks:
        label, value = _text(p.get("label")), _text(p.get("value"))
        if not label:
            continue
        key = _text(p.get("key"))
        i = index.get(key, by_label.get(label) if not key else None)
        if i is not None:
            out[i] = {"key": out[i].get("key"), "label": label, "value": value}
            continue
        key = key if KEY_RE.match(key) and key not in taken else key_from(label, taken)
        taken.add(key)
        index[key] = len(out)
        by_label[label] = len(out)
        out.append({"key": key, "label": label, "value": value})
    return out


def value_changes(report: list, picks: list[dict]) -> list[dict]:
    """Which words on the finished replica the picks actually change: what the
    replica reported showing, paired with what the clerk typed. A pick says so
    itself with `replaces`; otherwise the row is found by key, then by name."""
    rows = [r for r in report or [] if isinstance(r, dict)]
    out: list[dict] = []
    seen: set[str] = set()
    for p in picks:
        new_value, key = _text(p.get("value")), _text(p.get("key"))
        label = _text(p.get("label"))
        old = _text(p.get("replaces"))
        if not old:
            row = (next((r for r in rows if key and _text(r.get("key")) == key), None)
                   or next((r for r in rows if label and _text(r.get("label")) == label), None))
            old = _text((row or {}).get("value"))
        if old and new_value and old != new_value and old not in seen:
            seen.add(old)
            out.append({"old": old, "new": new_value})
    return out


def regenerate_feedback(picks: list[dict]) -> str:
    """The instruction sent back to Agent B when the clerk corrected a value:
    the screen has to be redrawn with the agreed values, nothing else. Empty
    when there is nothing to say, so the API can refuse the request."""
    lines = [f"- {_text(p.get('label'))}：{_text(p.get('value'))}" for p in picks if _text(p.get("label"))]
    if not lines:
        return ""
    return ("審核者調整了這頁的假資料，請把畫面上對應的內容改成下列的值，其餘版面與內容維持不變：\n"
            + "\n".join(lines))
