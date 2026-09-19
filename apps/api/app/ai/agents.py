"""The model tasks: Agent A (structure), Agent B (replica), Agent C (style
doc), screenshot description, visual rerank and intent parsing."""

from __future__ import annotations

import asyncio

from .image_utils import shrink_for_model
from .llm import dumps, structured_call
from .prompts import (
    DESCRIBE_SYSTEM,
    INTENT_SYSTEM,
    REPLICA_SYSTEM,
    RERANK_SYSTEM,
    STRUCTURE_SYSTEM,
    STYLEDOC_SYSTEM,
    VISUAL_REVIEW_SYSTEM,
    components_section,
    demo_data_section,
    notes_section,
)
from .schemas import (
    IntentResult,
    ReplicaOutput,
    RerankResult,
    ScreenshotDescription,
    StructureAnalysis,
    StyleDocAI,
    VisualReview,
)


async def shrink(data: bytes, max_edge: int | None = None) -> bytes:
    """`shrink_for_model` off the event loop (PIL decode/resize/encode is CPU bound)."""
    return await asyncio.to_thread(shrink_for_model, data, max_edge)


def description_text(d: dict, platform_name: str = "", theme: str = "") -> str:
    """Canonical text that gets embedded for retrieval (ingestion and lookup
    use the same shape so the vectors are comparable)."""
    parts = [
        platform_name, theme,
        d.get("screen_title", ""), d.get("navigation", ""), d.get("layout_summary", ""),
        " ".join(d.get("visible_keywords", []) or []), d.get("style_notes", ""),
    ]
    return " | ".join(p for p in parts if p)


def screen_keywords(d: dict, secrets: list[str] | None = None) -> list[str]:
    """The screen's own words for the lexical half of retrieval: structural
    texts (verbatim UI strings) and keywords, minus anything listed as
    personal data. Same function at ingestion and at lookup."""
    banned = {t.strip() for t in (secrets or []) if isinstance(t, str) and t.strip()}
    out: list[str] = []
    for t in [*(d.get("structural_texts") or []), *(d.get("visible_keywords") or [])]:
        if not isinstance(t, str):
            continue
        t = t.strip()
        if t and t not in out and t not in banned and not any(b in t for b in banned if len(b) >= 2):
            out.append(t)
    return out


def styledoc_text(ai: dict, human_notes: str, platform_name: str) -> str:
    fields = [platform_name, ai.get("summary", ""), " ".join(ai.get("primary_colors", [])), ai.get("corner_style", ""),
              ai.get("typography_feel", ""), ai.get("navigation_pattern", ""), " ".join(ai.get("signature_components", [])),
              " ".join(ai.get("common_keywords", [])), human_notes]
    return " | ".join(f for f in fields if f)


async def analyze_structure(original: bytes, focus_boxes: list[dict], style_doc: dict | None, *,
                            tenant_id: str, variant_id: str, theme: str, notes: str = "") -> tuple[StructureAnalysis, dict]:
    text = (
        f"主題：{theme}\nFocus Boxes（相對座標）：{dumps(focus_boxes)}\n"
        f"既有風格文件：{dumps(style_doc or {})}\n{notes_section(notes)}請分析下方截圖。"
    )
    return await structured_call("structure", StructureAnalysis, STRUCTURE_SYSTEM, text, [await shrink(original)],
                                 tenant_id=tenant_id, ref_type="variant", ref_id=variant_id,
                                 fake_context={"focus_boxes": focus_boxes, "theme": theme})


async def generate_replica(original: bytes, focus_boxes: list[dict], structure: dict, feedback: str, *,
                           width: int, tenant_id: str, variant_id: str, theme: str,
                           previous_html: str = "", previous_png: bytes | None = None,
                           demo_data: list[dict] | None = None,
                           components: list[dict] | None = None,
                           notes: str = "") -> tuple[ReplicaOutput, dict]:
    """First pass builds from scratch; a regeneration gets the previous HTML and
    its render so the model patches the reported defects instead of starting
    over (which tends to reproduce the same mistakes). `demo_data` and
    `components` are the platform context (SPEC §6.5) that keeps a batch of
    screenshots reading as one coherent system; both are also sent on a
    regeneration, since the patch pass must not drop them. `notes` is the
    clerk's free-text steering for this screen (承辦人員補充說明)."""
    text = (
        f"基準寬度：{width}px\n主題：{theme}\nFocus Boxes：{dumps(focus_boxes)}\n"
        f"結構分析：{dumps(structure)}\n"
        f"{demo_data_section(demo_data)}{components_section(components, width)}{notes_section(notes)}"
    )
    images = [await shrink(original)]
    if feedback and previous_html:
        text += (
            f"\n【修正模式】下方是上一版 HTML，第二張圖是它的渲染結果。請以上一版為基礎，只修正下列問題，其餘版面與內容保持不變，"
            f"並輸出修正後的完整 HTML：\n{feedback}\n\n上一版 HTML：\n{previous_html}\n"
        )
        if previous_png:
            images.append(await shrink(previous_png, 1200))
    elif feedback:
        text += f"上一輪回饋（必須修正）：{feedback}\n"
    text += "請輸出復刻 HTML 與兩份清單。"
    return await structured_call("replica", ReplicaOutput, REPLICA_SYSTEM, text, images,
                                 tenant_id=tenant_id, ref_type="variant", ref_id=variant_id,
                                 fake_context={"focus_boxes": focus_boxes, "structure": structure, "width": width, "theme": theme,
                                               "demo_data": demo_data or [], "components": components or []})


