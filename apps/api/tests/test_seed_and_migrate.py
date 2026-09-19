"""seed 與 migrate_legacy：跑得完、跑兩次結果一樣（SPEC §12）。

兩支腳本都用 `app.db.sessionmaker`，測試把它換成 in-memory 的 session factory，
所以整個流程是真的跑過一遍，只是落在 SQLite 上。
"""

import sqlite3
import sys
from pathlib import Path

import pytest
from app.models import (
    Application,
    ApplicationStatusEvent,
    CaseVerification,
    Content,
    DocumentType,
    EligibleTool,
    Faq,
    KnowledgeDocument,
    LineUser,
    PaymentChannel,
    RejectionCode,
    ReviewRule,
    Scheme,
    SchemeTier,
)
from app.pii import decrypt_phone, hash_last4
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(SCRIPTS / "migrate_legacy"))

import seed  # noqa: E402
import seed_data  # noqa: E402
from scripts.migrate_legacy import youth  # noqa: E402


@pytest.fixture
def session_factory(engine, monkeypatch):
    """把腳本用的 sessionmaker 指向測試資料庫。"""
    maker = async_sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(seed, "sessionmaker", lambda: maker)
    monkeypatch.setattr(youth, "sessionmaker", lambda: maker)
    return maker


async def count(db, model) -> int:
    return (await db.execute(select(func.count(model.id)))).scalar_one()


# ------------------------------------------------------------------- seed

async def test_seed_inserts_the_whole_scheme(db, session_factory):
    report = await seed.run()
    assert report["failed"] == 0
    assert report["scheme:inserted"] == 1 + len(seed_data.OTHER_SCHEMES)
    assert report["document_type:inserted"] == 12
    assert report["rejection_code:inserted"] == 12
    assert report["payment_channel:inserted"] == 4
    assert report["tier:inserted"] == 2
    assert report["faq:inserted"] == 10
    assert report["application:inserted"] == 5


async def test_seed_is_idempotent(db, session_factory):
    first = await seed.run()
    second = await seed.run()
    assert second["inserted"] == 0 and second["updated"] == 0
    assert second["skipped"] == first["inserted"]
    assert await count(db, Scheme) == 5
    assert await count(db, Application) == 5
    assert await count(db, DocumentType) == 12


async def test_seed_covers_the_four_rule_types(db, session_factory):
    await seed.run()
    rules = list((await db.execute(select(ReviewRule))).scalars())
    assert {r.rule_type for r in rules} == {"keyword_extract", "regex_extract", "amount_tolerance", "required_doc"}
    tolerance = next(r for r in rules if r.rule_type == "amount_tolerance")
    # tolerance_pct 是百分比（5 = 5%），與 services/review.py 和 @maydru/review-rules 一致。
    assert tolerance.config["tolerance_pct"] == 5 and tolerance.config["tolerance_abs"] == 150
    assert tolerance.config["compare_to"] == "purchase_amount"


async def test_seeded_document_types_carry_the_masking_rules(db, session_factory):
    await seed.run()
    docs = {d.code: d for d in (await db.execute(select(DocumentType))).scalars()}
    assert docs["BILLING_STATEMENT"].must_mask and docs["BILLING_STATEMENT"].keep_visible
    assert not docs["ID_CARD_FRONT"].must_mask
    assert docs["ID_CARD_FRONT"].required
    assert docs["PROXY_AFFIDAVIT"].required_when == "proxy"


async def test_seeded_channels_carry_the_channel_docs_table(db, session_factory):
    await seed.run()
    channels = {c.code: c for c in (await db.execute(select(PaymentChannel))).scalars()}
    assert channels["CREDIT_CARD"].required_document_type_codes == ["CARD_LAST4_PHOTO", "BILLING_STATEMENT"]
    assert channels["E_PAYMENT"].required_document_type_codes == ["PAYER_ACCOUNT_PROOF", "TRANSACTION_DETAIL"]


async def test_seeded_tools_split_into_approved_rejected_and_pending(db, session_factory):
    await seed.run()
    tools = list((await db.execute(select(EligibleTool))).scalars())
    by_status = {}
    for t in tools:
        by_status.setdefault(t.status, []).append(t.name)
    assert len(by_status["APPROVED"]) == 7
    assert len(by_status["REJECTED"]) == 9
    assert len(by_status["PENDING"]) == 7   # Canva 逐案認定 + 6 筆待審
    assert "豆包（Doubao）" in by_status["REJECTED"]


