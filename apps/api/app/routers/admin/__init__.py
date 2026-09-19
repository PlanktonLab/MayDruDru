"""`/api/admin/*`：後台端點（JWT + capability，SPEC §10.2）。

每個模組都是薄殼：驗證輸入、叫 service、序列化回應。任何 `if` 只要牽涉業務規則，
就該搬到 `app/services/`（CLAUDE.md 規則 2）。
"""

from __future__ import annotations

from . import applications, contents, faqs, line, media, reviewers, schemes

__all__ = ["applications", "contents", "faqs", "line", "media", "reviewers", "schemes"]