async def update_style_doc(old_ai: dict, replica_png: bytes, structure: dict, keywords: list[str], *,
                           platform_name: str, tenant_id: str, platform_id: str) -> tuple[StyleDocAI, dict]:
    text = (
        f"平台：{platform_name}\n舊的 ai_generated：{dumps(old_ai)}\n新結構描述：{dumps(structure)}\n"
        f"已通過變體的關鍵字彙總：{dumps(keywords)}\n請重寫 ai_generated 段。"
    )
    return await structured_call("styledoc", StyleDocAI, STYLEDOC_SYSTEM, text, [await shrink(replica_png)],
                                 tenant_id=tenant_id, ref_type="platform", ref_id=platform_id,
                                 fake_context={"keywords": keywords, "platform_name": platform_name})


async def describe_screenshot(png: bytes, *, tenant_id: str, ref_id: str = "", shrunk: bool = False) -> tuple[ScreenshotDescription, dict]:
    """shrunk=True: `png` already went through `shrink` (retrieval does it once per turn)."""
    image = png if shrunk else await shrink(png)
    out, usage = await structured_call("describe", ScreenshotDescription, DESCRIBE_SYSTEM, "請判斷並描述下方圖片。", [image],
                                       tenant_id=tenant_id, ref_type="session", ref_id=ref_id, fake_context={})
    if not out.app_guess and out.platform_guess:
        out.app_guess = out.platform_guess
    return out, usage


async def rerank(citizen_png: bytes, candidates: list[dict], *, tenant_id: str, ref_id: str = "",
                 citizen_shrunk: bool = False, progress: str = "") -> tuple[RerankResult, dict]:
    """candidates: [{"png": bytes, "label": str, "description": str}]; `progress`
    is a line about where the citizen is in the flow (a prior for the model)."""
    lines = "\n".join(f"候選 {i}：{c.get('label', '')}" for i, c in enumerate(candidates))
    text = f"第一張是民眾截圖，之後依序是候選 0..{len(candidates) - 1}。\n{lines}\n"
    if progress:
        text += f"民眾目前進度：{progress}\n"
    text += "請比對。"
    replicas = await asyncio.gather(*(shrink(c["png"], 900) for c in candidates))
    images = [citizen_png if citizen_shrunk else await shrink(citizen_png), *replicas]
    return await structured_call("rerank", RerankResult, RERANK_SYSTEM, text, images,
                                 tenant_id=tenant_id, ref_type="session", ref_id=ref_id,
                                 fake_context={"candidates": candidates})


async def parse_intent(text: str, platforms: list[dict], goals: list[dict], known_context: dict | None, *,
                       tenant_id: str, ref_id: str = "") -> tuple[IntentResult, dict]:
    prompt = (
        f"平台清單：{dumps(platforms)}\n目標文件清單：{dumps(goals)}\n"
        f"known_context：{dumps(known_context or {})}\n民眾文字：{text}"
    )
    return await structured_call("intent", IntentResult, INTENT_SYSTEM, prompt, None,
                                 tenant_id=tenant_id, ref_type="session", ref_id=ref_id,
                                 fake_context={"platforms": platforms, "goals": goals, "known_context": known_context, "text": text})


async def visual_review(original: bytes, replica_png: bytes, *, tenant_id: str, variant_id: str) -> tuple[VisualReview, dict]:
    text = "第一張為原始截圖，第二張為復刻渲染圖。請比較版面並給出分數、問題清單與是否洩漏個資。"
    return await structured_call("visual_review", VisualReview, VISUAL_REVIEW_SYSTEM, text,
                                 list(await asyncio.gather(shrink(original, 1200), shrink(replica_png, 1200))),
                                 tenant_id=tenant_id, ref_type="variant", ref_id=variant_id, fake_context={})
