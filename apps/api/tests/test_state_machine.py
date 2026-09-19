"""SPEC §7 狀態機：每一條轉移的成功路徑，以及每一條被拒絕的理由。

被拒絕的案例比成功的重要——狀態機存在的意義就是那些「不行」。
"""

from datetime import UTC, datetime, timedelta

import pytest
from app.models import TERMINAL_STATUSES, Application, ApplicationStatusEvent, ImmutableEventError
from app.services import application as case_service
from app.services import notify, review
from app.services.actors import Actor
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

SYSTEM = Actor.system()
APPLICANT = Actor.applicant("HC-2026-000001")
REVIEWER = Actor(type="STAFF", id="r" * 32, role="case_reviewer", name="承辦")
SUPERVISOR = Actor(type="STAFF", id="s" * 32, role="case_supervisor", name="科長")
SOP_EDITOR = Actor(type="STAFF", id="e" * 32, role="sop_editor", name="SOP 編輯")

SUPPLEMENT = [{"document_type_code": "BILLING_STATEMENT", "rejection_code": "BILLING_NO_TWD", "note": "缺臺幣金額"}]


async def make_case(db, tenant, scheme, **kw) -> Application:
    app = await case_service.create_application(
        db, tenant_id=tenant.id, scheme=scheme, applicant_name="測試用小明",
        phone="0912345678", id_number="A123456789", payment_channel_code="CREDIT_CARD",
        tier_code="GENERAL", tool_name="ChatGPT Plus", purchase_amount=6000, **kw,
    )
    await db.commit()
    return app


async def drive(db, app, *codes, actor=None):
    """把案件推到某個狀態。每一步都走真的 transition()，不偷改欄位。"""
    for code in codes:
        t = case_service.TRANSITIONS[code]
        who = actor or {"SYSTEM": SYSTEM, "APPLICANT": APPLICANT, "STAFF": SUPERVISOR}[t.actor_type]
        kwargs = {}
        if t.needs_reason:
            kwargs["reason"] = "測試理由"
        if t.needs_rejection_codes:
            kwargs["rejection_codes"] = ["OTHER"]
        if t.needs_supplement:
            kwargs["supplement_items"] = SUPPLEMENT
            who = REVIEWER
        await case_service.transition(db, app, code, actor=who, **kwargs)
    await db.commit()
    return app


async def events_of(db, app) -> list[ApplicationStatusEvent]:
    return list((await db.execute(
        select(ApplicationStatusEvent)
        .where(ApplicationStatusEvent.application_id == app.id)
        .order_by(ApplicationStatusEvent.created_at, ApplicationStatusEvent.transition_code)
    )).scalars())


# ------------------------------------------------------------- 建案與 T1

async def test_create_runs_t1_and_lands_in_the_queue(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    assert app.status == "UNDER_REVIEW"
    assert app.first_submitted_at is not None
    codes = [e.transition_code for e in await events_of(db, app)]
    assert codes == ["T0", "T1"]


async def test_create_hashes_pii_and_never_stores_the_plain_phone(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    assert "0912345678" not in app.phone_encrypted
    assert app.phone_last4_hash and app.phone_last4_hash != "5678"
    assert app.id_last4_hash and app.id_last4_hash != app.phone_last4_hash


async def test_create_writes_document_rows(db, tenant, scheme):
    await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "ID_CARD_FRONT", "object_key": "k1", "mime": "image/jpeg"},
    ])
    docs = list((await db.execute(select(case_service.ApplicationDocument))).scalars())
    assert [d.document_type_code for d in docs] == ["ID_CARD_FRONT"]
    assert docs[0].revision == 0 and docs[0].is_current


# ---------------------------------------------------- 每一條轉移的成功路徑

@pytest.mark.parametrize("path,final", [
    (["T2"], "NEEDS_REVISION"),
    (["T3"], "APPROVED"),
    (["T2", "T4"], "REVISION_SUBMITTED"),
    (["T2", "T4", "T5"], "UNDER_REVIEW"),
    (["T3", "T6"], "DISBURSING"),
    (["T3", "T6", "T7"], "DISBURSED"),
    (["T9"], "REJECTED"),
    (["T10"], "WITHDRAWN"),
    (["T11"], "CANCELLED_BY_STAFF"),
])
async def test_happy_paths(db, tenant, scheme, path, final):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, *path)
    assert app.status == final


