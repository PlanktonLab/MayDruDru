"""罐頭訊息 registry 與內容服務（SPEC §8.6）。

這一組測試守住三件事：registry 本身是完整且自洽的、`t()` 在任何情況下都回得出
一段字、以及草稿／發布／還原不會互相踩到。
"""

from __future__ import annotations

import re

import pytest
from app.content_registry import (
    BY_KEY,
    CONTENT_CATEGORIES,
    CONTENT_REGISTRY,
    CONTENT_TYPES,
    get_default,
    get_definition,
    has_key,
    keys_in_category,
)
from app.models import STATUSES, Content
from app.services import contents
from app.services.actors import Actor
from app.services.versioning import VersionConflict
from sqlalchemy import select

VAR_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")
REJECTION_CODES = (
    "BILLING_NO_TWD", "BILLING_NO_CARD_DIGITS", "BILLING_UNREADABLE", "BILLING_AMOUNT_MISMATCH",
    "CARD_DIGITS_MISMATCH", "ID_ADDRESS_UNCLEAR", "ID_NOT_HSINCHU", "OVER_MASKED",
    "AFFIDAVIT_NO_SIGNATURE", "DOC_MISSING", "TOOL_NOT_ELIGIBLE", "OTHER",
)
STAFF = Actor(type="STAFF", id="u" * 32, role="admin", name="測試管理者")


# ------------------------------------------------------------ registry 不變式

def test_keys_are_unique():
    keys = [d.key for d in CONTENT_REGISTRY]
    assert len(keys) == len(set(keys))
    assert len(BY_KEY) == len(CONTENT_REGISTRY)


def test_every_placeholder_is_declared():
    """預設值裡出現的 `{{var}}` 一定要宣告，否則後台的缺變數警告會漏掉它。"""
    for d in CONTENT_REGISTRY:
        assert sorted(set(VAR_RE.findall(d.default))) == sorted(set(d.variables)), d.key


def test_every_declared_variable_appears_in_the_default():
    for d in CONTENT_REGISTRY:
        for name in d.variables:
            assert f"{{{{{name}}}}}" in d.default.replace("{{ ", "{{").replace(" }}", "}}"), (d.key, name)


def test_categories_and_types_are_known():
    ids = {c.id for c in CONTENT_CATEGORIES}
    for d in CONTENT_REGISTRY:
        assert d.category in ids, d.key
        assert d.content_type in CONTENT_TYPES, d.key


def test_category_labels_are_unique():
    """側邊欄不該出現兩個同名分類。"""
    labels = [c.label for c in CONTENT_CATEGORIES]
    assert len(labels) == len(set(labels))


@pytest.mark.parametrize("status", STATUSES)
@pytest.mark.parametrize("suffix", ["public_label", "staff_label", "next_action", "notify_headline"])
def test_every_status_has_four_keys(status, suffix):
    key = f"status.{status}.{suffix}"
    assert has_key(key), key
    assert get_default(key).strip()


@pytest.mark.parametrize("code", REJECTION_CODES)
def test_every_rejection_code_explains_what_and_how(code):
    for suffix in ("public_what_wrong", "public_how_to_fix"):
        key = f"rejection.{code}.{suffix}"
        assert has_key(key), key
        assert get_default(key).strip()


@pytest.mark.parametrize("code", ["T2", "T3", "T7", "T8", "T9", "T11"])
def test_every_notifying_transition_has_a_template(code):
    d = get_definition(f"notify.{code}")
    assert d is not None
    assert "headline" in d.variables and "case_no" in d.variables


def test_supplement_template_carries_the_deadline():
    assert "deadline" in get_definition("notify.T2").variables


