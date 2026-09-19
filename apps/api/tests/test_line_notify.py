"""狀態變更推播：排入、送出、重試（SPEC §8.7）。

重點是「狀態機不會因為 LINE 掛掉而失敗」：轉移只寫一列 `notifications`，
真正的推播在 worker，失敗留在資料表上讓承辦人看得到。
"""

from __future__ import annotations

import pytest
from app.models import CaseVerification, Notification
from app.services import notify
from app.services.line import sender as sender_module
from app.worker import tasks
from sqlalchemy import select

from tests.test_state_machine import drive, make_case

USER = "Uline0000000000000000000000000002"


async def bound_case(db, tenant, scheme):
    app = await make_case(db, tenant, scheme)
    db.add(CaseVerification(tenant_id=tenant.id, application_id=app.id, line_user_id=USER))
    await db.commit()
    return app


async def only_notification(db) -> Notification:
    return (await db.execute(select(Notification))).scalars().one()


# ------------------------------------------------------------------- 排入

@pytest.mark.parametrize("code", sorted(notify.NOTIFY_TRANSITIONS - {"T7", "T8"}))
async def test_a_notifying_transition_queues_a_row_for_a_bound_user(db, tenant, scheme, code, line_sender):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, code)
    row = await only_notification(db)
    assert row.status == "queued"
    assert row.line_user_id == USER
    assert row.payload["transition_code"] == code
    assert row.content_key == f"status.{app.status}.notify_headline"


async def test_a_silent_transition_queues_nothing(db, tenant, scheme, line_sender):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T2", "T4")
    codes = [r.payload["transition_code"] for r in (await db.execute(select(Notification))).scalars()]
    assert codes == ["T2"]


async def test_a_case_nobody_verified_is_recorded_as_skipped(db, tenant, scheme, line_sender):
    """承辦人要看得出「這個人沒收到」，所以不留白，也不假裝已排隊。"""
    app = await make_case(db, tenant, scheme)
    await drive(db, app, "T3")
    row = await only_notification(db)
    assert row.status == "skipped" and row.error == "no_linked_line_user"


async def test_two_bound_users_each_get_their_own_row(db, tenant, scheme, line_sender):
    app = await bound_case(db, tenant, scheme)
    db.add(CaseVerification(tenant_id=tenant.id, application_id=app.id, line_user_id="Uanother"))
    await db.commit()
    await drive(db, app, "T3")
    rows = (await db.execute(select(Notification))).scalars().all()
    assert sorted(r.line_user_id for r in rows) == sorted([USER, "Uanother"])


async def test_a_supplement_notification_remembers_which_document(db, tenant, scheme, line_sender):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T2")
    row = await only_notification(db)
    assert row.payload["document_code"] == "BILLING_STATEMENT"


# ------------------------------------------------------------------ 送出

async def test_the_worker_pushes_through_the_sender_and_marks_it_sent(db, tenant, scheme, line_sender, monkeypatch):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T3")
    row = await only_notification(db)
    monkeypatch.setattr(tasks, "sessionmaker", lambda: _single(db))

    assert await tasks.send_notification({}, row.id) == "sent"
    assert row.status == "sent" and row.sent_at is not None
    assert line_sender.sent[0]["kind"] == "push"
    assert line_sender.sent[0]["to"] == USER


async def test_the_pushed_message_is_text_then_timeline(db, tenant, scheme, line_sender):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T3")
    messages = await notify.build_messages(db, await only_notification(db))
    assert [m["type"] for m in messages] == ["text", "flex"]
    assert app.case_no in messages[0]["text"]


async def test_a_supplement_push_offers_both_ways_forward(db, tenant, scheme, line_sender):
    """SPEC §8.4：退件推播要給「教我準備」與「前往補件」兩個按鈕。"""
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T2")
    messages = await notify.build_messages(db, await only_notification(db))
    buttons = messages[1]["contents"]["footer"]["contents"]
    assert buttons[0]["action"]["type"] == "postback"
    assert buttons[0]["action"]["data"].startswith("action=sop_prepare")
    assert f"doc={'BILLING_STATEMENT'}" in buttons[0]["action"]["data"]
    assert buttons[1]["action"]["type"] == "uri"
    assert buttons[1]["action"]["uri"].endswith(f"/status/{app.case_no}")


async def test_the_headline_comes_from_contents(db, tenant, scheme, line_sender):
    from app.services import contents
    from app.services.actors import Actor

    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T3")
    await contents.publish(db, tenant.id, "status.APPROVED.notify_headline", "你的案件核定了",
                           actor=Actor(type="STAFF", id="a" * 32, role="admin"))
    await db.commit()
    messages = await notify.build_messages(db, await only_notification(db))
    assert "你的案件核定了" in messages[0]["text"]


async def test_a_failed_push_is_recorded_and_reraised_for_a_retry(db, tenant, scheme, line_sender, monkeypatch):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T3")
    row = await only_notification(db)
    line_sender.fail_with = RuntimeError("line is down")
    monkeypatch.setattr(tasks, "sessionmaker", lambda: _single(db))

    with pytest.raises(RuntimeError):
        await tasks.send_notification({}, row.id)
    assert row.status == "failed" and "line is down" in row.error


async def test_a_retry_after_a_failure_can_still_succeed(db, tenant, scheme, line_sender, monkeypatch):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T3")
    row = await only_notification(db)
    monkeypatch.setattr(tasks, "sessionmaker", lambda: _single(db))
    line_sender.fail_with = RuntimeError("line is down")
    with pytest.raises(RuntimeError):
        await tasks.send_notification({}, row.id)
    line_sender.fail_with = None
    assert await tasks.send_notification({}, row.id) == "sent"


async def test_sending_the_same_notification_twice_pushes_once(db, tenant, scheme, line_sender, monkeypatch):
    app = await bound_case(db, tenant, scheme)
    await drive(db, app, "T3")
    row = await only_notification(db)
    monkeypatch.setattr(tasks, "sessionmaker", lambda: _single(db))
    await tasks.send_notification({}, row.id)
    await tasks.send_notification({}, row.id)
    assert len(line_sender.sent) == 1


async def test_a_missing_notification_is_not_an_error(db, tenant, line_sender, monkeypatch):
    monkeypatch.setattr(tasks, "sessionmaker", lambda: _single(db))
    assert await tasks.send_notification({}, "n" * 32) == "missing"


def test_the_worker_registers_the_task_with_three_tries():
    from app.worker.main import WorkerSettings

    entry = next(f for f in WorkerSettings.functions if getattr(f, "name", "") == "send_notification")
    assert entry.max_tries == tasks.NOTIFY_MAX_TRIES == 3


def test_the_conversation_sweeper_runs_every_five_minutes():
    from app.worker.main import WorkerSettings

    job = next(c for c in WorkerSettings.cron_jobs if c.name.endswith("sweep_conversations"))
    assert job.minute == set(range(0, 60, 5))


def test_the_default_sender_never_touches_the_network_in_tests():
    sender_module.reset_sender()
    assert isinstance(sender_module.get_sender(), sender_module.NoopLineSender)


def test_the_sender_slices_to_five_messages():
    fake = sender_module.NoopLineSender()
    import asyncio

    asyncio.get_event_loop_policy()
    asyncio.run(fake.push("U1", [{"type": "text", "text": str(i)} for i in range(9)]))
    assert len(fake.sent[0]["messages"]) == sender_module.MAX_MESSAGES


def _single(db):
    """把測試用的單一 session 包成 worker 期待的 `sessionmaker()()` 兩段呼叫。"""

    class _Session:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *exc):
            return False

    return lambda: _Session()