async def test_demo_cases_cover_one_status_each(db, session_factory):
    await seed.run()
    apps = {a.case_no: a for a in (await db.execute(select(Application))).scalars()}
    assert {a.status for a in apps.values()} == {
        "SUBMITTED", "UNDER_REVIEW", "NEEDS_REVISION", "APPROVED", "DISBURSED"}
    disbursed = next(a for a in apps.values() if a.status == "DISBURSED")
    assert disbursed.documents_purge_at is not None and disbursed.payment_amount == 2700


async def test_demo_documents_point_at_nothing_real(db, session_factory):
    """示範資料不得夾帶任何真實影像（CLAUDE.md 規則 9）。"""
    from app.models import ApplicationDocument

    await seed.run()
    docs = list((await db.execute(select(ApplicationDocument))).scalars())
    assert docs
    assert all(d.preview_key is None and d.object_key.startswith("demo/") and d.size == 0 for d in docs)


async def test_demo_cases_have_a_real_event_timeline(db, session_factory):
    await seed.run()
    needs_revision = (await db.execute(select(Application).where(
        Application.status == "NEEDS_REVISION"))).scalars().one()
    codes = [e.transition_code for e in (await db.execute(
        select(ApplicationStatusEvent)
        .where(ApplicationStatusEvent.application_id == needs_revision.id)
        .order_by(ApplicationStatusEvent.created_at))).scalars()]
    assert codes == ["T0", "T1", "T2"]
    assert needs_revision.supplement_items[0]["rejection_code"] == "BILLING_NO_TWD"


async def test_the_submitted_demo_case_never_ran_t1(db, session_factory):
    await seed.run()
    submitted = (await db.execute(select(Application).where(
        Application.status == "SUBMITTED"))).scalars().one()
    codes = [e.transition_code for e in (await db.execute(select(ApplicationStatusEvent).where(
        ApplicationStatusEvent.application_id == submitted.id))).scalars()]
    assert codes == ["T0"]


# --------------------------------------------------------- migrate_legacy

LEGACY_SCHEMA = """
CREATE TABLE subsidies (subsidy_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '其他',
  description TEXT NOT NULL DEFAULT '', eligibility TEXT NOT NULL DEFAULT '', age_min INTEGER, age_max INTEGER,
  application_start TEXT, application_end TEXT, required_documents TEXT NOT NULL DEFAULT '[]',
  application_method TEXT NOT NULL DEFAULT '', official_url TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '',
  amount_note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', identity_tags TEXT NOT NULL DEFAULT '[]',
  student_requirement TEXT NOT NULL DEFAULT 'any', employment_requirement TEXT NOT NULL DEFAULT 'any',
  residency_requirement TEXT, details TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT 'system',
  version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE cases (case_id TEXT PRIMARY KEY, applicant_name TEXT, phone TEXT NOT NULL, subsidy_id TEXT,
  status TEXT NOT NULL, submitted_at TEXT, updated_at TEXT NOT NULL, supplement_required INTEGER NOT NULL DEFAULT 0,
  supplement_items TEXT NOT NULL DEFAULT '[]', supplement_deadline TEXT,
  payment_status TEXT NOT NULL DEFAULT 'not_applicable', payment_date TEXT, payment_amount INTEGER,
  next_action TEXT, note TEXT, created_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT 'system',
  version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE case_status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL, from_status TEXT,
  to_status TEXT NOT NULL, changed_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'system',
  notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE faqs (faq_id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT '一般', question TEXT NOT NULL,
  answer TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '[]', priority INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL DEFAULT 'system',
  version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE line_users (line_user_id TEXT PRIMARY KEY, display_name TEXT, created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL);
CREATE TABLE user_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, line_user_id TEXT NOT NULL, case_id TEXT NOT NULL,
  verified_at TEXT NOT NULL, UNIQUE(line_user_id, case_id));
CREATE TABLE knowledge_documents (doc_id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'manual',
  tags TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE contents (content_key TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'general', title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', draft TEXT,
  content_type TEXT NOT NULL DEFAULT 'text', variables TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT 'system',
  version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE admin_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE conversation_states (line_user_id TEXT PRIMARY KEY, flow TEXT NOT NULL, step TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
"""

NOW = "2026-09-16T02:32:37.897Z"


