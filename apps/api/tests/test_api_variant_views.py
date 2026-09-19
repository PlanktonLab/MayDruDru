from datetime import UTC, datetime
from types import SimpleNamespace

from app.deps import CurrentUser
from app.routers.variant_views import (
    can_see_original_data,
    original_version,
    public_structure,
    redact_check_report,
    variant_summary,
)

LEAK_PROBLEM = "復刻中出現原圖的資料字串，必須移除或換成假資料：王小明、0912345678"
REPORT = {"ok": False, "problems": [LEAK_PROBLEM, "渲染寬度不符"], "leaked": ["王小明", "0912345678"], "missing": []}


def _user(uid="u1", role="sop_editor"):
    return CurrentUser(id=uid, tenant_id="t1", role=role, email="a@b.tw", name="")


def _variant(**kw):
    base = dict(id="v1", step_id="s1", theme="light", status="completed", progress="", error="", attempts=1, drift_count=0,
                original_key=None, original_uploaded_at=None, original_uploaded_by="u1", replica_png_key=None,
                stepcard_key=None, stepcard_preview_key=None)
    return SimpleNamespace(**{**base, **kw})


def test_structure_never_exposes_sensitive_texts():
    s = public_structure({"sensitive_texts": ["王小明"], "structural_texts": ["登入"]})
    assert s == {"structural_texts": ["登入"]}
    assert public_structure(None) is None


def test_check_report_revealed_to_uploader_and_admin():
    v = _variant()
    assert can_see_original_data(v, _user("u1"))
    assert can_see_original_data(v, _user("u2", "admin"))
    assert not can_see_original_data(v, _user("u2", "sop_reviewer"))
    assert redact_check_report(REPORT, True) is REPORT


def test_check_report_redacted_for_others():
    out = redact_check_report(REPORT, False)
    assert "leaked" not in out
    assert out["problems"] == ["復刻中仍有 2 筆原圖資料", "渲染寬度不符"]
    assert "王小明" not in str(out)
    assert REPORT["leaked"] == ["王小明", "0912345678"]  # input untouched


def test_redaction_without_leaks_keeps_problems():
    out = redact_check_report({"ok": False, "problems": ["x"], "leaked": []}, False)
    assert out == {"ok": False, "problems": ["x"]}
    assert redact_check_report(None, False) is None


def test_summary_thumb_and_original_version():
    at = datetime(2026, 9, 1, tzinfo=UTC)
    s = variant_summary(_variant(stepcard_key="cards/t1/abc.png", original_key="originals/t1/v1.bin", original_uploaded_at=at))
    assert s.stepcard_thumb_url.endswith("/thumbs/t1/abc.jpg")
    assert s.stepcard_url.endswith("/cards/t1/abc.png")
    assert s.has_original and s.original_version == at.isoformat()


def test_summary_without_assets():
    s = variant_summary(_variant(error="x" * 500, original_uploaded_at=datetime.now(UTC)))
    assert s.stepcard_thumb_url is None and s.original_version is None and not s.has_original
    assert len(s.error) == 200
    assert original_version(_variant()) is None
