"""SPEC §14 的完整跨模組劇本；所有入口都走 HTTP，外部服務用正式離線替身。"""

from __future__ import annotations

import io
import json

from app.models import Application, Notification
from app.worker import tasks
from PIL import Image
from sqlalchemy import select

from tests.sop_helpers import link_document_type, make_published_flow

USER = "U-maydru-e2e"
DOC = "BILLING_STATEMENT"


def png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 60), "white").save(out, format="PNG")
    return out.getvalue()


def line_postback(data: str) -> dict:
    return {"type": "postback", "source": {"userId": USER}, "replyToken": "rt", "postback": {"data": data}}


def line_text(text: str) -> dict:
    return {"type": "message", "source": {"userId": USER}, "replyToken": "rt",
            "message": {"type": "text", "text": text}}


def multipart(code: str, *, application: dict | None = None):
    meta = [{"document_type_code": code, "masked": False, "mime": "image/png", "page_count": 1,
             "ocr": {"text": "示範文件", "confidence": 90, "lines": []}}]
    data = {"documents": json.dumps(meta)}
    if application is not None:
        data["application"] = json.dumps(application)
    return data, [("file_0", ("document.png", png(), "image/png"))]


def single_session(db):
    class Session:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *exc):
            return False

    return lambda: Session()


async def test_submit_reject_line_sop_supplement_approve_push(
    apply_client, admin_client, auth_headers, db, tenant, scheme,
    fake_storage, line_sender, monkeypatch,
):
    """送件 → 退件 → LINE 推播/SOP → 補件 → 核准 → 推播。"""
    flow = await make_published_flow(db, tenant.id, storage=fake_storage, titles=("打開帳務", "下載帳單"))
    await link_document_type(db, tenant.id, scheme.id, DOC, flow)

    application = {
        "scheme_code": scheme.code,
        "tier_code": "GENERAL",
        "payment_channel_code": "CREDIT_CARD",
        "applicant_name": "整合測試市民",
        "phone": "0912345678",
        "id_last4": "6789",
        "tool_name": "示範工具",
        "purchase_amount": 1200,
        "purchase_date": "2026-09-01",
        "paid_by_proxy": False,
    }
    data, files = multipart("ID_CARD_FRONT", application=application)
    submitted = await apply_client.post("/api/apply/applications", data=data, files=files)
    assert submitted.status_code == 201, submitted.text
    case_no = submitted.json()["case_no"]
    assert submitted.json()["status"] == "UNDER_REVIEW"

    async def inbound(event: dict) -> list[dict]:
        response = await apply_client.post(
            "/__test__/line/inbound", json={"event": event, "tenant_id": tenant.id}
        )
        assert response.status_code == 200, response.text
        return response.json()["messages"]

    await inbound(line_postback("action=case_status"))
    await inbound(line_text(case_no))
    assert (await inbound(line_text("5678")))[0]["type"] == "flex"

    rejected = await admin_client.post(
        f"/api/admin/applications/{case_no}/transitions",
        headers=auth_headers("case_reviewer"),
        json={"code": "T2", "supplement_items": [{
            "document_type_code": DOC,
            "rejection_code": "BILLING_NO_TWD",
            "note": "請補含臺幣金額的帳單",
        }]},
    )
    assert rejected.status_code == 201 and rejected.json()["status"] == "NEEDS_REVISION"
    notification = (await db.execute(select(Notification).where(Notification.application_id == (
        await db.execute(select(Application.id).where(Application.case_no == case_no))
    ).scalar_one()).order_by(Notification.created_at.desc()))).scalars().first()
    assert notification is not None and notification.status == "queued"

    monkeypatch.setattr(tasks, "sessionmaker", lambda: single_session(db))
    assert await tasks.send_notification({}, notification.id) == "sent"
    pushed = line_sender.last("push")
    teach_action = pushed[1]["contents"]["footer"]["contents"][0]["action"]["data"]
    lesson = await inbound(line_postback(teach_action))
    # 完整 SOP 以可左右滑動的 Flex carousel 呈現，每一步的卡片在 bubble hero。
    carousels = [message for message in lesson if message.get("type") == "flex"]
    assert carousels and carousels[0]["contents"]["contents"][0]["hero"]["type"] == "image"

    verified = await apply_client.post("/api/apply/verify", json={"case_no": case_no, "last4": "5678"})
    assert verified.status_code == 200
    data, files = multipart(DOC)
    supplemented = await apply_client.post(
        f"/api/apply/applications/{case_no}/documents",
        headers={"Authorization": f"Bearer {verified.json()['token']}"}, data=data, files=files,
    )
    assert supplemented.status_code == 200 and supplemented.json()["status"] == "UNDER_REVIEW"

    approved = await admin_client.post(
        f"/api/admin/applications/{case_no}/transitions",
        headers=auth_headers("case_supervisor"), json={"code": "T3", "payload": {"approved_amount": 600}},
    )
    assert approved.status_code == 201 and approved.json()["status"] == "APPROVED"
    approval_notice = (await db.execute(
        select(Notification).where(Notification.application_id == notification.application_id,
                                   Notification.status == "queued").order_by(Notification.created_at.desc())
    )).scalars().first()
    assert approval_notice is not None and approval_notice.payload["transition_code"] == "T3"
    assert await tasks.send_notification({}, approval_notice.id) == "sent"
    assert any(case_no in message.get("text", "") for message in line_sender.last("push"))
