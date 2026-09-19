"""Tenant-scoped audit log viewer (SPEC §15 / P8)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ...db import get_db
from ...deps import CurrentUser, require_cap
from ...services import audit

router = APIRouter(prefix="/api/admin/audit-logs", tags=["admin-audit"])


@router.get("")
async def list_audit_logs(
    action: str = "", target_type: str = "", actor: str = "",
    offset: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200),
    user: CurrentUser = Depends(require_cap("admin")), db: AsyncSession = Depends(get_db),
):
    rows, total = await audit.list_logs(db, user.tenant_id, action=action, target_type=target_type,
                                        actor=actor, offset=offset, limit=limit)
    return {"items": [{"id": row.id, "actor_name": row.actor_name, "action": row.action,
                        "target_type": row.target_type, "target_id": row.target_id,
                        "diff": row.diff, "created_at": row.created_at} for row in rows],
            "total": total, "offset": offset, "limit": limit}
