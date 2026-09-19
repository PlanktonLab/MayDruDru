"""OpenAPI 快照：CI 的「client 同步檢查」（SPEC §14）。

`packages/api-client` 由 OpenAPI 產生，所以 schema 一動、前端型別就得跟著動。
把 schema 提交進 git，PR 裡就看得見契約變了什麼——而不是等到前端跑起來才發現。

重新產生：

    UPDATE_OPENAPI=1 uv run --package maydru-api pytest tests/test_openapi_snapshot.py

產出的 `apps/api/openapi.json` 要一起 commit。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from app.main import create_app

SNAPSHOT = Path(__file__).resolve().parents[1] / "openapi.json"


def current() -> dict:
    """由 `create_app()` 產生，不需要資料庫也不需要 lifespan。"""
    return create_app().openapi()


def dumped(spec: dict) -> str:
    return json.dumps(spec, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


@pytest.fixture(scope="module")
def spec() -> dict:
    return current()


def test_the_snapshot_is_up_to_date(spec):
    text = dumped(spec)
    if os.environ.get("UPDATE_OPENAPI"):
        SNAPSHOT.write_text(text, encoding="utf-8")
        return
    assert SNAPSHOT.exists(), "缺少 openapi.json，請跑 UPDATE_OPENAPI=1 pytest tests/test_openapi_snapshot.py"
    assert SNAPSHOT.read_text(encoding="utf-8") == text, (
        "OpenAPI 與 openapi.json 不一致。確認端點改動是有意的，再跑 "
        "`UPDATE_OPENAPI=1 uv run --package maydru-api pytest tests/test_openapi_snapshot.py` 更新並 commit。"
    )


@pytest.mark.parametrize("path", [
    "/api/apply/schemes",
    "/api/apply/schemes/{code}",
    "/api/apply/schemes/{code}/required-documents",
    "/api/apply/applications",
    "/api/apply/verify",
    "/api/apply/applications/{case_no}",
    "/api/apply/applications/{case_no}/documents",
    "/api/apply/applications/{case_no}/withdraw",
    "/api/apply/faqs",
    "/api/admin/applications",
    "/api/admin/applications/{case_no}",
    "/api/admin/applications/{case_no}/documents/{doc_id}/url",
    "/api/admin/applications/{case_no}/documents/{doc_id}/ocr",
    "/api/admin/applications/{case_no}/evaluate",
    "/api/admin/applications/{case_no}/findings/{rule_code}",
    "/api/admin/applications/{case_no}/transitions",
    "/api/admin/applications/{case_no}/assign",
])
def test_every_p3_endpoint_is_in_the_schema(spec, path):
    assert path in spec["paths"]


def test_the_submit_endpoint_is_multipart(spec):
    body = spec["paths"]["/api/apply/applications"]["post"]["requestBody"]
    assert "multipart/form-data" in body["content"]


def test_the_case_detail_response_carries_the_contract_fields(spec):
    schema = spec["components"]["schemas"]["ApplicationDetailOut"]["properties"]
    for field in ("findings", "rules", "allowed_transitions", "approval_blockers", "documents",
                  "events", "verdict", "version"):
        assert field in schema, field
