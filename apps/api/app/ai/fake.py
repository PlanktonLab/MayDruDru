"""Deterministic stand-ins for every model task, used when LLM_PROVIDER=fake.
They are intentionally simple; the point is to exercise the full pipeline
(graphs, interrupt/resume, renderer, checks, retrieval, session engine)
without network access."""

from __future__ import annotations

import hashlib
import html as html_mod
import math

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import BaseModel

from .schemas import (
    IntentResult,
    ReplicaOutput,
    RerankResult,
    ScreenshotDescription,
    StructureAnalysis,
    StyleDocAI,
    VisualReview,
)


def embed(text: str, dim: int) -> list[float]:
    """Bag-of-character-bigram hashing embedding. Similar texts → similar
    vectors, which is enough for the retrieval path to behave sensibly."""
    v = [0.0] * dim
    t = text.lower()
    grams = [t[i:i + 2] for i in range(len(t) - 1)] or [t]
    for g in grams:
        h = int(hashlib.md5(g.encode()).hexdigest(), 16)
        v[h % dim] += 1.0
        v[(h // dim) % dim] += 0.5
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _img_hash(data: bytes) -> str:
    """Hash of coarse pixel content, not PNG bytes — encoder output differs
    across platforms, pixels don't."""
    try:
        import io

        from PIL import Image
        im = Image.open(io.BytesIO(data)).convert("L").resize((32, 32), Image.BILINEAR)
        return hashlib.sha256(im.tobytes()).hexdigest()[:8]
    except Exception:
        return hashlib.sha256(data).hexdigest()[:8]


def respond(task: str, schema: type[BaseModel], text: str, images: list[bytes], ctx: dict) -> BaseModel:
    img_hash = _img_hash(images[0]) if images else "noimg"
    if schema is StructureAnalysis:
        boxes = ctx.get("focus_boxes", [])
        return StructureAnalysis(
            screen_title=ctx.get("title") or "示範畫面",
            navigation="頂部標題列含返回鍵；底部 Tab bar 四項",
            layout_summary="上方標題列，中間卡片區，下方清單",
            sections=["標題列", "帳戶卡片", "交易清單"],
            elements=[],
            data_regions=[{"name": "交易清單", "data_type": "金額/日期/店名", "position": "中下"}],
            focus_mappings=[{"focus_box_id": b["id"], "element_description": f"框 {b['id']}", "texts": []} for b in boxes],
            structural_texts=["帳戶總覽", "交易明細", "更多", "設定"],
            sensitive_texts=["王小明", "NT$1,234", "2026/09/01", "全家便利商店"],
            visible_keywords=["帳戶總覽", "交易明細", "信用卡", "示範", img_hash],
            theme_guess=ctx.get("theme", "light"),
            style_notes="主色綠色，白底，圓角卡片",
            has_tab_bar=True,
            has_nav_bar=True,
        )
    if schema is ReplicaOutput:
        width = ctx.get("width", 390)
        structure = ctx.get("structure") or {}
        title = html_mod.escape(structure.get("screen_title") or "示範畫面")
        kept = list(structure.get("structural_texts") or ["帳戶總覽", "交易明細"])
        boxes = ctx.get("focus_boxes", [])
        for b in boxes:
            for m in structure.get("focus_mappings", []):
                if m.get("focus_box_id") == b["id"]:
                    kept.extend(m.get("texts", []))
        # platform context (SPEC §6.5): a well-behaved Agent B puts the persona on
        # the page and pastes every shared component verbatim — so does this one.
        demo = [f for f in (ctx.get("demo_data") or []) if str((f or {}).get("value") or "").strip()]
        demo_rows = "".join(
            f'<div class="row"><div class="t">{html_mod.escape(str(f.get("label") or f.get("key") or ""))}</div>'
            f'<div class="amt">{html_mod.escape(str(f["value"]))}</div></div>' for f in demo)
        snippets = [c["html"] for c in (ctx.get("components") or []) if (c or {}).get("html")]
        fake_rows = ["示範商店 A", "示範商店 B", "示範商店 C"]
        rows = "".join(
            f'<div class="row"><div><div class="t">{html_mod.escape(r)}</div><div class="s">2019/01/0{i+1}</div></div><div class="amt">NT$ {100*(i+1)}</div></div>'
            for i, r in enumerate(fake_rows))
        ph = "".join('<div class="row"><div><span class="ph b" style="width:%dpx"></span><span class="ph" style="width:%dpx"></span></div><span class="ph" style="width:44px"></span></div>' % (60 + 15 * i, 90 + 10 * i) for i in range(4))
        dark = ctx.get("theme") == "dark"
        bg, ink, ink2, ph1, ph2 = ("#111418", "#e8ebef", "#9aa3ad", "#3a4149", "#2a3036") if dark else ("#ffffff", "#2b3642", "#5f6873", "#d6d9de", "#e7e9ec")
        html = f"""<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8"><style>
:root{{--ink:{ink};--ink2:{ink2};--ph1:{ph1};--ph2:{ph2};--line:#eceef1;--accent:#2ea35d}}
html,body{{margin:0;background:{bg};font-family:"Noto Sans TC","PingFang TC","Noto Sans CJK TC",sans-serif;color:var(--ink)}}
.screen{{width:{width}px;min-height:640px;box-sizing:border-box;padding:16px}}
.nav{{display:flex;align-items:center;gap:12px;height:44px;font-size:17px;font-weight:600}}
.back{{width:10px;height:10px;border-left:2px solid var(--ink);border-bottom:2px solid var(--ink);transform:rotate(45deg)}}
.card{{border:1px solid var(--line);border-radius:16px;padding:16px;margin:12px 0}}
.sec{{font-size:15px;font-weight:600;margin:16px 0 8px;color:var(--ink2)}}
.row{{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--line)}}
.t{{font-size:15px;font-weight:600}}.s{{font-size:12px;color:var(--ink2);margin-top:4px}}.amt{{font-weight:600}}
.ph{{display:block;height:11px;border-radius:6px;background:var(--ph2);margin:4px 0}}.ph.b{{height:14px;background:var(--ph1)}}
.tabs{{display:flex;justify-content:space-around;padding:10px 0;border-top:1px solid var(--line);margin-top:24px;font-size:12px;color:var(--ink2)}}
.tabs .on{{color:var(--accent)}}
</style></head><body><div class="screen">
<div class="nav"><span class="back"></span><span>{title}</span></div>
<div class="card"><span class="ph b" style="width:120px"></span><span class="ph" style="width:200px"></span></div>
<div class="sec">{html_mod.escape(kept[1] if len(kept) > 1 else '交易明細')}</div>
{demo_rows}{rows}{ph}
{''.join(snippets) if snippets else '<div class="tabs">' + ''.join(f'<span class="{"on" if i == 0 else ""}">{html_mod.escape(k)}</span>' for i, k in enumerate(kept[:4])) + '</div>'}
</div></body></html>"""
        kept.extend(str(f["value"]) for f in demo)  # demo data is copied as the clerk typed it
        # 假資料清單 (SPEC §6.5): the shared fields it reused carry their key, the
        # ones it made up for this screen carry none — the shape the reviewer sorts.
        reused = [{"key": str(f.get("key") or ""), "label": str(f.get("label") or ""), "value": str(f["value"])}
                  for f in demo]
        invented = [{"key": "", "label": "店名", "value": r} for r in fake_rows]
        invented += [{"key": "", "label": "交易日期", "value": "2019/01/01"}, {"key": "", "label": "金額", "value": "NT$ 100"}]
        return ReplicaOutput(html=html, kept_texts=sorted(set(kept)), fake_data=reused + invented, notes="fake provider")
    if schema is StyleDocAI:
        return StyleDocAI(primary_colors=["#2ea35d"], secondary_colors=["#ffffff", "#5f6873"], gradients="無",
                          corner_style="16px 圓角卡片", typography_feel="無襯線、中等字重", navigation_pattern="頂部返回鍵 + 底部 Tab bar",
                          signature_components=["綠色主按鈕", "帳戶卡片"], common_keywords=ctx.get("keywords", ["帳戶總覽", "交易明細"]),
                          summary=f"{ctx.get('platform_name', '平台')}：綠色主色、白底、圓角卡片、底部四個 Tab。")
    if schema is ScreenshotDescription:
        # Same image → same words as ingestion (the fake structure carries the
        # image hash as a keyword), so eval cases built from ingested images
        # locate correctly. A caller may steer the kind through the context.
        kind = ctx.get("kind", "app_screen")
        return ScreenshotDescription(kind=kind, photographed=bool(ctx.get("photographed")), app_guess=ctx.get("app_guess", ""),
                                     screen_title="示範畫面", navigation="頂部標題列含返回鍵；底部 Tab bar 四項",
                                     layout_summary="上方標題列，中間卡片區，下方清單",
                                     structural_texts=["帳戶總覽", "交易明細", "更多", "設定", img_hash],
                                     visible_keywords=["帳戶總覽", "交易明細", "信用卡", "示範", img_hash],
                                     style_notes="主色綠色，白底，圓角卡片", theme=ctx.get("theme", "light"), platform_guess=ctx.get("app_guess", ""))
    if schema is RerankResult:
        cands = ctx.get("candidates", [])
        # pick the candidate whose ingestion image hash matches, else the first
        best, conf, rel = -1, 0.0, "different_app"
        for i, c in enumerate(cands):
            if img_hash and (img_hash in (c.get("description") or "") or img_hash in " ".join(c.get("keywords") or [])):
                best, conf, rel = i, 0.92, "same_screen"
                break
        if best < 0 and cands:
            best, conf, rel = 0, 0.55, "same_app_other_screen"
        return RerankResult(best_candidate_index=best, confidence=conf, relation=rel, reason="fake provider 比對", theme=ctx.get("theme", "light"))
    if schema is VisualReview:
        return VisualReview(score=0.9, issues=[], privacy_leak=False)
    if schema is IntentResult:
        return _fake_intent(ctx.get("text", text), ctx)
    raise ValueError(f"fake provider 不支援 {schema.__name__}")


def _fake_intent(text: str, ctx: dict) -> IntentResult:
    q = text.lower()
    platforms = ctx.get("platforms", [])
    goals = ctx.get("goals", [])
    known = ctx.get("known_context") or {}
    res = IntentResult()
    if known.get("platform_id"):
        res.platform_id, res.platform_confidence = known["platform_id"], 1.0
    if known.get("goal_id"):
        res.goal_id, res.goal_confidence = known["goal_id"], 1.0
    if not res.platform_id:
        brand_hits = {}
        for p in platforms:
            names = [p["display_name"], p["brand"], p["brand"][:2], *p.get("aliases", [])]
            if any(n and n.lower() in q for n in names):
                brand_hits.setdefault(p["brand"], []).append(p)
        if len(brand_hits) == 1:
            brand, ps = next(iter(brand_hits.items()))
            res.brand = brand
            chan_words = {"mobile_app": ["app", "手機", "行動"], "web": ["網銀", "網頁", "網站", "電腦", "網路"]}
            by_word = [p for p in ps if any(w in q for w in chan_words.get(p["channel"], []))]
            if len(ps) == 1:
                res.platform_id, res.platform_confidence = ps[0]["id"], 0.9
            elif len(by_word) == 1:
                res.platform_id, res.platform_confidence = by_word[0]["id"], 0.85
            else:
                res.channel_ambiguous = True
                res.needs.append("channel")
        else:
            res.needs.append("platform")
    if not res.goal_id:
        hits = [g for g in goals if any(n and n.lower() in q for n in [g["name"], g["name"][:2], *g.get("aliases", [])])]
        if len(hits) == 1:
            res.goal_id, res.goal_confidence = hits[0]["id"], 0.9
        else:
            res.needs.append("goal")
    res.reason = "fake provider 關鍵字比對"
    return res


# ------------------------------------------------------------------ 虛擬客服

def _call(name: str, args: dict, text: str = "") -> AIMessage:
    return AIMessage(content=text, tool_calls=[{"name": name, "args": args, "id": f"call_{hashlib.md5((name + repr(args)).encode()).hexdigest()[:10]}", "type": "tool_call"}])


def assistant_reply(messages: list, catalog: dict) -> AIMessage:
    """Rule-based stand-in for the tool-calling assistant model: keyword-matches
    the citizen text to a flow, walks get_flow_steps → send_step_cards → closing
    line, and answers a screenshot with locate_screenshot. Same shapes the real
    model produces (AIMessage with tool_calls), so the loop is exercised end to end."""
    import json as _json
    last = messages[-1]
    if isinstance(last, ToolMessage):
        try:
            data = _json.loads(str(last.content))
        except Exception:
            data = {}
        if last.name == "get_flow_steps" and data.get("steps"):
            steps = data["steps"]
            cut = next((i for i, st in enumerate(steps) if st.get("branches")), len(steps) - 1)
            return _call("send_step_cards", {"flow_id": data["flow"]["id"], "step_ids": [st["step_id"] for st in steps[:cut + 1]]},
                         f"好的，這是「{data['flow']['name']}」的步驟，請照著圖操作：")
        if last.name == "send_step_cards":
            return AIMessage(content="以上就是全部步驟。照著圖做如果卡住，直接把畫面截圖傳給我，我再幫您看。")
        if last.name == "locate_screenshot":
            g = data.get("guidance") or {}
            outcome = data.get("outcome")
            if outcome == "located" and g.get("flow_id") and g.get("step_ids"):
                lead = f"看起來您目前在「{g.get('step_title', '')}」這一步，接下來請照下面的圖操作："
                return _call("send_step_cards", {"flow_id": g["flow_id"], "step_ids": g["step_ids"]}, lead)
            if g.get("ask") and g.get("options"):
                return _call("ask_choice", {"question": g["ask"], "options": [o["label"] for o in g["options"]]}, g.get("advice", ""))
            if g.get("flow_id") and g.get("step_ids"):
                return _call("send_step_cards", {"flow_id": g["flow_id"], "step_ids": g["step_ids"]}, g.get("advice") or "請從第一步重新開始：")
            return AIMessage(content=g.get("advice") or "這張截圖我認不出是哪個畫面，可以再拍一張完整的畫面，或用文字告訴我您卡在哪裡嗎？")
        if last.name == "ask_choice":
            return AIMessage(content="")
        return AIMessage(content="收到，請問還有哪裡需要協助？")
    text = str(last.content) if isinstance(last, HumanMessage) else ""
    if "附上一張截圖" in text:
        return _call("locate_screenshot", {})
    q = text.lower()
    platforms = [p for p in catalog.get("platforms", []) if p.get("has_flows")]
    goals = [g for g in catalog.get("goals", []) if g.get("has_flows")]
    flows = catalog.get("flows", [])
    brand_hits: dict[str, list[dict]] = {}
    for p in platforms:
        if any(n and n.lower() in q for n in [p["display_name"], p["brand"], p["brand"][:2], *p.get("aliases", [])]):
            brand_hits.setdefault(p["brand"], []).append(p)
    goal_hits = [g for g in goals if any(n and n.lower() in q for n in [g["name"], g["name"][:2], *g.get("aliases", [])])]
    if len(brand_hits) != 1:
        names = list(brand_hits) or list(dict.fromkeys(p["brand"] for p in platforms))
        if names:
            return _call("ask_choice", {"question": "請問您使用的是哪一個 App 或網站？", "options": names})
        return AIMessage(content="目前還沒有可以協助的服務。")
    brand, ps = next(iter(brand_hits.items()))
    if len(ps) > 1:
        words = {"mobile_app": ["app", "手機", "行動"], "web": ["網銀", "網頁", "網站", "電腦", "網路"]}
        ps = [p for p in ps if any(w in q for w in words.get(p["channel"], []))] or ps
    if len(ps) > 1:
        return AIMessage(content=f"請問您是用 {brand} 的 App 還是網頁版呢？")
    platform = ps[0]
    if len(goal_hits) != 1:
        here = [g for g in goals if any(f["platform_id"] == platform["id"] and g["id"] in f.get("goal_ids", []) for f in flows)] or goals
        if len(here) == 1:
            goal_hits = here
        else:
            return _call("ask_choice", {"question": "請問您要完成哪一項？", "options": [g["name"] for g in here]})
    flow = next((f for f in flows if f["platform_id"] == platform["id"] and goal_hits[0]["id"] in f.get("goal_ids", [])), None)
    if not flow:
        return AIMessage(content=f"抱歉，{platform['display_name']} 目前沒有「{goal_hits[0]['name']}」的教學。")
    return _call("get_flow_steps", {"flow_id": flow["id"], "goal_id": goal_hits[0]["id"]})
