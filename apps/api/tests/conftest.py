"""測試環境與共用 fixture（SPEC §14 / 決策 D15）。

環境變數在最上面設定，而且必須在任何 `app.*` 匯入之前生效——`get_settings()` 有
`lru_cache`，第一次讀到什麼就是什麼。測試永不連真實 LINE 或 LLM。

資料庫是 aiosqlite in-memory：`Base.metadata.create_all` 建整份 schema，所以新表的
清單欄位一律 JSON 而不是 Postgres ARRAY。embedding 欄位型別 SQLite 收得下，只是
測試從不寫入向量。
"""

import importlib
import os

os.environ.setdefault("LLM_PROVIDER", "fake")
os.environ.setdefault("LINE_SENDER", "noop")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("PUBLIC_MEDIA_BASE_URL", "http://m")

from collections.abc import AsyncIterator, Callable  # noqa: E402
from typing import Any  # noqa: E402

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from app.db import Base, get_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import ROLES, Scheme, Tenant, User  # noqa: E402
from app.security import create_token  # noqa: E402
from app.services import review  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402

TEST_TENANT_ID = "t" * 32


# ----------------------------------------------------------------- 資料庫

@pytest_asyncio.fixture
async def engine() -> AsyncIterator[Any]:
    """每個測試一顆全新的 in-memory 資料庫。

    `StaticPool` + 同一條連線，否則 `:memory:` 對每個連線都是不同的資料庫。
    """
    from sqlalchemy.pool import StaticPool

    eng = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db(engine: Any) -> AsyncIterator[AsyncSession]:
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def tenant(db: AsyncSession) -> Tenant:
    t = Tenant(id=TEST_TENANT_ID, name="測試機關", slug="test")
    db.add(t)
    await db.commit()
    return t


@pytest_asyncio.fixture
async def users(db: AsyncSession, tenant: Tenant) -> dict[str, User]:
    """每個角色一個帳號，鍵就是角色名（D14 的七個角色）。"""
    made = {}
    for role in ROLES:
        u = User(
            id=f"u{role}".ljust(32, "0")[:32],
            tenant_id=tenant.id,
            email=f"{role}@example.gov.tw",
            name=role,
            role=role,
            password_hash="x",
        )
        db.add(u)
        made[role] = u
    await db.commit()
    return made


@pytest.fixture
def auth_headers(users: dict[str, User]) -> Callable[[str], dict[str, str]]:
    def make(role: str) -> dict[str, str]:
        u = users[role]
        return {"Authorization": f"Bearer {create_token(u.id, u.tenant_id, u.role)}"}

    return make


@pytest_asyncio.fixture
async def client(db: AsyncSession) -> AsyncIterator[AsyncClient]:
    """走 ASGI transport 的 httpx client，`get_db` 換成測試 session。

    不啟動 lifespan：那會去戳 MinIO 與 bootstrap，測試環境兩個都不該碰。
    """
    app = create_app()

    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ------------------------------------------------------------------ Redis

class FakeRedis:
    """夠用就好的 in-memory 替身：查詢驗證只需要 incr / expire / get / delete。

    `expire` 記下 TTL 但不真的到期——測試要驗的是「第 6 次被擋下來」，不是時鐘。
    """

    def __init__(self) -> None:
        self.values: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.values[key] = self.values.get(key, 0) + 1
        return self.values[key]

    async def expire(self, key: str, seconds: int) -> bool:
        self.ttls[key] = seconds
        return True

    async def get(self, key: str) -> bytes | None:
        value = self.values.get(key)
        return None if value is None else str(value).encode()

    async def delete(self, *keys: str) -> int:
        return sum(1 for k in keys if self.values.pop(k, None) is not None)


@pytest.fixture
def fake_redis() -> FakeRedis:
    return FakeRedis()


# ------------------------------------------------------------------ 方案

