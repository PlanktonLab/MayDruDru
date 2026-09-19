"""執行 SPEC §14 的 MayDru 完整離線 E2E 劇本，成功時印出 ``ALL OK``。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    api_root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/test_maydru_e2e.py", "-q", "-p", "no:warnings"],
        cwd=api_root,
        check=False,
    )
    if result.returncode == 0:
        print("ALL OK")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
