"""Variant response builders shared by the canvas and variant routers.

Privacy (SPEC §12): the structure analysis lists the original's sensitive
strings and the check report may quote them. The API never returns
`structure.sensitive_texts`; verbatim leaked strings are only shown to the
original's uploader and admins.
"""

from __future__ import annotations

from .. import storage
from ..deps import CurrentUser
from ..models import Variant
from ..schemas import VariantOut, VariantSummary

# columns variant_summary reads; the canvas loads only these
SUMMARY_COLUMNS = (
    Variant.id, Variant.step_id, Variant.theme, Variant.status, Variant.progress, Variant.error, Variant.attempts,
    Variant.drift_count, Variant.original_key, Variant.original_uploaded_at, Variant.replica_png_key,
    Variant.stepcard_key, Variant.stepcard_preview_key,
)
ERROR_PREVIEW_CHARS = 200


def original_version(v: Variant) -> str | None:
    """Changes whenever a new original is uploaded, so clients can bust caches."""
    if not v.original_key or not v.original_uploaded_at:
        return None
    return v.original_uploaded_at.isoformat()


def can_see_original_data(v: Variant, user: CurrentUser) -> bool:
    return user.at_least("admin") or (v.original_uploaded_by is not None and v.original_uploaded_by == user.id)


def public_structure(structure: dict | None) -> dict | None:
    if structure is None:
        return None
    return {k: val for k, val in structure.items() if k != "sensitive_texts"}


def redact_check_report(report: dict | None, reveal: bool) -> dict | None:
    """Without `reveal`, drop `leaked` and replace problems quoting a leaked string with a count."""
    if report is None or reveal:
        return report
    leaked = [t for t in report.get("leaked") or [] if t]
    out = {k: val for k, val in report.items() if k != "leaked"}
    if not leaked:
        return out
    problems, noted = [], False
    for p in report.get("problems") or []:
        if isinstance(p, str) and any(t in p for t in leaked):
            if not noted:
                problems.append(f"復刻中仍有 {len(leaked)} 筆原圖資料")
                noted = True
        else:
            problems.append(p)
    out["problems"] = problems
    return out


def _replica_url(v: Variant) -> str | None:
    return f"/api/variants/{v.id}/replica.png" if v.replica_png_key else None


def replica_version(v: Variant) -> str | None:
    """Changes whenever the replica is rendered again — every render writes a
    fresh key. Clients hang their image caches on it: a text-only correction
    (SPEC §6.5) redraws the picture without a new attempt, and the old one must
    not stay on screen."""
    key = v.replica_png_key
    return key.rsplit("/", 1)[-1].split(".")[0][:12] if key else None


def variant_summary(v: Variant) -> VariantSummary:
    return VariantSummary(
        id=v.id, theme=v.theme, status=v.status, progress=v.progress, error=(v.error or "")[:ERROR_PREVIEW_CHARS],
        has_original=bool(v.original_key), original_version=original_version(v), replica_png_url=_replica_url(v),
        replica_version=replica_version(v),
        stepcard_url=storage.public_url(v.stepcard_key), stepcard_preview_url=storage.public_url(v.stepcard_preview_key),
        stepcard_thumb_url=storage.public_url(storage.thumb_key_for(v.stepcard_key)),
        drift_count=v.drift_count, attempts=v.attempts,
    )


def variant_out(v: Variant, user: CurrentUser) -> VariantOut:
    summary = variant_summary(v)
    return VariantOut(
        **summary.model_dump(exclude={"error"}), error=v.error or "", step_id=v.step_id,
        original_width=v.original_width, original_height=v.original_height, focus_boxes=v.focus_boxes or [],
        prompt_notes=v.prompt_notes or "",
        structure=public_structure(v.structure), replica_width=v.replica_width, replica_height=v.replica_height,
        kept_texts=v.kept_texts or [], fake_data=v.fake_data or [], fake_data_reviewed=bool(v.fake_data_reviewed),
        check_report=redact_check_report(v.check_report, can_see_original_data(v, user)),
        review_history=v.review_history or [], annotations=v.annotations or [],
        stepcard_layout=v.stepcard_layout, description=v.description or "", updated_at=v.updated_at,
    )
