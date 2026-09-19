from types import SimpleNamespace

import pytest
from app.models import JOB_OWNED_STATUSES
from app.routers.flows import card_text_changed, layout_positions, renderable_variants
from app.routers.tenant import removes_last_owner
from app.routers.variants import ensure_not_job_owned
from app.schemas import LayoutIn, MemberIn, MemberPatch
from fastapi import HTTPException
from pydantic import ValidationError


@pytest.mark.parametrize("status", sorted(JOB_OWNED_STATUSES))
def test_job_owned_statuses_refused(status):
    with pytest.raises(HTTPException) as e:
        ensure_not_job_owned(SimpleNamespace(status=status))
    assert e.value.status_code == 409


@pytest.mark.parametrize("status", ["not_uploaded", "uploaded", "focusing", "pending_review", "annotating", "completed", "failed"])
def test_other_statuses_allowed(status):
    ensure_not_job_owned(SimpleNamespace(status=status))


def _member(role="owner", active=True):
    return SimpleNamespace(role=role, is_active=active)


def test_last_owner_cannot_be_demoted_deactivated_or_removed():
    owner = _member()
    assert removes_last_owner(owner, 1, new_role="admin")
    assert removes_last_owner(owner, 1, new_active=False)
    assert removes_last_owner(owner, 1, deleting=True)


def test_owner_changes_allowed_when_another_owner_remains():
    owner = _member()
    assert not removes_last_owner(owner, 2, new_role="admin")
    assert not removes_last_owner(owner, 2, deleting=True)
    assert not removes_last_owner(owner, 1, new_role="owner", new_active=True)
    assert not removes_last_owner(owner, 1)


def test_non_owner_or_inactive_owner_never_last():
    assert not removes_last_owner(_member("admin"), 1, deleting=True)
    assert not removes_last_owner(_member(active=False), 1, deleting=True)


def test_layout_accepts_legacy_kind_and_last_item_wins():
    body = LayoutIn.model_validate({"items": [{"kind": "step", "id": "a", "x": 1, "y": 2}, {"id": "a", "x": 5, "y": 6}, {"id": "b", "x": 0, "y": 0}]})
    assert layout_positions(body.items) == {"a": (5.0, 6.0), "b": (0.0, 0.0)}


def test_layout_rejects_non_finite():
    with pytest.raises(ValidationError):
        LayoutIn.model_validate({"items": [{"id": "a", "x": float("nan"), "y": 0}]})


def test_card_text_change_detection():
    step = SimpleNamespace(title="登入", instruction="按下登入")
    assert card_text_changed(step, {"title": "登入帳號"})
    assert not card_text_changed(step, {"title": "登入", "stuck_hint": "x"})


def test_member_validation():
    with pytest.raises(ValidationError):
        MemberIn(email="not-an-email", password="x" * 12)
    with pytest.raises(ValidationError):
        MemberIn(email="a@example.gov.tw", password="short")
    with pytest.raises(ValidationError):
        MemberIn(email="a@example.gov.tw", password="x" * 12, role="root")
    assert MemberPatch(password="").password is None


def test_tenant_scoping_joins_up_to_flow():
    from app.deps import _tenant_scoped
    from app.models import Goal, Tenant, Variant

    sql = str(_tenant_scoped(Variant, "t1"))
    assert "JOIN steps" in sql and "JOIN flows" in sql and "flows.tenant_id" in sql
    assert "goals.tenant_id" in str(_tenant_scoped(Goal, "t1"))
    with pytest.raises(TypeError):
        _tenant_scoped(Tenant, "t1")


def test_whole_flow_render_takes_reviewed_steps_with_a_replica_only():
    v = lambda status, replica="k": SimpleNamespace(status=status, replica_html_key=replica)  # noqa: E731
    variants = [v("completed"), v("annotating"), v("annotating", None), v("rendering"), v("pending_review"), v("not_uploaded", None)]
    assert renderable_variants(variants) == variants[:2]
