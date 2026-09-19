"""第一個管理者怎麼進得來（決策 D26）。

閘門看的是「有沒有還在用的 owner」，不是「有沒有 tenant」。`scripts/seed.py` 會先
把機關與方案灌進資料庫，所以「tenant 已經存在、但一個使用者都沒有」是正常安裝流程
裡真的會出現的狀態——舊的閘門在那個狀態下會回 `needs_bootstrap=false` 並把端點關掉，
於是誰都進不去，而且沒有補救的路。
"""

from __future__ import annotations

import pytest
from app.models import Tenant, User
from app.security import hash_password
from sqlalchemy import select

AUTH = "/api/auth"
OWNER = {
    "tenant_name": "新竹市政府",
    "tenant_slug": "default",
    "owner_email": "owner@example.gov.tw",
    "owner_password": "correct horse battery 9",
    "owner_name": "首位管理者",
}


async def _users(db):
    return (await db.execute(select(User))).scalars().all()


async def _tenants(db):
    return (await db.execute(select(Tenant))).scalars().all()


# ------------------------------------------------------------ 全新資料庫

async def test_a_fresh_database_needs_bootstrap(client):
    assert (await client.get(f"{AUTH}/bootstrap-status")).json() == {"needs_bootstrap": True}


async def test_a_fresh_database_gets_a_tenant_and_an_owner(client, db):
    r = await client.post(f"{AUTH}/bootstrap", json=OWNER)
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]
    tenants = await _tenants(db)
    users = await _users(db)
    assert [t.slug for t in tenants] == ["default"]
    assert [(u.email, u.role) for u in users] == [("owner@example.gov.tw", "owner")]
    assert users[0].tenant_id == tenants[0].id


# -------------------------------------------- seed 過但還沒有任何使用者

async def test_a_seeded_but_userless_database_still_needs_bootstrap(client, tenant):
    """這就是 seed.py 跑完、還沒有人註冊的那一刻。"""
    assert (await client.get(f"{AUTH}/bootstrap-status")).json() == {"needs_bootstrap": True}


async def test_bootstrap_attaches_the_owner_to_the_existing_tenant(client, db, tenant):
    r = await client.post(f"{AUTH}/bootstrap", json=OWNER)
    assert r.status_code == 200, r.text
    tenants = await _tenants(db)
    users = await _users(db)
    assert len(tenants) == 1, "不該為了一個 owner 再開一個機關"
    assert tenants[0].id == tenant.id and tenants[0].name == tenant.name
    assert users[0].tenant_id == tenant.id


async def test_a_tenant_with_only_non_owner_users_still_needs_bootstrap(client, db, tenant):
    """有承辦人、但沒有 owner：沒有人改得了設定，仍然要能建立第一個管理者。"""
    db.add(User(tenant_id=tenant.id, email="clerk@example.gov.tw", name="承辦",
                role="case_reviewer", password_hash=hash_password("x")))
    await db.commit()
    assert (await client.get(f"{AUTH}/bootstrap-status")).json() == {"needs_bootstrap": True}


async def test_a_disabled_owner_does_not_count_as_bootstrapped(client, db, tenant):
    """唯一的 owner 被停用了，等於沒有人進得來。"""
    db.add(User(tenant_id=tenant.id, email="old@example.gov.tw", name="舊管理者",
                role="owner", password_hash=hash_password("x"), is_active=False))
    await db.commit()
    assert (await client.get(f"{AUTH}/bootstrap-status")).json() == {"needs_bootstrap": True}


# --------------------------------------------------------- 已經初始化過

@pytest.fixture
async def bootstrapped(db, tenant):
    db.add(User(tenant_id=tenant.id, email="owner@example.gov.tw", name="管理者",
                role="owner", password_hash=hash_password("x")))
    await db.commit()


async def test_an_active_owner_closes_the_gate(client, bootstrapped):
    assert (await client.get(f"{AUTH}/bootstrap-status")).json() == {"needs_bootstrap": False}


async def test_bootstrapping_twice_is_refused(client, db, bootstrapped):
    r = await client.post(f"{AUTH}/bootstrap", json={**OWNER, "owner_email": "second@example.gov.tw"})
    assert r.status_code == 403
    assert len(await _users(db)) == 1


async def test_an_owner_in_another_tenant_also_closes_the_gate(client, db, tenant):
    """閘門是「任何一個機關裡有 owner」——多租戶部署不該被第二個人重開一次。"""
    other = Tenant(id="o" * 32, name="另一個機關", slug="other")
    db.add(other)
    await db.flush()
    db.add(User(tenant_id=other.id, email="owner@other.gov.tw", name="管理者",
                role="owner", password_hash=hash_password("x")))
    await db.commit()
    assert (await client.get(f"{AUTH}/bootstrap-status")).json() == {"needs_bootstrap": False}
    assert (await client.post(f"{AUTH}/bootstrap", json=OWNER)).status_code == 403


# ------------------------------------------------- 環境變數版（lifespan）

@pytest.fixture
def env_bootstrap(monkeypatch, engine):
    """`_bootstrap_from_env()` 用全域 sessionmaker；指到測試那顆記憶體資料庫。"""
    from app import main as main_module
    from app.config import get_settings
    from sqlalchemy.ext.asyncio import async_sessionmaker

    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(main_module, "sessionmaker", lambda: maker)
    settings = get_settings()
    monkeypatch.setattr(settings, "bootstrap_tenant_name", "新竹市政府", raising=False)
    monkeypatch.setattr(settings, "bootstrap_owner_email", "ENV@example.gov.tw", raising=False)
    monkeypatch.setattr(settings, "bootstrap_owner_password", "env password 9", raising=False)
    return maker


async def test_env_bootstrap_reuses_the_seeded_tenant(env_bootstrap, db, tenant):
    from app.main import _bootstrap_from_env

    await _bootstrap_from_env()
    assert len(await _tenants(db)) == 1, "seed 已經建好機關，不該再開第二個"
    users = await _users(db)
    assert [(u.email, u.role, u.tenant_id) for u in users] == [("env@example.gov.tw", "owner", tenant.id)]


async def test_env_bootstrap_does_nothing_when_an_owner_exists(env_bootstrap, db, bootstrapped):
    from app.main import _bootstrap_from_env

    await _bootstrap_from_env()
    assert len(await _users(db)) == 1