def test_legacy_youth_keys_survived_the_port():
    """搬遷過來的舊 key 不能改名，否則舊資料庫裡承辦人改過的字就對不上了。"""
    for key in ("home.welcome", "home.unknown", "case.ask_case_id", "case.verify_failed",
                "mycase.empty", "subsidy.menu_intro", "apply.checklist_missing", "faq.menu_intro",
                "contact.title", "notify.footer", "security.disclaimer", "error.system_busy",
                "button.case_status"):
        assert has_key(key), key


def test_sop_templates_keep_single_brace_placeholders():
    """`sop.template.*` 由 policy.py 以 `.format()` 代入，不走 `{{var}}`。"""
    d = get_definition("sop.template.greeting")
    assert d is not None and d.variables == ()
    assert "{name}" in d.default


def test_keys_in_category_is_sorted_and_scoped():
    keys = keys_in_category("status")
    assert keys and all(k.startswith("status.") for k in keys)
    assert get_definition(keys[0]).sort_order <= get_definition(keys[-1]).sort_order


def test_unknown_key_degrades_quietly():
    assert get_definition("nope.nope") is None
    assert get_default("nope.nope") == ""
    assert has_key("nope.nope") is False
    assert keys_in_category("nope") == ()


# --------------------------------------------------------------- t / tf / render

async def test_t_falls_back_to_the_registry_default(db, tenant):
    assert await contents.t(db, tenant.id, "home.welcome") == get_default("home.welcome")


async def test_t_never_raises_for_an_unknown_key(db, tenant):
    assert await contents.t(db, tenant.id, "nope.nope") == ""


async def test_a_blank_stored_value_falls_back(db, tenant):
    """空字串會讓 LINE 送出一顆空泡泡，所以空白一律當成沒有設定。"""
    db.add(Content(tenant_id=tenant.id, key="home.welcome", content="   "))
    await db.commit()
    assert await contents.t(db, tenant.id, "home.welcome") == get_default("home.welcome")


async def test_tf_substitutes_declared_variables(db, tenant):
    text = await contents.tf(db, tenant.id, "mycase.subtitle", count=3)
    assert "3" in text and "{{" not in text


def test_unknown_placeholders_are_left_in_place():
    assert contents.substitute("嗨 {{name}} 與 {{other}}", {"name": "小明"}) == "嗨 小明 與 {{other}}"


def test_substitution_tolerates_inner_whitespace():
    assert contents.substitute("{{ count }}", {"count": 2}) == "2"


async def test_render_reports_the_declared_type(db, tenant):
    assert (await contents.render(db, tenant.id, "button.cancel"))["type"] == "button"
    assert (await contents.render(db, tenant.id, "home.welcome"))["type"] == "text"


async def test_render_parses_a_flex_row(db, tenant):
    db.add(Content(tenant_id=tenant.id, key="custom.flex", content='{"type": "bubble"}', content_type="flex"))
    await db.commit()
    assert (await contents.render(db, tenant.id, "custom.flex"))["flex"] == {"type": "bubble"}


async def test_broken_flex_json_degrades_to_text(db, tenant):
    db.add(Content(tenant_id=tenant.id, key="custom.flex", content="{ not json", content_type="flex"))
    await db.commit()
    assert (await contents.render(db, tenant.id, "custom.flex"))["type"] == "text"


# ------------------------------------------------------------------- 快取

async def test_the_cache_is_invalidated_on_publish(db, tenant):
    before = await contents.t(db, tenant.id, "home.unknown")
    await contents.publish(db, tenant.id, "home.unknown", "新的說法", actor=STAFF)
    await db.commit()
    assert await contents.t(db, tenant.id, "home.unknown") == "新的說法"
    assert before != "新的說法"


async def test_a_direct_row_change_is_not_seen_until_invalidated(db, tenant):
    """快取存在才有意義：沒走 service 的寫入不會被看見，這正是 invalidate 的理由。"""
    await contents.sync_defaults(db, tenant.id)
    await db.commit()
    first = await contents.t(db, tenant.id, "home.welcome")
    row = (await db.execute(select(Content).where(Content.key == "home.welcome"))).scalar_one()
    row.content = "偷改的"
    await db.commit()
    assert await contents.t(db, tenant.id, "home.welcome") == first
    contents.invalidate(tenant.id)
    assert await contents.t(db, tenant.id, "home.welcome") == "偷改的"


