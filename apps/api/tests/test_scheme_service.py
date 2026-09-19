"""方案服務：必要文件矩陣、公開檢視、樂觀鎖（SPEC §6.2 / §8.1）。"""

import pytest
from app.services import scheme as scheme_service
from app.services.versioning import VersionConflict, bump, check_version
from fastapi import HTTPException

# --------------------------------------------- required_document_types 矩陣

async def test_always_required_documents_come_back_on_their_own(scheme):
    assert scheme_service.required_document_types(scheme) == ["ID_CARD_FRONT"]


@pytest.mark.parametrize("channel,extra", [
    ("CREDIT_CARD", ["BILLING_STATEMENT"]),
    ("TELECOM", ["TELECOM_BILL"]),
])
async def test_the_payment_channel_adds_its_own_documents(scheme, channel, extra):
    got = scheme_service.required_document_types(scheme, "GENERAL", channel)
    assert got == ["ID_CARD_FRONT", *extra]


async def test_the_tier_adds_its_proof_documents(scheme):
    got = scheme_service.required_document_types(scheme, "LOW_INCOME", "CREDIT_CARD")
    assert got == ["ID_CARD_FRONT", "BILLING_STATEMENT", "SPECIAL_STATUS_PROOF"]


async def test_paying_by_proxy_adds_the_proxy_affidavit(scheme):
    got = scheme_service.required_document_types(scheme, "GENERAL", "CREDIT_CARD", paid_by_proxy=True)
    assert "PROXY_AFFIDAVIT" in got


async def test_the_proxy_affidavit_stays_out_when_nobody_paid_on_your_behalf(scheme):
    assert "PROXY_AFFIDAVIT" not in scheme_service.required_document_types(scheme, "GENERAL", "CREDIT_CARD")


async def test_the_full_matrix_low_income_telecom_and_proxy(scheme):
    got = scheme_service.required_document_types(scheme, "LOW_INCOME", "TELECOM", paid_by_proxy=True)
    assert got == ["ID_CARD_FRONT", "TELECOM_BILL", "PROXY_AFFIDAVIT", "SPECIAL_STATUS_PROOF"]


async def test_results_follow_the_configured_sort_order(scheme):
    got = scheme_service.required_document_types(scheme, "LOW_INCOME", "CREDIT_CARD", paid_by_proxy=True)
    order = {d.code: d.sort_order for d in scheme.document_types}
    assert [order[c] for c in got] == sorted(order[c] for c in got)


async def test_an_unknown_channel_or_tier_never_blows_up(scheme):
    """設定不完整不該讓整個送件流程停住——只是沒有額外要求而已。"""
    assert scheme_service.required_document_types(scheme, "NOPE", "NOPE") == ["ID_CARD_FRONT"]


async def test_missing_document_types_subtracts_what_is_already_there(scheme):
    missing = scheme_service.missing_document_types(
        scheme, ["ID_CARD_FRONT"], tier_code="GENERAL", payment_channel_code="CREDIT_CARD")
    assert missing == ["BILLING_STATEMENT"]


# ------------------------------------------------------------- 公開檢視

async def test_public_view_hides_staff_only_fields(db, tenant, scheme):
    from app.models import RejectionCode, ReviewRule

    db.add(RejectionCode(tenant_id=tenant.id, scheme_id=scheme.id, code="OTHER",
                         staff_label="其他（請填說明）", public_what_wrong="其他需要修正的事項",
                         public_how_to_fix="請參考承辦的補充說明。"))
    db.add(ReviewRule(tenant_id=tenant.id, scheme_id=scheme.id, code="R1", rule_type="required_doc", config={}))
    await db.commit()
    await db.refresh(scheme)

    view = scheme_service.scheme_public_view(scheme)
    assert "review_rules" not in view
    assert view["rejection_codes"][0]["public_what_wrong"] == "其他需要修正的事項"
    assert "staff_label" not in view["rejection_codes"][0]


async def test_public_view_lists_the_configuration_a_citizen_needs(scheme):
    view = scheme_service.scheme_public_view(scheme)
    assert view["code"] == "TEST115"
    assert [t["code"] for t in view["tiers"]] == ["GENERAL", "LOW_INCOME"]
    assert [c["code"] for c in view["payment_channels"]] == ["CREDIT_CARD", "TELECOM"]
    assert view["document_types"][0]["code"] == "ID_CARD_FRONT"
    assert any(d["must_mask"] for d in view["document_types"])


