"""`/api/admin/contents`、`/faqs`、`/knowledge`、`/line/*` 與公開的 `/api/contents`。

Router 是薄殼，所以這裡驗的是殼該負責的三件事：誰能進來（capability）、
樂觀鎖有沒有轉成 409、以及回應有沒有把 service 的結果完整交出去。
"""

from __future__ import annotations

import pytest
from app.models import Faq, KnowledgeDocument, UnmatchedMessage
from sqlalchemy import select

READERS = ["case_reviewer", "sop_editor", "viewer"]
NON_ADMINS = ["case_reviewer", "case_supervisor", "sop_editor", "viewer"]


# --------------------------------------------------------------- contents

async def test_listing_contents_needs_a_login(client, tenant):
    assert (await client.get("/api/admin/contents")).status_code == 401


@pytest.mark.parametrize("role", READERS)
async def test_any_member_of_staff_may_read_the_copy(client, tenant, auth_headers, role):
    r = await client.get("/api/admin/contents", headers=auth_headers(role))
    assert r.status_code == 200
    assert r.json()["items"] and r.json()["categories"]


async def test_the_listing_can_be_filtered_by_category(client, tenant, auth_headers):
    r = await client.get("/api/admin/contents?category=status", headers=auth_headers("admin"))
    assert {i["category"] for i in r.json()["items"]} == {"status"}


async def test_the_listing_carries_the_stats(client, tenant, auth_headers):
    stats = (await client.get("/api/admin/contents", headers=auth_headers("admin"))).json()["stats"]
    assert stats["total"] == stats["registry"]
    assert stats["customised"] == 0


async def test_reading_one_key_creates_the_row_to_lock_against(client, tenant, auth_headers):
    r = await client.get("/api/admin/contents/home.welcome", headers=auth_headers("admin"))
    assert r.status_code == 200
    assert r.json()["version"] >= 1
    assert r.json()["default"] == r.json()["content"]


@pytest.mark.parametrize("role", NON_ADMINS)
async def test_only_admin_may_save_a_draft(client, tenant, auth_headers, role):
    r = await client.put("/api/admin/contents/home.welcome", json={"draft": "x"}, headers=auth_headers(role))
    assert r.status_code == 403


async def test_admin_saves_a_draft_without_publishing_it(client, tenant, auth_headers):
    r = await client.put("/api/admin/contents/home.welcome", json={"draft": "草稿"},
                         headers=auth_headers("admin"))
    assert r.status_code == 200
    body = r.json()
    assert body["draft"] == "草稿" and body["has_draft"] is True
    assert body["content"] != "草稿"


async def test_publishing_without_a_body_promotes_the_draft(client, tenant, auth_headers):
    await client.put("/api/admin/contents/home.welcome", json={"draft": "草稿"}, headers=auth_headers("admin"))
    r = await client.post("/api/admin/contents/home.welcome/publish", json={},
                          headers=auth_headers("admin"))
    assert r.json()["content"] == "草稿"
    assert r.json()["draft"] is None


async def test_publishing_with_a_body_wins(client, tenant, auth_headers):
    r = await client.post("/api/admin/contents/home.welcome/publish", json={"content": "直接發這段"},
                          headers=auth_headers("admin"))
    assert r.json()["content"] == "直接發這段"


@pytest.mark.parametrize("role", NON_ADMINS)
async def test_only_admin_may_publish(client, tenant, auth_headers, role):
    r = await client.post("/api/admin/contents/home.welcome/publish", json={"content": "x"},
                          headers=auth_headers(role))
    assert r.status_code == 403


async def test_a_stale_version_is_refused_with_409(client, tenant, auth_headers):
    current = (await client.get("/api/admin/contents/home.welcome", headers=auth_headers("admin"))).json()
    r = await client.post("/api/admin/contents/home.welcome/publish",
                          json={"content": "x", "expected_version": current["version"] + 3},
                          headers=auth_headers("admin"))
    assert r.status_code == 409


async def test_the_matching_version_is_accepted(client, tenant, auth_headers):
    current = (await client.get("/api/admin/contents/home.welcome", headers=auth_headers("admin"))).json()
    r = await client.post("/api/admin/contents/home.welcome/publish",
                          json={"content": "x", "expected_version": current["version"]},
                          headers=auth_headers("admin"))
    assert r.status_code == 200


async def test_reset_restores_the_shipped_copy(client, tenant, auth_headers):
    await client.post("/api/admin/contents/home.welcome/publish", json={"content": "改過"},
                      headers=auth_headers("admin"))
    r = await client.post("/api/admin/contents/home.welcome/reset", json={}, headers=auth_headers("admin"))
    assert r.json()["customised"] is False


async def test_preview_returns_rendered_text_and_surfaces(client, tenant, auth_headers):
    r = await client.post("/api/admin/contents/preview",
                          json={"key": "mycase.subtitle", "text": "共 {{count}} 件"},
                          headers=auth_headers("case_reviewer"))
    body = r.json()
    assert "2" in body["rendered"]
    assert body["missing_variables"] == []
    assert len(body["surfaces"]) >= 5


