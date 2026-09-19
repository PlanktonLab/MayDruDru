"""罐頭訊息 registry：`contents` 的 seed 與執行期 fallback（SPEC §8.6）。"""

from .definitions import (
    BY_KEY,
    CONTENT_CATEGORIES,
    CONTENT_REGISTRY,
    CONTENT_TYPES,
    ContentCategory,
    ContentDefinition,
    get_default,
    get_definition,
    has_key,
    keys_in_category,
)

__all__ = [
    "BY_KEY",
    "CONTENT_CATEGORIES",
    "CONTENT_REGISTRY",
    "CONTENT_TYPES",
    "ContentCategory",
    "ContentDefinition",
    "get_default",
    "get_definition",
    "has_key",
    "keys_in_category",
]