# -------------------------------------------------------------- sync_defaults

async def test_sync_defaults_inserts_every_key_once(db, tenant):
    first = await contents.sync_defaults(db, tenant.id)
    await db.commit()
    assert first["inserted"] == len(CONTENT_REGISTRY)
    second = await contents.sync_defaults(db, tenant.id)
    await db.commit()
    assert second["inserted"] == 0


async def test_sync_defaults_never_overwrites_edited_text(db, tenant):
    """搬遷進來的舊文案必須活過每一次部署。"""
    db.add(Content(tenant_id=tenant.id, key="home.welcome", content="舊系統搬過來的歡迎詞", category="x", title="x"))
    await db.commit()
    await contents.sync_defaults(db, tenant.id)
    await db.commit()
    row = (await db.execute(select(Content).where(Content.key == "home.welcome"))).scalar_one()
    assert row.content == "舊系統搬過來的歡迎詞"
    assert row.category == "home"        # 中繼資料還是會被刷新
    assert row.title == get_definition("home.welcome").title


async def test_sync_defaults_keeps_a_draft(db, tenant):
    db.add(Content(tenant_id=tenant.id, key="home.welcome", content="舊的", draft="正在改"))
    await db.commit()
    await contents.sync_defaults(db, tenant.id)
    await db.commit()
    row = (await db.execute(select(Content).where(Content.key == "home.welcome"))).scalar_one()
    assert row.draft == "正在改"


# --------------------------------------------------- 草稿 / 發布 / 還原

async def test_a_draft_does_not_change_what_line_reads(db, tenant):
    await contents.save_draft(db, tenant.id, "home.unknown", "草稿版本", actor=STAFF)
    await db.commit()
    assert await contents.t(db, tenant.id, "home.unknown") == get_default("home.unknown")


async def test_publishing_a_draft_clears_it(db, tenant):
    await contents.save_draft(db, tenant.id, "home.unknown", "草稿版本", actor=STAFF)
    view = await contents.publish_draft(db, tenant.id, "home.unknown", actor=STAFF)
    await db.commit()
    assert view.content == "草稿版本"
    assert view.draft is None
    assert view.has_draft is False


async def test_publish_records_who_and_when(db, tenant):
    view = await contents.publish(db, tenant.id, "home.unknown", "新文案", actor=STAFF)
    await db.commit()
    assert view.published_by == STAFF.id
    assert view.published_at is not None


async def test_publish_bumps_the_version(db, tenant):
    first = await contents.publish(db, tenant.id, "home.unknown", "一", actor=STAFF)
    second = await contents.publish(db, tenant.id, "home.unknown", "二", actor=STAFF)
    await db.commit()
    assert second.version == first.version + 1


async def test_publishing_the_same_text_writes_no_audit(db, tenant):
    from app.models import AuditLog

    await contents.publish(db, tenant.id, "home.unknown", "一樣的字", actor=STAFF)
    await db.commit()
    before = len((await db.execute(select(AuditLog).where(AuditLog.action == "publish"))).scalars().all())
    await contents.publish(db, tenant.id, "home.unknown", "一樣的字", actor=STAFF)
    await db.commit()
    after = len((await db.execute(select(AuditLog).where(AuditLog.action == "publish"))).scalars().all())
    assert after == before


async def test_reset_restores_the_shipped_text_and_always_audits(db, tenant):
    from app.models import AuditLog

    await contents.publish(db, tenant.id, "home.unknown", "改過的", actor=STAFF)
    view = await contents.reset(db, tenant.id, "home.unknown", actor=STAFF)
    await db.commit()
    assert view.content == get_default("home.unknown")
    assert view.customised is False
    resets = (await db.execute(select(AuditLog).where(AuditLog.action == "reset"))).scalars().all()
    assert len(resets) == 1