async def test_preview_of_an_unknown_key_does_not_explode(client, tenant, auth_headers):
    r = await client.post("/api/admin/contents/preview", json={"key": "nope.nope", "text": "x"},
                          headers=auth_headers("admin"))
    assert r.status_code == 200


# ------------------------------------------------------- 公開的 /api/contents

async def test_the_public_endpoint_returns_published_values(client, tenant, auth_headers):
    await client.post("/api/admin/contents/home.welcome/publish", json={"content": "發布版"},
                      headers=auth_headers("admin"))
    r = await client.get("/api/contents?keys=home.welcome,home.unknown")
    assert r.status_code == 200
    assert r.json()["items"]["home.welcome"] == "發布版"


async def test_the_public_endpoint_never_shows_a_draft(client, tenant, auth_headers):
    await client.put("/api/admin/contents/home.welcome", json={"draft": "還在改"}, headers=auth_headers("admin"))
    r = await client.get("/api/contents?keys=home.welcome")
    assert r.json()["items"]["home.welcome"] != "還在改"


async def test_the_public_endpoint_can_fetch_a_whole_category(client, tenant):
    r = await client.get("/api/contents?category=rejection")
    assert len(r.json()["items"]) == 24


async def test_the_public_render_endpoint_substitutes_variables(client, tenant):
    r = await client.post("/api/contents/render", json={"key": "mycase.subtitle", "variables": {"count": 7}})
    assert r.json()["type"] == "label"
    assert "7" in r.json()["text"]


# -------------------------------------------------------------------- FAQ

async def test_listing_faqs_is_open_to_staff(client, tenant, auth_headers):
    r = await client.get("/api/admin/faqs", headers=auth_headers("case_reviewer"))
    assert r.status_code == 200 and r.json()["items"] == []


@pytest.mark.parametrize("role", NON_ADMINS)
async def test_only_admin_may_create_a_faq(client, tenant, auth_headers, role):
    r = await client.post("/api/admin/faqs", json={"question": "x"}, headers=auth_headers(role))
    assert r.status_code == 403


async def test_creating_updating_and_deleting_a_faq(client, tenant, auth_headers, db):
    created = await client.post("/api/admin/faqs",
                                json={"question": "審查要多久？", "answer": "五天", "keywords": ["審查"]},
                                headers=auth_headers("admin"))
    assert created.status_code == 201
    faq_id = created.json()["id"]

    updated = await client.put(f"/api/admin/faqs/{faq_id}",
                               json={"question": "審查要多久？", "answer": "三天",
                                     "expected_version": created.json()["version"]},
                               headers=auth_headers("admin"))
    assert updated.json()["answer"] == "三天"

    assert (await client.delete(f"/api/admin/faqs/{faq_id}", headers=auth_headers("admin"))).status_code == 204
    assert (await db.execute(select(Faq))).scalars().all() == []


async def test_a_stale_faq_version_is_a_409(client, tenant, auth_headers):
    created = await client.post("/api/admin/faqs", json={"question": "x"}, headers=auth_headers("admin"))
    r = await client.put(f"/api/admin/faqs/{created.json()['id']}",
                         json={"question": "y", "expected_version": 99}, headers=auth_headers("admin"))
    assert r.status_code == 409


async def test_a_faq_can_be_switched_off(client, tenant, auth_headers):
    created = await client.post("/api/admin/faqs", json={"question": "x"}, headers=auth_headers("admin"))
    r = await client.post(f"/api/admin/faqs/{created.json()['id']}/status", json={"active": False},
                          headers=auth_headers("admin"))
    assert r.json()["active"] is False


async def test_an_unknown_faq_is_a_404(client, tenant, auth_headers):
    r = await client.post("/api/admin/faqs/nope/status", json={"active": True}, headers=auth_headers("admin"))
    assert r.status_code == 404


# --------------------------------------------------------------- 知識文件

async def test_creating_and_reading_a_knowledge_document(client, tenant, auth_headers, db):
    created = await client.post("/api/admin/knowledge",
                                json={"title": "簡章", "content": "全文", "tags": ["規範"]},
                                headers=auth_headers("admin"))
    assert created.status_code == 201
    got = await client.get(f"/api/admin/knowledge/{created.json()['id']}", headers=auth_headers("viewer"))
    assert got.json()["title"] == "簡章"
    assert (await db.execute(select(KnowledgeDocument))).scalars().all()


@pytest.mark.parametrize("role", NON_ADMINS)
async def test_only_admin_may_write_knowledge(client, tenant, auth_headers, role):
    r = await client.post("/api/admin/knowledge", json={"title": "x"}, headers=auth_headers(role))
    assert r.status_code == 403


async def test_deleting_a_knowledge_document(client, tenant, auth_headers):
    created = await client.post("/api/admin/knowledge", json={"title": "x"}, headers=auth_headers("admin"))
    r = await client.delete(f"/api/admin/knowledge/{created.json()['id']}", headers=auth_headers("admin"))
    assert r.status_code == 204


# ------------------------------------------------------------------ LINE

