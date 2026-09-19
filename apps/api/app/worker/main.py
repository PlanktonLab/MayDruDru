"""arq worker entrypoint: `arq app.worker.main.WorkerSettings`."""

from arq import cron, func

from .. import storage
from ..ai.tracing import setup as setup_tracing
from ..jobs import job_deserializer, job_serializer
from ..jobs import redis_settings as _redis_settings
from .tasks import (
    EVAL_JOB_TIMEOUT_SECONDS,
    NOTIFY_MAX_TRIES,
    cleanup_originals,
    expire_supplements,
    process_variant,
    purge_documents,
    render_stepcard,
    resume_variant,
    run_eval,
    send_notification,
    sweep_conversations,
    sweep_stale_jobs,
)


async def startup(ctx: dict) -> None:
    setup_tracing()
    storage.ensure_buckets()


class WorkerSettings:
    functions = [
        process_variant,
        resume_variant,
        render_stepcard,
        func(run_eval, timeout=EVAL_JOB_TIMEOUT_SECONDS),
        # LINE 推播：重試三次（SPEC §8.7），退避交給 arq。
        func(send_notification, max_tries=NOTIFY_MAX_TRIES),
    ]
    cron_jobs = [
        cron(sweep_stale_jobs, minute=set(range(0, 60, 10))),
        cron(sweep_conversations, minute=set(range(0, 60, 5))),  # LINE 對話 30 分鐘逾時（SPEC §8.4）
        cron(cleanup_originals, minute={5}),  # hourly: TTL, orphan originals, PII scrub
        cron(expire_supplements, minute={20}),  # hourly: T8 補件逾期（SPEC §7）
        cron(purge_documents, hour={3}, minute={0}),  # daily 03:00: 終態案件硬刪文件（SPEC §7 / §11）
    ]
    on_startup = startup
    redis_settings = _redis_settings()
    job_serializer = staticmethod(job_serializer)
    job_deserializer = staticmethod(job_deserializer)
    max_jobs = 4
    job_timeout = 900
    keep_result = 3600
