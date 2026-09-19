"""youth-line-bot（SQLite）→ MayDru（Postgres）搬遷（SPEC §12、決策 D13）。

    uv run --package maydru-api python scripts/migrate_legacy/youth.py [youth.db 路徑]

來源以唯讀模式開啟，一個位元組都不會寫回去。整支腳本冪等：自然鍵決定「已經搬過了」，
重跑只會更新變動的欄位。

**不搬**（SPEC §12）：`admin_users`、`admin_sessions`、`notifications`、`sync_logs`、
`import_runs`、`conversation_states`——帳號重建、會話重置，把舊的會話狀態帶過來只會
讓第一批使用者卡在一個已經不存在的流程裡。

案件的狀態歷史是重建，不是重新發生，所以這裡直接寫 `applications` 與
`application_status_events`，不走 `transition()`：舊案件的時間、順序與理由是既成事實，
不該被今天的規則重新檢查一次。
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sqlite3
import sys
from collections import Counter
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.db import sessionmaker  # noqa: E402
from app.models import (  # noqa: E402
    Application,
    ApplicationStatusEvent,
    CaseVerification,
    Content,
    Faq,
    KnowledgeDocument,
    LineUser,
    Scheme,
    Tenant,
)
from app.pii import decrypt_phone, encrypt_phone, hash_last4  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

# apps/api/scripts/migrate_legacy/youth.py → parents[5] 是放著所有專案的那層目錄，
# 也就是從 apps/api 看出去的 `../../../`。
DEFAULT_DB = Path(__file__).resolve().parents[5] / "youth-line-bot" / "data" / "youth.db"

# 決策 D13：舊狀態 → SPEC §7 狀態。
STATUS_MAP: dict[str, str] = {
    "submitted": "SUBMITTED",
    "eligibility_review": "UNDER_REVIEW",
    "document_review": "UNDER_REVIEW",
    "supplement_required": "NEEDS_REVISION",
    "review_completed": "APPROVED",
    "approved": "APPROVED",
    "rejected": "REJECTED",
    "paid": "DISBURSED",
}
# `approved` 且已經在撥款程序裡的案子落在 DISBURSING，而不是停在 APPROVED。
PAYMENT_OVERRIDE = {"pending": "DISBURSING", "processing": "DISBURSING"}
LEGACY_CODE = "LEGACY"
LEGACY_REJECT_REASON = "（舊系統匯入）"

SKIPPED_TABLES = ("admin_users", "admin_sessions", "notifications", "sync_logs",
                  "import_runs", "conversation_states")


class Report(Counter):
    pass


def _row_id(*parts: str) -> str:
    """由來源主鍵推導出穩定的 32 字元 id，重跑時才認得出同一列。"""
    return hashlib.md5(("youth:" + ":".join(parts)).encode()).hexdigest()


def _json(raw: Any, fallback: Any) -> Any:
    if raw in (None, ""):
        return fallback
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return fallback


def _dt(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _date(raw: Any) -> date | None:
    parsed = _dt(raw)
    return parsed.date() if parsed else None


def _status_for(row: sqlite3.Row) -> str:
    status = STATUS_MAP.get(row["status"], "SUBMITTED")
    if status == "APPROVED" and row["status"] == "approved":
        status = PAYMENT_OVERRIDE.get(row["payment_status"] or "", status)
    return status


def _supplement_items(raw: Any) -> list[dict[str, Any]]:
    """舊系統的補件項目是一串字串；SPEC §7 要的是結構化的三欄（D13）。"""
    return [
        {"document_type_code": None, "rejection_code": "OTHER", "note": str(item)}
        for item in _json(raw, [])
    ]


def _phone_cipher(existing: Any, phone: str) -> str:
    """Fernet 每次加密都帶新的 nonce，所以密文本身比對不得——同一個號碼重跑一次就會
    看起來「改過了」。既有密文解得回同一個號碼就原封不動留著，報表才說得準。"""
    if existing is not None and decrypt_phone(existing.phone_encrypted) == phone:
        return str(existing.phone_encrypted)
    return encrypt_phone(phone)


def _same(old: Any, new: Any) -> bool:
    """SQLite 讀回來的時間沒有時區，Postgres 有。兩邊都當成 UTC 再比，
    否則在 SQLite 上每跑一次都會看起來「改過了」。"""
    if isinstance(old, datetime) and isinstance(new, datetime):
        a = old if old.tzinfo else old.replace(tzinfo=UTC)
        b = new if new.tzinfo else new.replace(tzinfo=UTC)
        return a == b
    return bool(old == new)


def _apply(obj: Any, fields: dict[str, Any]) -> bool:
    changed = False
    for key, value in fields.items():
        if hasattr(obj, key) and not _same(getattr(obj, key), value):
            setattr(obj, key, value)
            changed = True
    return changed


async def _upsert(db: AsyncSession, model: Any, where: list[Any], fields: dict[str, Any],
                  report: Report, label: str) -> Any:
    obj = (await db.execute(select(model).where(*where))).scalar_one_or_none()
    if obj is None:
        obj = model(**fields)
        db.add(obj)
        await db.flush()
        report[f"{label}:inserted"] += 1
        report["inserted"] += 1
        return obj
    if _apply(obj, fields):
        report[f"{label}:updated"] += 1
        report["updated"] += 1
    else:
        report[f"{label}:skipped"] += 1
        report["skipped"] += 1
    return obj


# ---------------------------------------------------------------- 各張表

async def migrate_contents(db: AsyncSession, src: sqlite3.Connection, tenant: Tenant, report: Report) -> None:
    """罐頭訊息：key 原名搬入，`content` 與 `draft` 都帶。

    內容 registry 的預設值在 P2 才會進來，所以現在完全照舊系統的字面搬，
    category / title / content / draft 一字不改。
    """
    for row in src.execute("SELECT * FROM contents"):
        try:
            await _upsert(db, Content, [Content.tenant_id == tenant.id, Content.key == row["content_key"]], {
                "tenant_id": tenant.id,
                "key": row["content_key"],
                "category": row["category"] or "general",
                "title": row["title"] or "",
                "description": row["description"] or "",
                "content": row["content"] or "",
                "draft": row["draft"],
                "content_type": row["content_type"] or "text",
                "variables": _json(row["variables"], []),
                "sort_order": row["sort_order"] or 0,
            }, report, "content")
        except Exception as e:  # noqa: BLE001
            report["content:failed"] += 1
            report["failed"] += 1
            print(f"  ! contents {row['content_key']}: {e}")


async def migrate_subsidies(db: AsyncSession, src: sqlite3.Connection, tenant: Tenant,
                            report: Report) -> dict[str, Scheme]:
    """補助方案 → schemes。子設定表（級距、文件、管道、規則）由 seed.py 補上。"""
    schemes: dict[str, Scheme] = {}
    for row in src.execute("SELECT * FROM subsidies"):
        code = row["subsidy_id"]
        try:
            scheme = await _upsert(db, Scheme, [Scheme.tenant_id == tenant.id, Scheme.code == code], {
                "tenant_id": tenant.id,
                "code": code,
                "name": row["name"],
                "category": row["category"] or "",
                "description": row["description"] or "",
                "eligibility": row["eligibility"] or "",
                "age_min": row["age_min"],
                "age_max": row["age_max"],
                "application_start": _date(row["application_start"]),
                "application_end": _date(row["application_end"]),
                "official_url": row["official_url"] or "",
                "contact": row["contact"] or "",
                "amount_note": row["amount_note"] or "",
                "tags": _json(row["tags"], []),
                "identity_tags": _json(row["identity_tags"], []),
                "details": _json(row["details"], []),
                "active": bool(row["active"]),
                "application_method": row["application_method"] or "",
                "required_documents": _json(row["required_documents"], []),
                "student_requirement": row["student_requirement"] or "any",
                "employment_requirement": row["employment_requirement"] or "any",
                "residency_requirement": row["residency_requirement"] or "",
                "image_url": row["image_url"] or "",
            }, report, "scheme")
            schemes[code] = scheme
        except Exception as e:  # noqa: BLE001
            report["scheme:failed"] += 1
            report["failed"] += 1
            print(f"  ! subsidies {code}: {e}")
    return schemes


async def migrate_faqs(db: AsyncSession, src: sqlite3.Connection, tenant: Tenant, report: Report) -> None:
    """embedding 留空：批次算向量是 P2 內容服務的工作，不該綁在搬遷上。"""
    for row in src.execute("SELECT * FROM faqs"):
        try:
            await _upsert(db, Faq, [Faq.tenant_id == tenant.id, Faq.code == row["faq_id"]], {
                "tenant_id": tenant.id,
                "code": row["faq_id"],
                "category": row["category"] or "",
                "question": row["question"],
                "answer": row["answer"] or "",
                "keywords": _json(row["keywords"], []),
                "priority": row["priority"] or 0,
                "active": bool(row["active"]),
                "source": "manual",
            }, report, "faq")
        except Exception as e:  # noqa: BLE001
            report["faq:failed"] += 1
            report["failed"] += 1
            print(f"  ! faqs {row['faq_id']}: {e}")


async def migrate_knowledge(db: AsyncSession, src: sqlite3.Connection, tenant: Tenant, report: Report) -> None:
    for row in src.execute("SELECT * FROM knowledge_documents"):
        try:
            await _upsert(db, KnowledgeDocument,
                          [KnowledgeDocument.tenant_id == tenant.id, KnowledgeDocument.code == row["doc_id"]], {
                              "tenant_id": tenant.id,
                              "code": row["doc_id"],
                              "title": row["title"],
                              "content": row["content"] or "",
                              "source_url": row["source_url"] or "",
                              "source_type": row["source_type"] or "manual",
                              "tags": _json(row["tags"], []),
                          }, report, "knowledge_document")
        except Exception as e:  # noqa: BLE001
            report["knowledge_document:failed"] += 1
            report["failed"] += 1
            print(f"  ! knowledge_documents {row['doc_id']}: {e}")


async def migrate_line_users(db: AsyncSession, src: sqlite3.Connection, tenant: Tenant, report: Report) -> None:
    for row in src.execute("SELECT * FROM line_users"):
        try:
            await _upsert(db, LineUser,
                          [LineUser.tenant_id == tenant.id, LineUser.line_user_id == row["line_user_id"]], {
                              "tenant_id": tenant.id,
                              "line_user_id": row["line_user_id"],
                              "display_name": row["display_name"] or "",
                              "followed_at": _dt(row["created_at"]),
                              "last_seen_at": _dt(row["last_seen_at"]),
                          }, report, "line_user")
        except Exception as e:  # noqa: BLE001
            report["line_user:failed"] += 1
            report["failed"] += 1
            print(f"  ! line_users {row['line_user_id']}: {e}")


async def migrate_cases(db: AsyncSession, src: sqlite3.Connection, tenant: Tenant,
                        schemes: dict[str, Scheme], report: Report) -> dict[str, Application]:
    """cases → applications，case_status_history → application_status_events（D13）。

    手機號在舊系統是明文；這裡只留 Fernet 密文與末四碼 hash，明文不落地（SPEC §11）。
    `case_no` 沿用舊的 8 位數 case_id，民眾手上的截圖才還查得到。
    """
    apps: dict[str, Application] = {}
    for row in src.execute("SELECT * FROM cases"):
        case_id = row["case_id"]
        try:
            scheme = schemes.get(row["subsidy_id"])
            if scheme is None:
                report["application:failed"] += 1
                report["failed"] += 1
                print(f"  ! cases {case_id}: 找不到方案 {row['subsidy_id']}")
                continue

            status = _status_for(row)
            submitted_at = _dt(row["submitted_at"]) or _dt(row["created_at"])
            existing = (await db.execute(select(Application).where(
                Application.tenant_id == tenant.id, Application.case_no == case_id))).scalar_one_or_none()
            app = await _upsert(db, Application,
                                [Application.tenant_id == tenant.id, Application.case_no == case_id], {
                                    "id": _row_id("case", case_id),
                                    "tenant_id": tenant.id,
                                    "case_no": case_id,
                                    "scheme_id": scheme.id,
                                    "intake_channel": "LEGACY",
                                    "applicant_name": row["applicant_name"] or "",
                                    "phone_encrypted": _phone_cipher(existing, row["phone"] or ""),
                                    "phone_last4_hash": hash_last4(row["phone"] or ""),
                                    "status": status,
                                    "first_submitted_at": submitted_at,
                                    "last_submitted_at": _dt(row["updated_at"]) or submitted_at,
                                    "supplement_items": _supplement_items(row["supplement_items"]),
                                    "supplement_deadline": _dt(row["supplement_deadline"]),
                                    "payment_date": _dt(row["payment_date"]),
                                    "payment_amount": row["payment_amount"],
                                    "approved_amount": row["payment_amount"],
                                    "note": row["note"] or "",
                                }, report, "application")
            apps[case_id] = app
        except Exception as e:  # noqa: BLE001
            report["application:failed"] += 1
            report["failed"] += 1
            print(f"  ! cases {case_id}: {e}")

    for row in src.execute("SELECT * FROM case_status_history ORDER BY id"):
        case_id = row["case_id"]
        app = apps.get(case_id)
        if app is None:
            report["status_event:failed"] += 1
            report["failed"] += 1
            continue
        event_id = _row_id("history", str(row["id"]))
        try:
            # 事件不可變，所以只有「存在 / 不存在」，沒有更新這條路。
            exists = (await db.execute(
                select(ApplicationStatusEvent.id).where(ApplicationStatusEvent.id == event_id)
            )).scalar_one_or_none()
            if exists:
                report["status_event:skipped"] += 1
                report["skipped"] += 1
                continue
            to_status = STATUS_MAP.get(row["to_status"], "SUBMITTED")
            db.add(ApplicationStatusEvent(
                id=event_id,
                tenant_id=tenant.id,
                application_id=app.id,
                from_status=STATUS_MAP.get(row["from_status"] or "") or None,
                to_status=to_status,
                transition_code=LEGACY_CODE,
                actor_type="SYSTEM",
                reason=LEGACY_REJECT_REASON if to_status == "REJECTED" else "",
                rejection_codes=[],
                payload={"source": row["source"] or "", "legacy_from": row["from_status"],
                         "legacy_to": row["to_status"]},
                created_at=_dt(row["changed_at"]) or datetime.now(UTC),
            ))
            await db.flush()
            report["status_event:inserted"] += 1
            report["inserted"] += 1
        except Exception as e:  # noqa: BLE001
            report["status_event:failed"] += 1
            report["failed"] += 1
            print(f"  ! case_status_history {row['id']}: {e}")
    return apps


async def migrate_user_cases(db: AsyncSession, src: sqlite3.Connection, tenant: Tenant,
                             apps: dict[str, Application], report: Report) -> None:
    """user_cases → case_verifications：保留綁定，切換後第一則推播才送得出去。"""
    for row in src.execute("SELECT * FROM user_cases"):
        app = apps.get(row["case_id"])
        if app is None:
            report["case_verification:failed"] += 1
            report["failed"] += 1
            continue
        try:
            await _upsert(db, CaseVerification, [
                CaseVerification.application_id == app.id,
                CaseVerification.line_user_id == row["line_user_id"],
            ], {
                "tenant_id": tenant.id,
                "application_id": app.id,
                "line_user_id": row["line_user_id"],
                "verified_at": _dt(row["verified_at"]) or datetime.now(UTC),
                "method": "line",
            }, report, "case_verification")
        except Exception as e:  # noqa: BLE001
            report["case_verification:failed"] += 1
            report["failed"] += 1
            print(f"  ! user_cases {row['id']}: {e}")


def count_skipped(src: sqlite3.Connection, report: Report) -> None:
    """明確記下「知道有這些資料，刻意不搬」，而不是讓它們悄悄消失。"""
    for table in SKIPPED_TABLES:
        try:
            n = src.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        except sqlite3.Error:
            continue
        report[f"{table}:not_migrated"] += n


# --------------------------------------------------------------------- main

def open_source(path: Path) -> sqlite3.Connection:
    """唯讀開啟：搬遷腳本沒有任何理由能寫到舊系統的資料庫。"""
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


async def run(path: Path, tenant_slug: str = "default") -> Report:
    report = Report()
    src = open_source(path)
    try:
        async with sessionmaker()() as db:
            tenant = (await db.execute(select(Tenant).where(Tenant.slug == tenant_slug))).scalar_one_or_none()
            if tenant is None:
                tenant = (await db.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
            if tenant is None:
                raise SystemExit("找不到任何 tenant，請先跑 scripts/seed.py 或啟動 API 完成 bootstrap")

            await migrate_contents(db, src, tenant, report)
            schemes = await migrate_subsidies(db, src, tenant, report)
            await migrate_faqs(db, src, tenant, report)
            await migrate_knowledge(db, src, tenant, report)
            await migrate_line_users(db, src, tenant, report)
            apps = await migrate_cases(db, src, tenant, schemes, report)
            await migrate_user_cases(db, src, tenant, apps, report)
            count_skipped(src, report)
            await db.commit()
    finally:
        src.close()
    return report


def print_report(report: Report, path: Path) -> None:
    print("=" * 56)
    print(f"migrate_legacy/youth 報表  ← {path}")
    print("=" * 56)
    for key in sorted(k for k in report if ":" in k):
        print(f"  {key:<34} {report[key]}")
    print("-" * 56)
    for key in ("inserted", "updated", "skipped", "failed"):
        print(f"  {key:<34} {report[key]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="youth-line-bot SQLite → MayDru")
    parser.add_argument("path", nargs="?", default=str(DEFAULT_DB), help="youth.db 路徑")
    parser.add_argument("--tenant", default="default", help="目標 tenant 的 slug")
    args = parser.parse_args()

    path = Path(args.path).resolve()
    if not path.exists():
        raise SystemExit(f"找不到來源資料庫：{path}")
    print_report(asyncio.run(run(path, args.tenant)), path)


if __name__ == "__main__":
    main()
