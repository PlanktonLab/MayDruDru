"""D37: persisted multi-period uploads, replacements and catalog decisions."""
import pytest
from app.models import Application, ApplicationDocument, DocumentOcrResult, EligibleTool
from app.services import review
from app.services.scheme import record_application_tool, resolve_tool
from fastapi import HTTPException
from sqlalchemy import select

from tests.test_apply_api import application_payload, bearer, multipart, ocr, verified_token


async def test_period_files_and_ocr_survive_and_only_requested_period_is_replaced(
    apply_client, admin_client, auth_headers, scheme, db,
):
    specs = [{"document_type_code": "BILLING_STATEMENT", "period_index": p, "mime": "image/png",
              "ocr": ocr(f"period {p}")} for p in (1, 2, 3)]
    data, files = multipart(specs, application=application_payload(
        billing_periods=3, original_currency="USD", original_amount=60,
    ))
    response = await apply_client.post("/api/apply/applications", data=data, files=files)
    assert response.status_code == 201, response.text
    case_no = response.json()["case_no"]
    app = (await db.execute(select(Application).where(Application.case_no == case_no))).scalar_one()
    docs = list((await db.execute(select(ApplicationDocument))).scalars())
    assert len({d.object_key for d in docs}) == 3
    assert {d.period_index for d in docs} == {1, 2, 3}
    old_second_id = next(d.id for d in docs if d.period_index == 2)
    for doc in docs:
        recognized = (await db.execute(select(DocumentOcrResult).where(DocumentOcrResult.document_id == doc.id))).scalar_one()
        assert recognized.lines[0]["text"] == f"period {doc.period_index}"
    detail = (await admin_client.get(f"/api/admin/applications/{case_no}", headers=auth_headers("case_reviewer"))).json()
    assert (detail["billing_periods"], detail["original_currency"], detail["original_amount"]) == (3, "USD", 60)
    assert {d["period_index"] for d in detail["documents"]} == {1, 2, 3}

    requested = await admin_client.post(f"/api/admin/applications/{case_no}/transitions",
        headers=auth_headers("case_reviewer"), json={"code": "T2", "supplement_items": [
            {"document_type_code": "BILLING_STATEMENT", "period_index": 2, "rejection_code": "BILLING_NO_TWD"},
        ]})
    assert requested.status_code == 201, requested.text
    token = await verified_token(apply_client, app)
    data, files = multipart([specs[0]])
    wrong = await apply_client.post(f"/api/apply/applications/{case_no}/documents", data=data, files=files, headers=bearer(token))
    assert wrong.status_code == 400
    data, files = multipart([{**specs[1], "ocr": ocr("replacement")}])
    replaced = await apply_client.post(f"/api/apply/applications/{case_no}/documents", data=data, files=files, headers=bearer(token))
    assert replaced.status_code == 200, replaced.text
    await db.refresh(app)
    current = await review.current_documents(db, app)
    assert len(current) == 3
    assert {d.period_index: d.revision for d in current} == {1: 0, 2: 1, 3: 0}
    second = next(d for d in current if d.period_index == 2)
    assert second.supersedes_id == old_second_id


@pytest.mark.parametrize("periods", [[1, 1], [1, 4]])
async def test_duplicate_and_out_of_range_periods_are_rejected(apply_client, scheme, db, periods):
    data, files = multipart([{"document_type_code": "BILLING_STATEMENT", "period_index": p} for p in periods],
                            application=application_payload(billing_periods=3))
    response = await apply_client.post("/api/apply/applications", data=data, files=files)
    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_DOCUMENT_PERIOD"
    assert not list((await db.execute(select(Application))).scalars())


async def test_free_text_is_counted_and_catalog_decision_is_enforced(db, scheme):
    first = await record_application_tool(db, scheme, "New Tool", None)
    assert await record_application_tool(db, scheme, "  NEW   TOOL  ", None) == first
    tool = await db.get(EligibleTool, first)
    assert tool.status == "PENDING" and tool.request_count == 2
    await resolve_tool(db, scheme, tool, status="APPROVED")
    assert await record_application_tool(db, scheme, "New Tool", first) == first
    assert tool.request_count == 2
    with pytest.raises(HTTPException) as mismatch:
        await record_application_tool(db, scheme, "Unrelated rejected name", first)
    assert mismatch.value.detail == {"code": "UNKNOWN_TOOL"}
    await resolve_tool(db, scheme, tool, status="REJECTED")
    for selected_id in (None, first):
        with pytest.raises(HTTPException) as error:
            await record_application_tool(db, scheme, "new tool", selected_id)
        assert error.value.detail == {"code": "TOOL_REJECTED"}


async def test_inquiries_are_recorded_before_submission_and_separate_from_submissions(apply_client, scheme, db):
    path = f"/api/apply/schemes/{scheme.code}/tool-inquiries"
    first = await apply_client.post(path, json={"name": "Asked Tool"})
    assert first.status_code == 200, first.text
    tool = await db.get(EligibleTool, first.json()["tool_id"])
    assert (tool.inquiry_count, tool.request_count) == (1, 0)
    await resolve_tool(db, scheme, tool, status="REJECTED")
    await db.commit()
    second = await apply_client.post(path, json={"name": "asked tool"})
    assert second.json()["tool_id"] == tool.id
    await db.refresh(tool)
    assert (tool.inquiry_count, tool.request_count, tool.status) == (2, 0, "REJECTED")
    public = (await apply_client.get(f"/api/apply/schemes/{scheme.code}")).json()
    assert next(t for t in public["eligible_tools"] if t["id"] == tool.id)["status"] == "REJECTED"