@pytest.fixture
def legacy_db(tmp_path) -> Path:
    """用真的 youth.db schema 建一份小樣本（盤點 §11）。"""
    path = tmp_path / "youth.db"
    con = sqlite3.connect(path)
    con.executescript(LEGACY_SCHEMA)
    con.execute(
        "INSERT INTO subsidies (subsidy_id,name,category,age_min,age_max,application_end,tags,details,active,"
        "updated_at,residency_requirement) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ("HCAI115", "115年度 AI領航青年數位工具補助計畫", "數位工具", 16, 40, "2026-11-30",
         '["AI","數位工具"]', '[{"label":"申請期間","value":"115/4/2"}]', 1, NOW, "新竹市"))
    con.execute(
        "INSERT INTO subsidies (subsidy_id,name,category,active,updated_at) VALUES (?,?,?,?,?)",
        ("HCRENT115", "新竹好好租", "居住", 1, NOW))
    con.execute(
        "INSERT INTO cases (case_id,applicant_name,phone,subsidy_id,status,submitted_at,updated_at,"
        "supplement_items,supplement_deadline,payment_status,payment_date,payment_amount,note,created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("20260002", "測試用小華", "0987654321", "HCRENT115", "supplement_required",
         "2026-08-20T00:00:00.000Z", "2026-09-10T00:00:00.000Z",
         '["最近年度所得清單","房屋所有權人證明"]', "2026-09-30T00:00:00.000Z",
         "not_applicable", None, None, "示範資料", NOW))
    con.execute(
        "INSERT INTO cases (case_id,applicant_name,phone,subsidy_id,status,submitted_at,updated_at,"
        "supplement_items,payment_status,payment_date,payment_amount,note,created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("20260004", "測試用小強", "0900111222", "HCAI115", "paid",
         "2026-06-10T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "[]", "paid",
         "2026-08-28T00:00:00.000Z", 24000, "示範資料", NOW))
    con.execute("INSERT INTO case_status_history (case_id,from_status,to_status,changed_at,source) "
                "VALUES ('20260004',NULL,'paid',?, 'import')", (NOW,))
    con.execute("INSERT INTO case_status_history (case_id,from_status,to_status,changed_at,source) "
                "VALUES ('20260002',NULL,'supplement_required',?, 'import')", (NOW,))
    con.execute("INSERT INTO faqs (faq_id,category,question,answer,keywords,priority,updated_at) "
                "VALUES ('FAQ001','資格條件','誰可以申請？','設籍新竹市的青年。','[\"資格\"]',10,?)", (NOW,))
    con.execute("INSERT INTO knowledge_documents (doc_id,title,content,tags,updated_at) "
                "VALUES ('KB-AI-115','AI 補助簡章','內容',' []',?)", (NOW,))
    con.execute("INSERT INTO contents (content_key,category,title,content,draft,updated_at) "
                "VALUES ('home.welcome','home','歡迎訊息','👋 歡迎','草稿版',?)", (NOW,))
    con.execute("INSERT INTO line_users (line_user_id,display_name,created_at,last_seen_at) "
                "VALUES ('Uflow20260002','小華',?,?)", (NOW, NOW))
    con.execute("INSERT INTO user_cases (line_user_id,case_id,verified_at) "
                "VALUES ('Uflow20260002','20260002',?)", (NOW,))
    con.execute("INSERT INTO admin_users (username,password_hash) VALUES ('Sam','x')")
    con.execute("INSERT INTO conversation_states (line_user_id,flow,step,updated_at) "
                "VALUES ('Uflow20260002','case_verify','ask_phone',?)", (NOW,))
    con.commit()
    con.close()
    return path


async def test_migration_moves_every_supported_table(db, tenant, session_factory, legacy_db):
    report = await youth.run(legacy_db)
    assert report["failed"] == 0
    assert await count(db, Scheme) == 2
    assert await count(db, Application) == 2
    assert await count(db, Faq) == 1
    assert await count(db, KnowledgeDocument) == 1
    assert await count(db, Content) == 1
    assert await count(db, LineUser) == 1
    assert await count(db, CaseVerification) == 1
    assert await count(db, ApplicationStatusEvent) == 2


async def test_legacy_statuses_map_per_d13(db, tenant, session_factory, legacy_db):
    await youth.run(legacy_db)
    apps = {a.case_no: a for a in (await db.execute(select(Application))).scalars()}
    assert apps["20260002"].status == "NEEDS_REVISION"
    assert apps["20260004"].status == "DISBURSED"
    assert all(a.intake_channel == "LEGACY" for a in apps.values())


@pytest.mark.parametrize("legacy,expected", [
    ("submitted", "SUBMITTED"),
    ("eligibility_review", "UNDER_REVIEW"),
    ("document_review", "UNDER_REVIEW"),
    ("supplement_required", "NEEDS_REVISION"),
    ("review_completed", "APPROVED"),
    ("approved", "APPROVED"),
    ("rejected", "REJECTED"),
    ("paid", "DISBURSED"),
])
def test_the_whole_status_map(legacy, expected):
    assert youth.STATUS_MAP[legacy] == expected