@pytest_asyncio.fixture
async def scheme(db: AsyncSession, tenant: Tenant) -> Scheme:
    """測試用的小方案：兩個級距、四種文件、兩個管道，夠跑完必要文件矩陣。"""
    from app.models import DocumentType, PaymentChannel, SchemeTier

    s = Scheme(
        tenant_id=tenant.id, code="TEST115", name="測試補助",
        retention_days=90, supplement_days=14, max_revisions=2,
    )
    db.add(s)
    await db.flush()
    db.add_all([
        SchemeTier(tenant_id=tenant.id, scheme_id=s.id, code="GENERAL", label="一般", subsidy_rate=0.5,
                   cap_amount=3000, required_proof_doc_types=[], sort_order=1),
        SchemeTier(tenant_id=tenant.id, scheme_id=s.id, code="LOW_INCOME", label="特定對象", subsidy_rate=0.9,
                   cap_amount=6000, required_proof_doc_types=["SPECIAL_STATUS_PROOF"], sort_order=2),
        DocumentType(tenant_id=tenant.id, scheme_id=s.id, code="ID_CARD_FRONT", required=True, sort_order=1),
        DocumentType(tenant_id=tenant.id, scheme_id=s.id, code="BILLING_STATEMENT", must_mask=True, sort_order=2),
        DocumentType(tenant_id=tenant.id, scheme_id=s.id, code="TELECOM_BILL", must_mask=True, sort_order=3),
        DocumentType(tenant_id=tenant.id, scheme_id=s.id, code="PROXY_AFFIDAVIT", required_when="proxy", sort_order=4),
        DocumentType(tenant_id=tenant.id, scheme_id=s.id, code="SPECIAL_STATUS_PROOF", sort_order=5),
        PaymentChannel(tenant_id=tenant.id, scheme_id=s.id, code="CREDIT_CARD",
                       required_document_type_codes=["BILLING_STATEMENT"], sort_order=1),
        PaymentChannel(tenant_id=tenant.id, scheme_id=s.id, code="TELECOM",
                       required_document_type_codes=["TELECOM_BILL"], sort_order=2),
    ])
    await db.commit()
    await db.refresh(s)
    return s


@pytest.fixture(autouse=True)
def reset_blockers():
    """核准前置條件是模組層的掛鉤；裝過就要拆掉，不然會滲進下一個測試。"""
    yield
    review.reset_approval_blockers()


# --------------------------------------------------- P3：送件與審核用的 fixture

class FakeStorage:
    """記憶體版的 MinIO：測試永不連真的物件儲存（SPEC §14）。"""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []
        self.presigned: list[str] = []

    def put(self, bucket: str, key: str, data: bytes, content_type: str = "") -> str:
        self.objects[key] = data
        return key

    def delete(self, bucket: str, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)

    def presigned_get_object(self, bucket: str, key: str, expires=None) -> str:
        self.presigned.append(key)
        return f"https://minio.test/{bucket}/{key}?signed=1"


@pytest.fixture
def fake_storage(monkeypatch) -> FakeStorage:
    """把 `app.storage` 的讀寫換成記憶體版；`services/documents` 透過它存取物件。"""
    from app import storage

    fake = FakeStorage()
    monkeypatch.setattr(storage, "put", fake.put)
    monkeypatch.setattr(storage, "delete", fake.delete)
    monkeypatch.setattr(storage, "put_private", lambda key, data, ct="": fake.put("private", key, data, ct))
    monkeypatch.setattr(storage, "client", lambda: fake)
    return fake


@pytest_asyncio.fixture
async def apply_client(db: AsyncSession, fake_redis: "FakeRedis", fake_storage: FakeStorage) -> AsyncIterator[AsyncClient]:
    """`/api/apply/*` 用的 client：假 redis（限流）、假 MinIO（上傳）。"""
    from app.redis_client import get_redis

    app = create_app()

    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db

    async def _get_redis():
        return fake_redis

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_redis] = _get_redis
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def admin_client(db: AsyncSession, fake_storage: FakeStorage) -> AsyncIterator[AsyncClient]:
    """`/api/admin/*` 用的 client，帶假 MinIO（presigned URL 與上傳）。"""
    app = create_app()

    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = _get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def default_tenant(db: AsyncSession) -> Tenant:
    """匿名端點會找 `slug="default"` 的 tenant（決策 D18）。"""
    t = Tenant(id="d" * 32, name="預設機關", slug="default")
    db.add(t)
    await db.commit()
    return t


# ------------------------------------------------------------------- LINE

@pytest.fixture(autouse=True)
def reset_contents_cache():
    """罐頭訊息快取是程序層的，而且每個測試的 tenant id 都一樣——不清就會串味。"""
    from app.services import contents

    contents.invalidate()
    yield
    contents.invalidate()


@pytest.fixture
def line_sender():
    """不連網路的 sender。`.sent` 裡是 bot 這次送出的每一則訊息。"""
    from app.services.line import sender

    fake = sender.NoopLineSender()
    sender.set_sender_for_testing(fake)
    yield fake
    sender.reset_sender()


@pytest.fixture
def rich_menu_client():
    """記憶體版的 LINE rich menu API，`calls` 看得到呼叫順序。"""
    from app.services.line import richmenu

    client = richmenu.NoopRichMenuClient()
    richmenu.set_client_for_testing(client)
    yield client
    richmenu.set_client_for_testing(None)