async def test_rich_menu_status_is_readable_by_staff(client, tenant, auth_headers):
    r = await client.get("/api/admin/line/richmenu", headers=auth_headers("case_reviewer"))
    assert r.status_code == 200
    assert len(r.json()["tiles"]) == 6


@pytest.mark.parametrize("role", NON_ADMINS)
async def test_only_admin_may_sync_the_rich_menu(client, tenant, auth_headers, role):
    r = await client.post("/api/admin/line/richmenu/sync", headers=auth_headers(role))
    assert r.status_code == 403


async def test_syncing_the_rich_menu_returns_the_live_status(client, tenant, auth_headers, rich_menu_client,
                                                             monkeypatch):
    from app.services.line import richmenu

    monkeypatch.setattr(richmenu.storage, "put", lambda *a, **k: "ok")
    r = await client.post("/api/admin/line/richmenu/sync", headers=auth_headers("admin"))
    assert r.status_code == 200
    assert r.json()["state"] == "synced"
    assert r.json()["status"]["state"] == "not_configured"   # 測試環境沒有接真的 LINE


async def test_a_failed_sync_is_a_502_not_a_cheerful_200(client, tenant, auth_headers, rich_menu_client):
    files = {"image": ("bad.png", b"not an image", "image/png")}
    r = await client.post("/api/admin/line/richmenu/sync", files=files, headers=auth_headers("admin"))
    assert r.status_code == 502


async def test_sync_logs_are_listed(client, tenant, auth_headers, rich_menu_client, monkeypatch):
    from app.services.line import richmenu

    monkeypatch.setattr(richmenu.storage, "put", lambda *a, **k: "ok")
    await client.post("/api/admin/line/richmenu/sync", headers=auth_headers("admin"))
    r = await client.get("/api/admin/line/sync-logs", headers=auth_headers("viewer"))
    assert r.json()["items"][0]["status"] == "synced"


async def test_notifications_are_listed_with_their_case_number(client, tenant, scheme, auth_headers, db):
    from tests.test_state_machine import drive, make_case

    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3")
    r = await client.get("/api/admin/line/notifications", headers=auth_headers("case_reviewer"))
    assert r.json()["items"][0]["case_no"] == app.case_no
    assert r.json()["items"][0]["transition_code"] == "T3"


async def test_notifications_can_be_filtered_by_status(client, tenant, scheme, auth_headers, db):
    from tests.test_state_machine import drive, make_case

    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3")
    assert (await client.get("/api/admin/line/notifications?status=sent",
                             headers=auth_headers("admin"))).json()["items"] == []


async def test_unmatched_messages_are_listed_without_the_user_id(client, tenant, auth_headers, db):
    db.add(UnmatchedMessage(tenant_id=tenant.id, line_user_id_hash="a" * 64, text="看不懂的問題"))
    await db.commit()
    item = (await client.get("/api/admin/line/unmatched", headers=auth_headers("viewer"))).json()["items"][0]
    assert item["text"] == "看不懂的問題"
    assert len(item["user_hash"]) == 8


async def test_dismissing_an_unmatched_message(client, tenant, auth_headers, db):
    db.add(UnmatchedMessage(tenant_id=tenant.id, line_user_id_hash="a" * 64, text="x"))
    await db.commit()
    row = (await db.execute(select(UnmatchedMessage))).scalars().one()
    assert (await client.delete(f"/api/admin/line/unmatched/{row.id}",
                                headers=auth_headers("admin"))).status_code == 204
    assert (await db.execute(select(UnmatchedMessage))).scalars().all() == []


@pytest.mark.parametrize("role", NON_ADMINS)
async def test_only_admin_may_dismiss_an_unmatched_message(client, tenant, auth_headers, role):
    r = await client.delete("/api/admin/line/unmatched/whatever", headers=auth_headers(role))
    assert r.status_code == 403


# ------------------------------------------------------------------ 媒體

@pytest.mark.parametrize("role", NON_ADMINS)
async def test_only_admin_may_upload_media(client, tenant, auth_headers, role):
    files = {"file": ("a.png", b"x", "image/png")}
    assert (await client.post("/api/admin/media", files=files, headers=auth_headers(role))).status_code == 403


async def test_an_unsupported_media_type_is_refused(client, tenant, auth_headers):
    files = {"file": ("a.txt", b"x", "text/plain")}
    r = await client.post("/api/admin/media", files=files, headers=auth_headers("admin"))
    assert r.status_code == 400


async def test_uploading_an_image_returns_its_public_url(client, tenant, auth_headers, monkeypatch):
    from app.services import knowledge

    monkeypatch.setattr(knowledge.storage, "put", lambda *a, **k: "ok")
    files = {"file": ("a.png", b"pretend png", "image/png")}
    r = await client.post("/api/admin/media", files=files, headers=auth_headers("admin"))
    assert r.status_code == 201
    assert r.json()["key"].startswith("media/")
    assert r.json()["url"].endswith(r.json()["key"])


async def test_the_media_route_serves_the_media_prefix():
    from app.routers.media import PUBLIC_PREFIXES

    assert "media/" in PUBLIC_PREFIXES
