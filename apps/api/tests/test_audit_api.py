"""Audit log UI API is tenant scoped and admin-only (SPEC §15 / P8)."""

from app.models import AuditLog, Tenant


async def test_audit_log_list_filters_and_never_crosses_tenants(client, db, tenant, users, auth_headers):
    other = Tenant(name="別的機關", slug="other")
    db.add(other)
    await db.flush()
    db.add_all([
        AuditLog(tenant_id=tenant.id, actor_id=users["admin"].id, actor_name="管理員甲",
                 action="update", target_type="scheme", target_id="A", diff={"name": {"to": "新"}}),
        AuditLog(tenant_id=tenant.id, actor_name="管理員乙", action="publish",
                 target_type="content", target_id="hello", diff={}),
        AuditLog(tenant_id=other.id, actor_name="別人", action="update",
                 target_type="scheme", target_id="SECRET", diff={}),
    ])
    await db.commit()

    denied = await client.get("/api/admin/audit-logs", headers=auth_headers("viewer"))
    assert denied.status_code == 403
    response = await client.get("/api/admin/audit-logs?action=update&target_type=scheme&actor=甲",
                                headers=auth_headers("admin"))
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["target_id"] == "A"
    assert "SECRET" not in response.text
