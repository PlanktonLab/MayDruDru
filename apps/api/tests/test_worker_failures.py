"""Jobs must leave their rows actionable on any exit, including arq's timeout
(asyncio.CancelledError). Database writes are replaced with recorders."""

import asyncio

import pytest
from app.worker import tasks


async def test_run_eval_marks_run_failed_on_cancellation(monkeypatch):
    calls = []

    async def cancelled(run_id):
        raise asyncio.CancelledError()

    async def record(run_id, error):
        calls.append((run_id, error))

    monkeypatch.setattr(tasks, "_run_eval", cancelled)
    monkeypatch.setattr(tasks, "_fail_eval", record)
    with pytest.raises(asyncio.CancelledError):
        await tasks.run_eval({}, "run1")
    assert calls == [("run1", "處理逾時或被中斷，請重新送出")]


async def test_mark_failed_keeps_a_committed_approval(monkeypatch):
    seen = []

    async def transition(variant_id, from_statuses, **values):
        seen.append((from_statuses, values["status"]))
        return from_statuses == ("approved",)

    monkeypatch.setattr(tasks, "transition", transition)
    await tasks._mark_failed("v1", "boom")
    assert seen == [(("processing",), "failed"), (("approved",), "annotating")]


async def test_failure_bookkeeping_errors_do_not_mask_the_job_error():
    async def broken():
        raise RuntimeError("db down")

    await tasks._on_failure(broken())  # logged, not raised


def test_error_text_hides_cancellation_repr():
    assert "CancelledError" not in tasks._error_text(asyncio.CancelledError())
    assert "boom" in tasks._error_text(ValueError("boom"))