async def test_reset_does_not_also_log_a_publish(db, tenant):
    """一次還原就是一件事，稽核不該出現兩筆在講同一次操作。"""
    from app.models import AuditLog

    await contents.publish(db, tenant.id, "home.unknown", "改過的", actor=STAFF)
    await db.commit()
    before = len((await db.execute(select(AuditLog).where(AuditLog.action == "publish"))).scalars().all())
    await contents.reset(db, tenant.id, "home.unknown", actor=STAFF)
    await db.commit()
    after = len((await db.execute(select(AuditLog).where(AuditLog.action == "publish"))).scalars().all())
    assert after == before


async def test_version_conflict_is_refused(db, tenant):
    row = await contents.get_or_create(db, tenant.id, "home.unknown")
    await db.commit()
    with pytest.raises(VersionConflict):
        await contents.publish(db, tenant.id, "home.unknown", "別人先存了", actor=STAFF,
                               expected_version=row.version + 5)


async def test_get_or_create_writes_a_row_so_there_is_a_version_to_lock(db, tenant):
    row = await contents.get_or_create(db, tenant.id, "contact.hours")
    await db.commit()
    assert row.version >= 1
    assert row.content == get_default("contact.hours")


async def test_get_or_create_refuses_an_unknown_key(db, tenant):
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        await contents.get_or_create(db, tenant.id, "nope.nope")


# ------------------------------------------------------------- 列表與統計

async def test_list_filters_by_category_and_query(db, tenant):
    rows = await contents.list_contents(db, tenant.id, category="status")
    await db.commit()
    assert rows and all(v.category == "status" for v in rows)
    hits = await contents.list_contents(db, tenant.id, q="welcome")
    assert any(v.key == "home.welcome" for v in hits)


async def test_stats_counts_customised_and_drafts(db, tenant):
    await contents.publish(db, tenant.id, "home.unknown", "改過", actor=STAFF)
    await contents.save_draft(db, tenant.id, "home.welcome", "草稿", actor=STAFF)
    await db.commit()
    stats = await contents.stats(db, tenant.id)
    assert stats["customised"] == 1
    assert stats["drafts"] == 1
    assert stats["registry"] == len(CONTENT_REGISTRY)


# --------------------------------------------------------------------- 預覽

async def test_preview_substitutes_sample_variables(db, tenant):
    result = await contents.preview(db, tenant.id, "mycase.subtitle")
    assert contents.SAMPLE_VARIABLES["count"] in result["rendered"]
    assert result["missing_variables"] == []


async def test_preview_flags_a_dropped_variable(db, tenant):
    result = await contents.preview(db, tenant.id, "mycase.subtitle", "沒有變數的版本")
    assert result["missing_variables"] == ["count"]


async def test_preview_attaches_quick_replies_where_they_appear(db, tenant):
    assert await contents.preview(db, tenant.id, "home.unknown") != {}
    assert (await contents.preview(db, tenant.id, "home.unknown"))["quick_replies"]
    assert (await contents.preview(db, tenant.id, "case.field.case_id"))["quick_replies"] == []


async def test_preview_renders_every_surface_through_the_real_builders(db, tenant):
    from app.services.line.flex import PREVIEW_SURFACES

    result = await contents.preview(db, tenant.id, "home.welcome")
    assert [s["id"] for s in result["surfaces"]] == list(PREVIEW_SURFACES)
    assert all(s["messages"] for s in result["surfaces"])


async def test_preview_surface_case_card_is_a_flex_bubble(db, tenant):
    result = await contents.preview(db, tenant.id, "case.card_eyebrow")
    card = next(s for s in result["surfaces"] if s["id"] == "case_card")
    assert card["messages"][0]["type"] == "flex"
    assert card["messages"][0]["contents"]["type"] == "bubble"
