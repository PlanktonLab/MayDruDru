import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from starlette.formparsers import MultiPartParser

from . import storage
from .ai.tracing import setup as setup_tracing
from .config import get_settings
from .db import sessionmaker
from .models import Tenant, User
from .routers import (
    apply,
    auth,
    catalog_admin,
    components,
    dashboard,
    evals,
    flows,
    media,
    playground,
    public_api,
    tenant,
    variants,
)
from .routers.admin import applications as admin_applications
from .routers.admin import reviewers as admin_reviewers
from .routers.admin import schemes as admin_schemes
from .security import hash_password

log = logging.getLogger("sop")

# Uploaded screenshots must stay in memory (CLAUDE.md privacy rule). Starlette
# spools multipart files above 1 MB to a temp file on disk; raise the spool
# threshold above the largest accepted upload so it never rolls over.
MultiPartParser.spool_max_size = get_settings().max_upload_bytes + 1024 * 1024


async def _bootstrap_from_env() -> None:
    s = get_settings()
    if not (s.bootstrap_tenant_name and s.bootstrap_owner_email and s.bootstrap_owner_password):
        return
    async with sessionmaker()() as db:
        n = (await db.execute(select(func.count(Tenant.id)))).scalar_one()
        if n:
            return
        t = Tenant(name=s.bootstrap_tenant_name, slug="default")
        db.add(t)
        await db.flush()
        db.add(User(tenant_id=t.id, email=s.bootstrap_owner_email.lower(), name="Owner", role="owner", password_hash=hash_password(s.bootstrap_owner_password)))
        await db.commit()


def check_settings() -> None:
    s = get_settings()
    problems = s.insecure_defaults()
    if not problems:
        return
    if s.is_production:
        raise RuntimeError("拒絕以不安全的設定啟動：" + "；".join(problems))
    log.warning("開發模式使用不安全的預設值（部署時設定 ENV=production 會拒絕啟動）：%s", "；".join(problems))


@asynccontextmanager
async def lifespan(app: FastAPI):
    check_settings()
    setup_tracing()
    try:
        storage.ensure_buckets()
    except Exception:  # storage may come up later; endpoints will surface errors
        log.exception("storage not ready")
    try:
        await _bootstrap_from_env()
    except Exception:
        # an unbootstrapped instance leaves POST /api/auth/bootstrap open — say so loudly
        log.exception("環境變數 bootstrap 失敗，/api/auth/bootstrap 仍開放，請盡快完成設定")
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title=s.app_name, version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    for r in (auth, tenant, catalog_admin, components, flows, variants, playground, evals, dashboard,
              admin_schemes, admin_applications, admin_reviewers, public_api, media):
        app.include_router(r.router)
    app.include_router(apply.router)  # P3 送件與審核：市民匿名端點（SPEC §8.1）

    @app.get("/health")
    async def health():
        return {"ok": True, "provider": s.llm_provider, "model": s.default_model}

    return app


app = create_app()