# ------------------------------------------------- P4：SOP session 用的替身

class FakeAsyncRedis:
    """SOP session 存放處的記憶體替身（`app.redis_client.redis()`）。

    `ai/session_graph.py` 的 `SessionStore` 與 `SessionLock` 只用到 set / get /
    delete / eval 四個指令，所以這裡也只實作那四個加上 incr / expire。
    TTL 記下來但不真的到期——要驗的是「逾時後 session 被刪掉」，不是時鐘。
    """

    def __init__(self) -> None:
        self.values: dict[str, bytes] = {}
        self.ttls: dict[str, float] = {}

    async def set(self, key: str, value: Any, *, ex: Any = None, nx: bool = False, px: Any = None) -> bool | None:
        if nx and key in self.values:
            return None
        self.values[key] = value.encode() if isinstance(value, str) else bytes(value)
        if ex is not None:
            self.ttls[key] = float(ex)
        if px is not None:
            self.ttls[key] = float(px) / 1000
        return True

    async def get(self, key: str) -> bytes | None:
        return self.values.get(key)

    async def delete(self, *keys: str) -> int:
        return sum(1 for k in keys if self.values.pop(k, None) is not None)

    async def eval(self, script: str, numkeys: int, *args: Any) -> int:
        """只支援 `SessionLock` 那一段「值相符才刪」的腳本。"""
        key = str(args[0])
        token = args[1]
        want = token.encode() if isinstance(token, str) else token
        if self.values.get(key) == want:
            del self.values[key]
            return 1
        return 0

    async def incr(self, key: str) -> int:
        value = int(self.values.get(key, b"0")) + 1
        self.values[key] = str(value).encode()
        return value

    async def expire(self, key: str, seconds: int) -> bool:
        self.ttls[key] = float(seconds)
        return True

    def sessions(self) -> list[str]:
        """目前存在的 session key，測試用它斷言「退出時真的刪掉了」。"""
        return sorted(k for k in self.values if k.startswith("sess:"))


@pytest.fixture(autouse=True)
def session_redis(monkeypatch) -> FakeAsyncRedis:
    """測試永遠不連真的 Redis（CLAUDE.md 規則 7 的同一個理由）。

    `redis()` 有 `lru_cache`，所以換掉的是模組上的那個名字，不是快取內容。
    """
    from app import redis_client

    fake = FakeAsyncRedis()
    monkeypatch.setattr(redis_client, "redis", lambda: fake)
    for module in ("app.ai.session_graph", "app.ai.assistant"):
        mod = importlib.import_module(module)
        if hasattr(mod, "redis"):
            monkeypatch.setattr(mod, "redis", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def llm_usage(monkeypatch) -> list[dict[str, Any]]:
    """`llm_usage` 的寫入換成記憶體清單，回傳的數字跟正式環境一模一樣。

    正式環境的 `record_usage()` 會另開一個 `sessionmaker()` session 把用量寫進
    資料庫；測試裡那個 sessionmaker 指著真的 Postgres，於是每一次模型呼叫都在
    對著不存在的資料庫撥號。算錢的那一段是純算術（`llm.usage_record`），
    這裡只把「寫進資料庫」換掉，測試因此仍然看得到 token 與成本。
    """
    from app.ai import llm

    rows: list[dict[str, Any]] = []

    async def record(task: str, model: str, usage: dict, latency_ms: int, tenant_id: str | None,
                     ref_type: str = "", ref_id: str = "") -> dict[str, Any]:
        rec = llm.usage_record(task, model, usage, latency_ms)
        rows.append({**rec, "tenant_id": tenant_id, "ref_type": ref_type, "ref_id": ref_id})
        return rec

    monkeypatch.setattr(llm, "record_usage", record)
    return rows


@pytest.fixture(autouse=True)
def arq_pool(monkeypatch) -> list[tuple[str, tuple[Any, ...]]]:
    """排入背景工作也不連 Redis，只記下「誰被排進去了」。

    在 P4 之前這一層沒有替身，於是每一個會寫 `notifications` 的測試都在對著
    `localhost:6379` 撥號、等它拒絕、再吞掉例外——慢，而且日誌裡全是雜訊。
    """
    from app import jobs

    calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fake_enqueue(name: str, *args: Any, **kwargs: Any) -> str:
        calls.append((name, args))
        return f"job:{name}:{len(calls)}"

    monkeypatch.setattr(jobs, "enqueue", fake_enqueue)
    return calls