async def test_inactive_rejection_codes_stay_out_of_the_public_view(db, tenant, scheme):
    from app.models import RejectionCode

    db.add(RejectionCode(tenant_id=tenant.id, scheme_id=scheme.id, code="OLD", active=False))
    await db.commit()
    await db.refresh(scheme)
    assert scheme_service.scheme_public_view(scheme)["rejection_codes"] == []


# ------------------------------------------------------------------ CRUD

async def test_create_and_fetch_a_scheme(db, tenant):
    made = await scheme_service.create_scheme(db, tenant.id, {"code": "NEW1", "name": "新方案", "tags": ["a"]})
    await db.commit()
    got = await scheme_service.get_scheme(db, tenant.id, "NEW1")
    assert got.id == made.id and got.tags == ["a"] and got.version == 1


async def test_fetching_an_unknown_scheme_is_a_404(db, tenant):
    with pytest.raises(HTTPException) as e:
        await scheme_service.get_scheme(db, tenant.id, "NOPE")
    assert e.value.status_code == 404


async def test_a_scheme_from_another_tenant_is_invisible(db, tenant, scheme):
    with pytest.raises(HTTPException) as e:
        await scheme_service.get_scheme(db, "other", scheme.code)
    assert e.value.status_code == 404


async def test_update_only_touches_the_fields_you_sent(db, scheme):
    before = await scheme_service.update_scheme(db, scheme, {"name": "改名"})
    await db.commit()
    assert scheme.name == "改名" and scheme.code == "TEST115"
    assert before == {"name": "測試補助"}


async def test_update_ignores_fields_that_are_not_writable(db, scheme):
    await scheme_service.update_scheme(db, scheme, {"id": "hacked", "tenant_id": "hacked"})
    await db.commit()
    assert scheme.id != "hacked" and scheme.tenant_id != "hacked"


async def test_children_are_listed_in_sort_order(db, scheme):
    tiers = await scheme_service.list_children(db, scheme, "tiers")
    assert [t.code for t in tiers] == ["GENERAL", "LOW_INCOME"]


async def test_an_unknown_child_kind_is_a_404(db, scheme):
    with pytest.raises(HTTPException) as e:
        await scheme_service.list_children(db, scheme, "nonsense")
    assert e.value.status_code == 404


async def test_child_crud_round_trip(db, scheme):
    made = await scheme_service.create_child(db, scheme, "rejection-codes", {
        "code": "DOC_MISSING", "staff_label": "缺少必要文件"})
    await db.commit()
    assert made.scheme_id == scheme.id and made.tenant_id == scheme.tenant_id

    await scheme_service.update_child(db, made, {"staff_label": "缺件"}, expected_version=1)
    await db.commit()
    assert made.staff_label == "缺件" and made.version == 2

    await scheme_service.delete_child(db, made)
    await db.commit()
    assert await scheme_service.list_children(db, scheme, "rejection-codes") == []


async def test_fetching_a_child_of_another_scheme_is_a_404(db, tenant, scheme):
    other = await scheme_service.create_scheme(db, tenant.id, {"code": "OTHER", "name": "另一個"})
    child = await scheme_service.create_child(db, other, "tiers", {"code": "X"})
    await db.commit()
    with pytest.raises(HTTPException) as e:
        await scheme_service.get_child(db, scheme, "tiers", child.id)
    assert e.value.status_code == 404


# ------------------------------------------------------------- 樂觀鎖

async def test_a_stale_version_is_refused(db, scheme):
    with pytest.raises(VersionConflict) as e:
        await scheme_service.update_scheme(db, scheme, {"name": "x"}, expected_version=99)
    assert e.value.status_code == 409
    assert scheme.name == "測試補助"


async def test_the_right_version_goes_through_and_bumps(db, scheme):
    await scheme_service.update_scheme(db, scheme, {"name": "第一次"}, expected_version=1)
    await db.commit()
    assert scheme.version == 2
    with pytest.raises(VersionConflict):
        await scheme_service.update_scheme(db, scheme, {"name": "第二次"}, expected_version=1)


async def test_omitting_the_version_opts_out_of_the_check(db, scheme):
    """搬遷腳本與 seed 沒有「載入過的版本」可以送，明確放棄檢查比假裝有好。"""
    await scheme_service.update_scheme(db, scheme, {"name": "腳本改的"})
    await db.commit()
    assert scheme.name == "腳本改的"


def test_check_version_and_bump_in_isolation():
    class Row:
        version = 3

    row = Row()
    check_version(row, None)
    check_version(row, 3)
    with pytest.raises(VersionConflict):
        check_version(row, 2)
    assert bump(row) == 4 and row.version == 4