async def test_t8_expires_a_case_whose_supplement_deadline_passed(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    app.supplement_deadline = datetime.now(UTC) - timedelta(days=1)
    await db.commit()
    expired = await case_service.expire_overdue(db, datetime.now(UTC))
    assert expired == [app.case_no]
    assert app.status == "EXPIRED"


async def test_t8_leaves_a_case_still_inside_its_deadline_alone(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    assert await case_service.expire_overdue(db, datetime.now(UTC)) == []
    assert app.status == "NEEDS_REVISION"


# ------------------------------------------------------------- 拒絕案例

async def test_wrong_role_cannot_approve(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T3", actor=REVIEWER)
    assert e.value.status_code == 403
    assert app.status == "UNDER_REVIEW"


async def test_sop_role_has_no_case_capability_at_all(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T2", actor=SOP_EDITOR, supplement_items=SUPPLEMENT)
    assert e.value.status_code == 403


async def test_staff_cannot_perform_an_applicant_transition(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T4", actor=SUPERVISOR)
    assert e.value.status_code == 403


async def test_applicant_cannot_run_a_system_transition(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2", "T4")
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T5", actor=APPLICANT)
    assert e.value.status_code == 403


@pytest.mark.parametrize("code", ["T4", "T5", "T6", "T7", "T8"])
async def test_transition_refused_from_the_wrong_state(db, tenant, scheme, code):
    app = await make_case(db, tenant, scheme)  # UNDER_REVIEW
    t = case_service.TRANSITIONS[code]
    actor = {"SYSTEM": SYSTEM, "APPLICANT": APPLICANT, "STAFF": SUPERVISOR}[t.actor_type]
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, code, actor=actor)
    assert e.value.status_code == 409


@pytest.mark.parametrize("path", [["T3", "T6", "T7"], ["T9"], ["T10"], ["T11"]])
async def test_nothing_moves_once_the_case_is_terminal(db, tenant, scheme, path):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, *path)
    assert app.status in TERMINAL_STATUSES
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T11", actor=SUPERVISOR, reason="再註銷一次")
    assert e.value.status_code == 409


async def test_t9_needs_a_reason(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T9", actor=SUPERVISOR, reason="   ", rejection_codes=["OTHER"])
    assert e.value.status_code == 400


async def test_t9_needs_at_least_one_rejection_code(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T9", actor=SUPERVISOR, reason="不符資格", rejection_codes=[])
    assert e.value.status_code == 400


async def test_t11_needs_a_reason(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T11", actor=SUPERVISOR)
    assert e.value.status_code == 400


async def test_t2_needs_supplement_items(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T2", actor=REVIEWER, supplement_items=[])
    assert e.value.status_code == 400


async def test_unknown_transition_code_is_refused(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T99", actor=SUPERVISOR)
    assert e.value.status_code == 400


# --------------------------------------------------------- 補件上限與計數

async def test_t2_refused_once_max_revisions_is_reached(db, tenant, scheme):
    """方案 fixture 的 max_revisions 是 2，所以第三次要求補件必須走不通。"""
    app = await make_case(db, tenant, scheme)
    for _ in range(scheme.max_revisions):
        await drive(db, app, "T2", "T4", "T5")
    assert app.revision_count == scheme.max_revisions
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T2", actor=REVIEWER, supplement_items=SUPPLEMENT)
    assert e.value.status_code == 409
    # 出口是不通過，不是無限補件
    await drive(db, app, "T9")
    assert app.status == "REJECTED"


async def test_t2_sets_the_deadline_from_the_scheme(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    before = datetime.now(UTC)
    await drive(db, app, "T2")
    assert app.supplement_deadline is not None
    delta = app.supplement_deadline - before
    assert timedelta(days=scheme.supplement_days - 1) < delta < timedelta(days=scheme.supplement_days + 1)
    assert app.supplement_items[0]["rejection_code"] == "BILLING_NO_TWD"


async def test_t5_clears_the_supplement_request(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2", "T4", "T5")
    assert app.supplement_items == [] and app.supplement_deadline is None


async def test_resubmitting_moves_last_submitted_but_never_first(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    first = app.first_submitted_at
    await drive(db, app, "T2", "T4")
    assert app.first_submitted_at == first
    assert app.last_submitted_at >= first


# ------------------------------------------------------- T3 的前置條件掛鉤

async def test_t3_is_blocked_when_the_review_hook_reports_problems(db, tenant, scheme):
    review.set_approval_blockers(lambda app: ["帳單金額與申請金額不符"])
    app = await make_case(db, tenant, scheme)
    with pytest.raises(case_service.TransitionError) as e:
        await case_service.transition(db, app, "T3", actor=SUPERVISOR)
    assert e.value.status_code == 409
    assert "帳單金額" in e.value.detail
    assert app.status == "UNDER_REVIEW"


async def test_t3_passes_once_the_hook_clears(db, tenant, scheme):
    async def clean(app):
        return []

    review.set_approval_blockers(clean)
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3")
    assert app.status == "APPROVED"


async def test_default_hook_blocks_nothing(db, tenant, scheme):
    assert await review.approval_blockers(object()) == []


# ------------------------------------------------------------- 事件與稽核

async def test_every_transition_writes_exactly_one_event(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2", "T4", "T5", "T3", "T6", "T7")
    codes = [e.transition_code for e in await events_of(db, app)]
    assert codes == ["T0", "T1", "T2", "T4", "T5", "T3", "T6", "T7"]


async def test_a_refused_transition_writes_no_event(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    before = len(await events_of(db, app))
    with pytest.raises(case_service.TransitionError):
        await case_service.transition(db, app, "T3", actor=REVIEWER)
    assert len(await events_of(db, app)) == before


async def test_events_cannot_be_updated(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    event = (await events_of(db, app))[-1]
    event.reason = "竄改"
    with pytest.raises(ImmutableEventError):
        await db.flush()
    db.expunge_all()


async def test_events_cannot_be_deleted(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    event = (await events_of(db, app))[-1]
    await db.delete(event)
    with pytest.raises(ImmutableEventError):
        await db.flush()
    db.expunge_all()


async def test_rejection_reason_and_codes_land_on_the_event(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    event = await case_service.transition(
        db, app, "T9", actor=SUPERVISOR, reason="設籍地非新竹市", rejection_codes=["ID_NOT_HSINCHU"])
    await db.commit()
    assert event.reason == "設籍地非新竹市"
    assert event.rejection_codes == ["ID_NOT_HSINCHU"]
    assert event.actor_type == "STAFF" and event.actor_id == SUPERVISOR.id


# ------------------------------------------------------------ purge 排程

@pytest.mark.parametrize("path", [["T3", "T6", "T7"], ["T9"], ["T10"], ["T11"]])
async def test_entering_a_terminal_state_schedules_the_purge(db, tenant, scheme, path):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, *path)
    assert app.documents_purge_at is not None
    assert app.documents_purge_at > datetime.now(UTC) + timedelta(days=scheme.retention_days - 1)


async def test_an_open_case_has_no_purge_date(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2")
    assert app.documents_purge_at is None


# ------------------------------------------------------------------ 通知

@pytest.mark.parametrize("code", sorted(notify.NOTIFY_TRANSITIONS))
async def test_notified_transitions_queue_a_notification(db, tenant, scheme, code):
    paths = {"T2": ["T2"], "T3": ["T3"], "T7": ["T3", "T6", "T7"], "T9": ["T9"], "T11": ["T11"]}
    app = await make_case(db, tenant, scheme)
    if code == "T8":
        await drive(db, app, "T2")
        app.supplement_deadline = datetime.now(UTC) - timedelta(days=1)
        await db.commit()
        await case_service.expire_overdue(db, datetime.now(UTC))
    else:
        await drive(db, app, *paths[code])
    rows = list((await db.execute(select(notify.Notification).where(notify.Notification.status == "queued"))).scalars())
    assert any(r.payload.get("transition_code") == code for r in rows)


async def test_silent_transitions_queue_nothing(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T2", "T4", "T5")
    rows = list((await db.execute(select(notify.Notification))).scalars())
    assert [r.payload["transition_code"] for r in rows] == ["T2"]


async def test_notification_carries_only_a_content_key_not_a_sentence(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3")
    row = (await db.execute(select(notify.Notification))).scalars().first()
    assert row.content_key == "status.APPROVED.notify_headline"
    assert row.status == "queued"


# ------------------------------------------------------------- 承辦人指派

async def test_the_first_staff_action_assigns_the_reviewer(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    assert app.assigned_reviewer_id is None
    await drive(db, app, "T2")
    assert app.assigned_reviewer_id == REVIEWER.id
    await drive(db, app, "T4", "T5", "T3")
    assert app.assigned_reviewer_id == REVIEWER.id  # 後手的科長不會搶走案子


# --------------------------------------------------------------- 可用轉移

async def test_allowed_transitions_per_status(db):
    assert sorted(t.code for t in case_service.allowed_transitions("SUBMITTED")) == ["T1", "T10", "T11"]
    assert sorted(t.code for t in case_service.allowed_transitions("UNDER_REVIEW")) == \
        ["T10", "T11", "T2", "T3", "T9"]
    assert case_service.allowed_transitions("DISBURSED") == []


async def test_t11_is_offered_from_every_open_status(db):
    from app.models import OPEN_STATUSES

    for status in OPEN_STATUSES:
        assert "T11" in [t.code for t in case_service.allowed_transitions(status)]


# ----------------------------------------------------------------- 補件文件

async def test_add_documents_supersedes_the_previous_revision(db, tenant, scheme):
    app = await make_case(db, tenant, scheme, documents=[
        {"document_type_code": "BILLING_STATEMENT", "object_key": "v1"},
    ])
    await drive(db, app, "T2")
    rows = await case_service.add_documents(db, app, [
        {"document_type_code": "BILLING_STATEMENT", "object_key": "v2", "masked": True},
    ])
    await db.commit()
    assert rows[0].revision == 1 and rows[0].is_current
    all_docs = list((await db.execute(select(case_service.ApplicationDocument))).scalars())
    old = next(d for d in all_docs if d.object_key == "v1")
    assert not old.is_current and rows[0].supersedes_id == old.id
    assert len(all_docs) == 2  # 舊版留到 purge


async def test_add_documents_of_a_new_type_starts_at_revision_zero(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    rows = await case_service.add_documents(db, app, [{"document_type_code": "SPECIAL_STATUS_PROOF"}])
    await db.commit()
    assert rows[0].revision == 0 and rows[0].supersedes_id is None


# ------------------------------------------------------------------ 案號

async def test_case_numbers_are_sequential_per_tenant_and_year(db, tenant, scheme):
    numbers = [(await make_case(db, tenant, scheme)).case_no for _ in range(3)]
    year = datetime.now(UTC).year
    assert numbers == [f"HC-{year}-{i:06d}" for i in (1, 2, 3)]


async def test_case_number_format(db, tenant):
    got = await case_service.next_case_no(db, tenant.id, year=2026)
    assert got == "HC-2026-000001"


async def test_case_numbers_restart_each_year(db, tenant):
    assert await case_service.next_case_no(db, tenant.id, year=2026) == "HC-2026-000001"
    assert await case_service.next_case_no(db, tenant.id, year=2027) == "HC-2027-000001"
    assert await case_service.next_case_no(db, tenant.id, year=2026) == "HC-2026-000002"


async def test_a_supplied_case_number_is_kept_verbatim(db, tenant, scheme):
    """舊系統的 8 位數案號原樣沿用（決策 D13 / D16）。"""
    app = await make_case(db, tenant, scheme, case_no="20260001", intake_channel="LEGACY")
    assert app.case_no == "20260001"


async def test_case_numbers_are_unique(db, tenant, scheme):
    await make_case(db, tenant, scheme, case_no="HC-2026-000001")
    with pytest.raises(IntegrityError):
        await make_case(db, tenant, scheme, case_no="HC-2026-000001")
    await db.rollback()


# ------------------------------------------------------------------ 佇列

async def test_queue_orders_by_first_submission_and_revision_does_not_reorder(db, tenant, scheme):
    base = datetime.now(UTC) - timedelta(days=10)
    first = await make_case(db, tenant, scheme, now=base)
    second = await make_case(db, tenant, scheme, now=base + timedelta(days=1))
    # 先送件的被退件又補件，順位仍然在前
    await drive(db, first, "T2", "T4", "T5")
    rows, total = await case_service.queue(db, tenant.id)
    assert total == 2
    assert [r.case_no for r in rows] == [first.case_no, second.case_no]
    assert second.first_submitted_at > first.first_submitted_at


async def test_queue_filters_by_status_and_reviewer(db, tenant, scheme):
    a = await make_case(db, tenant, scheme)
    b = await make_case(db, tenant, scheme)
    await drive(db, a, "T2")
    rows, _ = await case_service.queue(db, tenant.id, statuses=["NEEDS_REVISION"])
    assert [r.case_no for r in rows] == [a.case_no]
    rows, _ = await case_service.queue(db, tenant.id, assigned_reviewer_id=REVIEWER.id)
    assert [r.case_no for r in rows] == [a.case_no]
    rows, _ = await case_service.queue(db, tenant.id, statuses=["UNDER_REVIEW"])
    assert [r.case_no for r in rows] == [b.case_no]


async def test_queue_is_scoped_to_one_tenant(db, tenant, scheme):
    await make_case(db, tenant, scheme)
    _, total = await case_service.queue(db, "other-tenant")
    assert total == 0


async def test_applications_count_matches_events_owner(db, tenant, scheme):
    await make_case(db, tenant, scheme)
    apps = (await db.execute(select(func.count(Application.id)))).scalar_one()
    assert apps == 1
