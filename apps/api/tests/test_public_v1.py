"""The non-SOP `/v1` contract reuses the same domain services (SPEC §10.1)."""

from app.models import ApiKey, Content, Faq
from app.security import hash_api_key


async def api_headers(db, tenant) -> dict[str, str]:
    raw = "v1-admin-key"
    db.add(ApiKey(tenant_id=tenant.id, name="v1", prefix=raw[:8], key_hash=hash_api_key(raw), scopes=["admin"]))
    await db.commit()
    return {"Authorization": f"Bearer {raw}"}


async def test_scheme_application_transition_and_timeline(client, db, tenant, scheme):
    headers = await api_headers(db, tenant)
    schemes = await client.get("/v1/schemes", headers=headers)
    assert schemes.status_code == 200 and schemes.json()[0]["code"] == scheme.code
    assert (await client.get(f"/v1/schemes/{scheme.code}", headers=headers)).json()["name"] == scheme.name
    subscription = await client.post("/v1/webhooks", headers=headers, json={
        "url": "https://example.test/events",
        "events": ["application.created", "application.document_uploaded", "application.status_changed"],
    })
    assert subscription.status_code == 201

    created = await client.post("/v1/applications", headers=headers, json={
        "scheme": scheme.code, "applicant_name": "王小明", "phone": "0912345678",
        "id_number": "A123456789", "tier_code": "GENERAL", "payment_channel_code": "CREDIT_CARD",
        "documents": [{"document_type_code": "ID_CARD_FRONT", "object_key": "private/a.png",
                       "mime": "image/png", "size": 123, "ocr": {"text": "王小明", "confidence": 0.9}}],
    })
    assert created.status_code == 201
    case_no = created.json()["case_no"]
    assert created.json()["status"] == "UNDER_REVIEW"
    outbound = (await client.get("/v1/webhook-deliveries", headers=headers)).json()
    assert {row["event"] for row in outbound} == {
        "application.created", "application.document_uploaded", "application.status_changed",
    }
    assert (await client.get(f"/v1/applications/{case_no}", headers=headers)).json()["case_no"] == case_no

    added = await client.post(f"/v1/applications/{case_no}/documents", headers=headers, json={
        "documents": [{"document_type_code": "BILLING_STATEMENT", "object_key": "private/b.png"}],
    })
    assert added.status_code == 201 and added.json()["documents"][0]["revision"] == 0

    moved = await client.post(f"/v1/applications/{case_no}/transitions", headers=headers, json={
        "transition_code": "T2", "supplement_items": [{"document_type_code": "BILLING_STATEMENT"}],
    })
    assert moved.status_code == 200 and moved.json()["to_status"] == "NEEDS_REVISION"
    events = (await client.get(f"/v1/applications/{case_no}/events", headers=headers)).json()
    assert [row["transition_code"] for row in events] == ["T0", "T1", "T2"]
    notices = (await client.get(f"/v1/notifications?case_no={case_no}", headers=headers)).json()
    assert len(notices) == 1 and notices[0]["case_no"] == case_no

    finding = await client.put(f"/v1/applications/{case_no}/findings/MUST_HAVE_ID", headers=headers,
                               json={"status": "MATCH", "confidence": 1})
    assert finding.status_code == 200
    assert (await client.get(f"/v1/applications/{case_no}/findings", headers=headers)).json()[0]["status"] == "MATCH"


async def test_review_contents_faq_and_intent_endpoints(client, db, tenant, scheme):
    headers = await api_headers(db, tenant)
    evaluated = await client.post("/v1/review/evaluate", headers=headers, json={
        "scheme": scheme.code, "documents": [], "facts": {},
    })
    assert evaluated.status_code == 200 and "findings" in evaluated.json()
    assert (await client.get(f"/v1/review/rules?scheme={scheme.code}", headers=headers)).status_code == 200

    db.add(Content(tenant_id=tenant.id, key="api.hello", category="api", title="問候",
                   content="你好，{{name}}", content_type="text", variables=["name"]))
    db.add(Faq(tenant_id=tenant.id, category="申請", question="如何申請", answer="線上申請",
               keywords=["申請"], priority=1, active=True))
    await db.commit()
    assert (await client.get("/v1/contents?category=api", headers=headers)).json()[0]["key"] == "api.hello"
    assert (await client.get("/v1/contents/api.hello", headers=headers)).json()["content"] == "你好，{{name}}"
    assert (await client.post("/v1/contents/render", headers=headers,
                              json={"key": "api.hello", "vars": {"name": "May"}})).json()["text"] == "你好，May"
    assert (await client.post("/v1/faqs/search", headers=headers,
                              json={"text": "如何申請"})).json()[0]["answer"] == "線上申請"
    intent = await client.post("/v1/intent/classify", headers=headers, json={"text": "查案件進度"})
    assert intent.status_code == 200 and intent.json()["intent"] == "case_status"
