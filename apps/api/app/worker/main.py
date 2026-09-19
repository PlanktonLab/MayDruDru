"""arq worker entrypoint: `arq app.worker.main.WorkerSettings`."""

from arq import cron, func

from .. import storage
from ..ai.tracing import setup as setup_tracing
from ..jobs import job_deserializer, job_serializer
from ..jobs import redis_settings as _redis_settings
from .tasks import (
    EVAL_JOB_TIMEOUT_SECONDS,
    cleanup_originals,
    process_variant,
    render_stepcard,
    resume_variant,
    run_eval,
    sweep_stale_jobs,
)


async def startup(ctx: dict) -> None:
    setup_tracing()
    storage.ensure_buckets()


class WorkerSettings:
    functions = [process_variant, resume_variant, render_stepcard, func(run_eval, timeout=EVAL_JOB_TIMEOUT_SECONDS)]
    cron_jobs = [
        cron(sweep_stale_jobs, minute=set(range(0, 60, 10))),
        cron(cleanup_originals, minute={5}),  # hourly: TTL, orphan originals, PII scrub
    ]
    on_startup = startup
    redis_settings = _redis_settings()
    job_serializer = staticmethod(job_serializer)
    job_deserializer = staticmethod(job_deserializer)
    max_jobs = 4
    job_timeout = 900
    keep_result = 3600
