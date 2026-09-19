"""Anonymised event log (SPEC §5.3). Never stores citizen screenshots or
identifying data; session ids are opaque and external ids arrive hashed."""

from sqlalchemy.ext.asyncio import AsyncSession

from .models import EventLog


async def log_event(db: AsyncSession, tenant_id: str, session_id: str, event_type: str, *,
                    flow_id: str | None = None, step_id: str | None = None,
                    payload: dict | None = None, source: str = "api") -> None:
    db.add(EventLog(tenant_id=tenant_id, session_id=session_id, event_type=event_type,
                    flow_id=flow_id, step_id=step_id, payload=payload or {}, source=source))
    await db.commit()