def test_an_approved_case_already_in_payment_lands_in_disbursing():
    row = {"status": "approved", "payment_status": "processing"}
    assert youth._status_for(row) == "DISBURSING"
    assert youth._status_for({"status": "approved", "payment_status": "not_applicable"}) == "APPROVED"


async def test_case_numbers_are_carried_over_verbatim(db, tenant, session_factory, legacy_db):
    await youth.run(legacy_db)
    numbers = sorted(a.case_no for a in (await db.execute(select(Application))).scalars())
    assert numbers == ["20260002", "20260004"]


async def test_phones_arrive_encrypted_and_hashed_never_plain(db, tenant, session_factory, legacy_db):
    await youth.run(legacy_db)
    app = (await db.execute(select(Application).where(Application.case_no == "20260002"))).scalars().one()
    assert "0987654321" not in app.phone_encrypted
    assert decrypt_phone(app.phone_encrypted) == "0987654321"
    assert app.phone_last4_hash == hash_last4("4321")


async def test_supplement_items_become_structured_rows(db, tenant, session_factory, legacy_db):
    await youth.run(legacy_db)
    app = (await db.execute(select(Application).where(Application.case_no == "20260002"))).scalars().one()
    assert app.supplement_items == [
        {"document_type_code": None, "rejection_code": "OTHER", "note": "最近年度所得清單"},
        {"document_type_code": None, "rejection_code": "OTHER", "note": "房屋所有權人證明"},
    ]
    assert app.supplement_deadline is not None


async def test_contents_keep_both_published_and_draft(db, tenant, session_factory, legacy_db):
    await youth.run(legacy_db)
    row = (await db.execute(select(Content))).scalars().one()
    assert row.key == "home.welcome" and row.content == "👋 歡迎" and row.draft == "草稿版"


async def test_line_bindings_survive_so_the_first_push_lands(db, tenant, session_factory, legacy_db):
    await youth.run(legacy_db)
    binding = (await db.execute(select(CaseVerification))).scalars().one()
    app = (await db.execute(select(Application).where(Application.case_no == "20260002"))).scalars().one()
    assert binding.line_user_id == "Uflow20260002" and binding.application_id == app.id


async def test_accounts_and_conversations_are_deliberately_left_behind(db, tenant, session_factory, legacy_db):
    report = await youth.run(legacy_db)
    assert report["admin_users:not_migrated"] == 1
    assert report["conversation_states:not_migrated"] == 1
    from app.models import User

    assert await count(db, User) == 0


async def test_migration_is_idempotent(db, tenant, session_factory, legacy_db):
    first = await youth.run(legacy_db)
    second = await youth.run(legacy_db)
    assert second["inserted"] == 0 and second["updated"] == 0 and second["failed"] == 0
    assert second["skipped"] == first["inserted"]
    assert await count(db, Application) == 2
    assert await count(db, ApplicationStatusEvent) == 2


async def test_a_case_whose_scheme_is_missing_is_reported_not_crashed(db, tenant, session_factory, legacy_db):
    con = sqlite3.connect(legacy_db)
    con.execute("INSERT INTO cases (case_id,applicant_name,phone,subsidy_id,status,updated_at,"
                "supplement_items,payment_status,note,created_at) "
                "VALUES ('20269999','孤兒案','0911111111','GONE','submitted',?, '[]','not_applicable','',?)",
                (NOW, NOW))
    con.commit()
    con.close()

    report = await youth.run(legacy_db)
    assert report["application:failed"] == 1
    assert await count(db, Application) == 2  # 其他兩筆照樣進來


async def test_the_source_database_is_opened_read_only(legacy_db):
    con = youth.open_source(legacy_db)
    with pytest.raises(sqlite3.OperationalError):
        con.execute("DELETE FROM cases")
    con.close()


async def test_migration_then_seed_leaves_the_scheme_fully_configured(db, tenant, session_factory, legacy_db):
    """SPEC §12：方案的基本資料來自舊系統，子設定表由 seed 補上。"""
    await youth.run(legacy_db)
    await seed.run()
    scheme = (await db.execute(select(Scheme).where(Scheme.code == "HCAI115"))).scalars().one()
    assert await count(db, SchemeTier) == 2
    assert await count(db, DocumentType) == 12
    assert await count(db, RejectionCode) == 12
    assert scheme.code == "HCAI115"
