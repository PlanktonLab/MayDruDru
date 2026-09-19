import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
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
    contents,
    dashboard,
    evals,
    flows,
    line,
    media,
    playground,
    public_api,
    tenant,
    variants,
)
from .routers.admin import applications as admin_applications
from .routers.admin import contents as admin_contents
from .routers.admin import copilot as admin_copilot
from .routers.admin import faqs as admin_faqs
from .routers.admin import line as admin_line
from .routers.admin import media as admin_media
from .routers.admin import reviewers as admin_reviewers
from .routers.admin import schemes as admin_schemes
from .security import hash_password
from .services import tenancy

log = logging.getLogger("sop")

# Uploaded screenshots must stay in memory (CLAUDE.md privacy rule). Starlette
# spools multipart files above 1 MB to a temp file on disk; raise the spool
# threshold above the largest accepted upload so it never rolls over.
MultiPartParser.spool_max_size = get_settings().max_upload_bytes + 1024 * 1024


async def _bootstrap_from_env() -> None:
    """環境變數版的第一個 owner。閘門與 `/api/auth/bootstrap` 同一個（決策 D26）。

    看的是「有沒有還在用的 owner」而不是「有沒有 tenant」：seed 過的機器 tenant
    早就在了，用 tenant 數量判斷會讓這支函式什麼都不做，開放的 bootstrap 端點
    也一直開著。tenant 已經在就把 owner 掛上去，不再開第二個機關。
    """
    s = get_settings()
    if not (s.bootstrap_tenant_name and s.bootstrap_owner_email and s.bootstrap_owner_password):
        return
    async with sessionmaker()() as db:
        if not await tenancy.needs_bootstrap(db):
            return
        t = await tenancy.default_tenant(db)
        if t is None:
            t = Tenant(name=s.bootstrap_tenant_name, slug="default")
            db.add(t)
            await db.flush()
        db.add(User(tenant_id=t.id, email=s.bootstrap_owner_email.lower(), name="Owner", role="owner", password_hash=hash_password(s.bootstrap_owner_password)))
        await db.commit()


async def _sync_contents() -> None:
    """每次啟動把 registry 的 key 補進 `contents`（SPEC §8.6）。

    只補缺的列、只刷新中繼資料，承辦人改過的字永遠不動（services/contents.py）。
    """
    from .services import contents as contents_service

    async with sessionmaker()() as db:
        for tenant_id in (await db.execute(select(Tenant.id))).scalars().all():
            await contents_service.sync_defaults(db, tenant_id)
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
    try:
        await _sync_contents()
    except Exception:
        # 文案缺列不會讓 bot 沉默（會退回 registry 預設值），所以這裡只警告不中止。
        log.warning("罐頭訊息 sync_defaults 失敗，將以 registry 預設值運作", exc_info=True)
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title=s.app_name, version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    for r in (auth, tenant, catalog_admin, components, flows, variants, playground, evals, dashboard,
              admin_schemes, admin_applications, admin_reviewers, public_api, media):
        app.include_router(r.router)
    app.include_router(apply.router)  # P3 送件與審核：市民匿名端點（SPEC §8.1）
    # P2 內容與 LINE（SPEC §8.4 / §8.6）
    for r in (contents, line, admin_contents, admin_faqs, admin_media, admin_line):
        app.include_router(r.router)
    app.include_router(admin_copilot.router)  # P5 內容助理（SPEC §8.6 / §9.6）

    @app.get("/health")
    async def health():
        return {"ok": True, "provider": s.llm_provider, "model": s.default_model}

    return app


app = create_app()
