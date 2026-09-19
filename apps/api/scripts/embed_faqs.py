"""把 FAQ 重新 embed 進 `faqs.embedding`（SPEC §9.7）。

    uv run --package maydru-api python scripts/embed_faqs.py [--tenant ID] [--missing]

沒有向量的 FAQ 不會壞掉，只是 `services/faq.py::search()` 會落回關鍵字比對；
跑完這支之後語意檢索才真的生效（「我的錢什麼時候下來」才找得到標題是「撥款時程」
的那一則）。冪等，跑幾次結果都一樣。

`--missing` 只補還沒有向量的列，平常加完幾則 FAQ 之後跑這個就夠了。
`LLM_PROVIDER=fake` 時用的是離線的雜湊向量，維度一樣，所以在沒有金鑰的機器上也跑得完。

向量只存在 Postgres 的 `vector` 欄位上；SQLite（測試）存得下但查不動，
`search()` 會自己走關鍵字那一條路。
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.ai.llm import embed
from app.db import sessionmaker
from app.services import faq as faq_service


async def main() -> int:
    parser = argparse.ArgumentParser(description="重新計算 FAQ 的語意向量")
    parser.add_argument("--tenant", default="", help="只處理這個 tenant；省略代表全部")
    parser.add_argument("--missing", action="store_true", help="只補還沒有向量的列")
    args = parser.parse_args()

    async with sessionmaker()() as db:
        written = await faq_service.reembed_all(
            db, embed, tenant_id=args.tenant or None, only_missing=args.missing
        )
        await db.commit()
    print(f"embedded: {written}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
