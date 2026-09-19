"""內容助理的模型層（SPEC §8.6 / §9.6）。

這個模組只做三件事：把呼叫端整理好的上下文拼成提示詞、經 `llm.structured_call()`
拿到結構化草稿、把未命中訊息聚成群。它**不碰資料庫**——讀設定、寫草稿、寫稽核
都在 `services/copilot.py`（CLAUDE.md 規則 2，決策 D31）。

送外部供應商的資料嚴格限於 SPEC §11「外送資料清單」允許的三類：罐頭草稿上下文、
方案設定、去識別化後的未命中訊息文字。申請案件、證明文件、申請人個資一律不進來，
呼叫端在 `services/copilot.py` 就已經過濾掉，這裡再不經手任何 ORM 物件當第二道牆。

助理只寫 draft，發布永遠是人按的（決策 D8）。
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from . import llm
from .prompts import COPILOT_CONTENT_SYSTEM, COPILOT_FAQ_SYSTEM, COPILOT_SCHEME_SYSTEM
from .schemas import ContentDraft, FaqSuggestion, SchemeCopySet

__all__ = [
    "CLUSTER_CEILING",
    "CLUSTER_FLOOR",
    "CLUSTER_SIGMA",
    "adaptive_threshold",
    "cluster_texts",
    "cosine",
    "draft_content",
    "embed_all",
    "suggest_faq",
    "write_scheme_copy",
]

# 門檻是**算出來的**，不是寫死的：不同 embedding 模型的相似度刻度差很多——
# OpenAI 的向量連兩句不相干的中文都落在 0.75 上下，fake provider 的字元 bigram
# 則是 0.15 上下。寫死一個數字必然在其中一邊全錯：不是每句自成一群，就是整批黏成
# 一群。所以先看這一批資料自己的相似度分布，取「平均 + 1.5 個標準差」當門檻——
# 也就是「明顯比這批的平均更像」才算在問同一件事，再用上下限夾住極端的批次。
CLUSTER_FLOOR = 0.30
CLUSTER_CEILING = 0.92
CLUSTER_SIGMA = 1.5
# 校準只取前幾筆：兩兩比是 O(n²)，300 句會跑出 45000 次 1536 維的內積，而門檻
# 本來就只需要一個概略的分布。
CALIBRATION_SAMPLE = 30
MAX_SAMPLES_PER_CLUSTER = 8


# ------------------------------------------------------------------ 聚類

def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """兩個向量的餘弦相似度。長度不同或其中一個是零向量時回 0。"""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if not na or not nb:
        return 0.0
    return dot / (na * nb)


async def embed_all(texts: Sequence[str]) -> list[list[float]]:
    """逐句算 embedding。`LLM_PROVIDER=fake` 時走 bigram hashing，不連網路。"""
    return [await llm.embed(text) for text in texts]


def adaptive_threshold(vectors: Sequence[Sequence[float]]) -> float:
    """這一批向量自己的「算很像」是多少（見上面 CLUSTER_* 的說明）。

    樣本太少（不到三對）時沒有分布可言，直接回下限——寧可多分幾群讓承辦人員自己
    合併，也不要把兩件不同的事寫成同一則 FAQ。
    """
    sample = list(vectors[:CALIBRATION_SAMPLE])
    scores = [cosine(sample[i], sample[j]) for i in range(len(sample)) for j in range(i + 1, len(sample))]
    if len(scores) < 3:
        return CLUSTER_FLOOR
    mean = sum(scores) / len(scores)
    variance = sum((s - mean) ** 2 for s in scores) / len(scores)
    cut = mean + CLUSTER_SIGMA * math.sqrt(variance)
    return min(CLUSTER_CEILING, max(CLUSTER_FLOOR, cut))


def cluster_texts(vectors: Sequence[Sequence[float]], threshold: float | None = None) -> list[list[int]]:
    """把句子聚成群，回傳每一群的索引清單（群內維持原順序，群依大小遞減）。

    作法是最簡單的凝聚式聚類：每句話跟既有群的**群心**比一次，夠像就加進去，都不像
    就自己開一群。沒有用 sklearn，因為這裡要的不是分群品質而是「哪幾句在問同一件
    事」，而且多一個科學計算相依只為了一個 O(n·k) 的迴圈並不划算。

    `threshold` 省略時由 `adaptive_threshold()` 依這批資料自己算。
    """
    cut = adaptive_threshold(vectors) if threshold is None else threshold
    clusters: list[list[int]] = []
    centroids: list[list[float]] = []
    for index, vector in enumerate(vectors):
        best, best_score = -1, cut
        for slot, centroid in enumerate(centroids):
            score = cosine(vector, centroid)
            if score >= best_score:
                best, best_score = slot, score
        if best < 0:
            clusters.append([index])
            centroids.append([float(v) for v in vector])
            continue
        members = clusters[best]
        members.append(index)
        centroid = centroids[best]
        size = len(members)
        centroids[best] = [(c * (size - 1) + float(v)) / size for c, v in zip(centroid, vector)]
    return sorted(clusters, key=lambda group: (-len(group), group[0]))


# ------------------------------------------------------------------ 提示詞

def _sources_block(sources: Sequence[dict[str, Any]]) -> str:
    """可以引用的來源清單。編號就是 `citation_index` 要填的數字。"""
    if not sources:
        return "【可引用的資料】（沒有，這次只能寫你確定的話，其餘留給承辦人員）\n"
    lines = [
        f"[{i}] {s.get('source_type', '')} / {s.get('source_id', '')}：{s.get('quote', '')}"
        for i, s in enumerate(sources)
    ]
    return "【可引用的資料】citation_index 填下面的編號：\n" + "\n".join(lines) + "\n"


def _lines(pairs: Sequence[tuple[str, Any]]) -> str:
    return "".join(f"- {label}：{value}\n" for label, value in pairs if str(value).strip())


# ------------------------------------------------------- (a) 罐頭訊息草稿

async def draft_content(
    *,
    key: str,
    title: str = "",
    description: str = "",
    category: str = "",
    variables: Sequence[str] = (),
    current: str = "",
    default: str = "",
    instruction: str = "",
    tone: str = "",
    sources: Sequence[dict[str, Any]] = (),
    tenant_id: str | None = None,
) -> tuple[ContentDraft, dict[str, Any]]:
    """依 key 的用途、語氣與變數清單產生／改寫一段草稿（SPEC §8.6 a）。"""
    text = (
        "【要寫的文案】\n"
        + _lines([
            ("key", key), ("標題", title), ("用途", description), ("分類", category),
            ("可用變數", "、".join(variables) or "（無）"),
            ("目前的文字", current or "（還是出廠預設）"),
            ("出廠預設", default),
            ("承辦人員的指示", instruction), ("語氣", tone),
        ])
        + "\n" + _sources_block(sources)
    )
    return await llm.structured_call(
        "copilot_content", ContentDraft, COPILOT_CONTENT_SYSTEM, text,
        tenant_id=tenant_id, ref_type="content", ref_id=key,
        fake_context={"key": key, "title": title, "tone": tone, "instruction": instruction,
                      "variables": list(variables), "sources": list(sources)},
    )


# --------------------------------------------------------- (b) FAQ 建議

async def suggest_faq(
    *,
    samples: Sequence[str],
    sources: Sequence[dict[str, Any]] = (),
    categories: Sequence[str] = (),
    cluster_size: int = 0,
    tenant_id: str | None = None,
) -> tuple[FaqSuggestion, dict[str, Any]]:
    """把一群問不出答案的句子收斂成一則 FAQ 建議（SPEC §8.6 b）。

    `samples` 必須已經去識別化——呼叫端負責，這裡不做第二次清洗，因為一旦在這裡
    補救，就等於承認上游可能漏掉。
    """
    quoted = "\n".join(f"- {s}" for s in samples[:MAX_SAMPLES_PER_CLUSTER])
    text = (
        f"【民眾問過的句子】（這一群共 {cluster_size or len(samples)} 句，已去識別化）\n{quoted}\n\n"
        + (f"【既有分類】{'、'.join(categories)}\n\n" if categories else "")
        + _sources_block(sources)
    )
    return await llm.structured_call(
        "copilot_faq", FaqSuggestion, COPILOT_FAQ_SYSTEM, text,
        tenant_id=tenant_id, ref_type="faq_suggestion", ref_id="",
        fake_context={"samples": list(samples), "sources": list(sources),
                      "category": categories[0] if categories else ""},
    )


# ------------------------------------------------------- (c) 方案文案集

async def write_scheme_copy(
    *,
    scheme: dict[str, Any],
    items: Sequence[dict[str, Any]],
    tenant_id: str | None = None,
) -> tuple[SchemeCopySet, dict[str, Any]]:
    """依方案設定一次產出整套對外文案的草稿（SPEC §8.6 c）。

    `items` 的每一筆是 `{key, purpose, sources}`：要寫哪一則、它出現在哪裡、
    可以引用哪些方案欄位。key 由呼叫端決定，模型不得自創。
    """
    blocks = []
    for row in items:
        blocks.append(
            f"◆ {row.get('key', '')}\n"
            f"  出現在：{row.get('purpose', '')}\n"
            + "".join(f"  可引用 [{i}] {s.get('source_type', '')} / {s.get('source_id', '')}：{s.get('quote', '')}\n"
                      for i, s in enumerate(row.get("sources") or []))
        )
    text = (
        "【方案設定】\n"
        + _lines([
            ("代碼", scheme.get("code", "")), ("名稱", scheme.get("name", "")),
            ("類別", scheme.get("category", "")), ("說明", scheme.get("description", "")),
            ("申請資格", scheme.get("eligibility", "")), ("補助金額", scheme.get("amount_note", "")),
            ("補件期限（天）", scheme.get("supplement_days", "")),
            ("最多補正次數", scheme.get("max_revisions", "")),
        ])
        + "\n【要寫的文案清單】每一則的 citation_index 只能指向它自己那一組編號：\n"
        + "\n".join(blocks)
    )
    return await llm.structured_call(
        "copilot_scheme", SchemeCopySet, COPILOT_SCHEME_SYSTEM, text,
        tenant_id=tenant_id, ref_type="scheme", ref_id=str(scheme.get("code", "")),
        fake_context={"items": [dict(row) for row in items]},
    )
