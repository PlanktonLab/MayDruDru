"""Model access. All calls go through `structured_call`, which

* builds the LangChain chat model for the task (per-task model override),
* asks for strict structured output (Pydantic schema),
* orders content so system prompt + schema come first and images last
  (prefix caching), and
* records token usage / latency / cost into `llm_usage` and an OTel span.

`LLM_PROVIDER=fake` swaps in deterministic local responses so the whole
pipeline (worker, graphs, renderer, API) can run without any API key.
"""

from __future__ import annotations

import json
import logging
import time
from functools import lru_cache
from typing import Any, TypeVar

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from ..config import get_settings
from ..db import sessionmaker
from ..models import LlmUsage
from . import fake
from .image_utils import to_data_url
from .tracing import span

T = TypeVar("T", bound=BaseModel)
log = logging.getLogger(__name__)


class ModelError(Exception):
    pass


@lru_cache
def _chat_model(model: str, *, responses_api: bool = False):
    """One client per model name, reused across calls (keeps the HTTP pool warm).

    `responses_api=True` talks to OpenAI's Responses API instead of Chat
    Completions — required for function tools on the reasoning models (the
    assistant); the structured-output tasks stay on Chat Completions."""
    from langchain.chat_models import init_chat_model

    s = get_settings()
    kwargs: dict[str, Any] = {"model_provider": "openai", "api_key": s.openai_api_key or None,
                              "timeout": s.llm_timeout_seconds, "max_retries": s.llm_max_retries}
    if responses_api:
        kwargs["use_responses_api"] = True
    if s.openai_base_url:
        kwargs["base_url"] = s.openai_base_url
    return init_chat_model(model, **kwargs)


@lru_cache
def _embeddings():
    from langchain_openai import OpenAIEmbeddings

    s = get_settings()
    return OpenAIEmbeddings(model=s.embedding_model, api_key=s.openai_api_key, base_url=s.openai_base_url or None,
                            dimensions=s.embedding_dim, request_timeout=s.llm_timeout_seconds, max_retries=s.llm_max_retries)


def usage_record(task: str, model: str, usage: dict, latency_ms: int) -> dict:
    """The `llm_usage` row as a plain dict — token counts and the cost estimate.

    Pure arithmetic, no I/O: the test suite swaps out the write (it must never
    open a database connection) but still wants the same numbers."""
    s = get_settings()
    inp = int(usage.get("input_tokens", 0) or 0)
    out = int(usage.get("output_tokens", 0) or 0)
    cached = int((usage.get("input_token_details") or {}).get("cache_read", 0) or 0)
    cost = ((inp - cached) * s.price_input_per_m + cached * s.price_cached_input_per_m + out * s.price_output_per_m) / 1_000_000
    return {"task": task, "model": model, "input_tokens": inp, "cached_tokens": cached,
            "output_tokens": out, "latency_ms": latency_ms, "cost_usd": round(cost, 6)}


async def record_usage(task: str, model: str, usage: dict, latency_ms: int, tenant_id: str | None,
                       ref_type: str = "", ref_id: str = "") -> dict:
    rec = usage_record(task, model, usage, latency_ms)
    try:
        async with sessionmaker()() as db:
            db.add(LlmUsage(tenant_id=tenant_id, ref_type=ref_type, ref_id=ref_id, **rec))
            await db.commit()
    except Exception:
        log.warning("failed to record LLM usage for task %s", task, exc_info=True)
    return rec


async def structured_call(
    task: str,
    schema: type[T],
    system: str,
    text: str,
    images: list[bytes] | None = None,
    *,
    tenant_id: str | None = None,
    ref_type: str = "",
    ref_id: str = "",
    fake_context: dict | None = None,
) -> tuple[T, dict]:
    """Returns (parsed_output, usage_record)."""
    s = get_settings()
    images = images or []
    t0 = time.perf_counter()
    with span(f"llm.{task}", task=task, provider=s.llm_provider, images=len(images)) as sp:
        if s.llm_provider == "fake":
            out = fake.respond(task, schema, text, images, fake_context or {})
            latency = int((time.perf_counter() - t0) * 1000)
            usage = {"input_tokens": len(text) // 3 + 800 * len(images), "output_tokens": len(out.model_dump_json()) // 3}
            rec = await record_usage(task, "fake", usage, latency, tenant_id, ref_type, ref_id)
            sp.set_attribute("tokens.input", rec["input_tokens"])
            return out, rec

        model_name = s.model_for(task)
        llm = _chat_model(model_name).with_structured_output(schema, include_raw=True)
        content: list[dict] = [{"type": "text", "text": text}]
        for img in images:  # images last → the cacheable prefix stays stable
            content.append({"type": "image_url", "image_url": {"url": to_data_url(img), "detail": "high"}})
        try:
            result = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=content)])
        except Exception as e:  # network, auth, refusal ...
            raise ModelError(f"{task}: {e}") from e
        parsed = result.get("parsed")
        if parsed is None:
            raise ModelError(f"{task}: 模型未回傳合法的結構化輸出 ({result.get('parsing_error')})")
        raw = result.get("raw")
        usage = getattr(raw, "usage_metadata", None) or {}
        latency = int((time.perf_counter() - t0) * 1000)
        rec = await record_usage(task, model_name, dict(usage), latency, tenant_id, ref_type, ref_id)
        sp.set_attribute("tokens.input", rec["input_tokens"])
        sp.set_attribute("tokens.output", rec["output_tokens"])
        sp.set_attribute("tokens.cached", rec["cached_tokens"])
        return parsed, rec


# ------------------------------------------------------------------ embeddings

async def embed(text: str) -> list[float]:
    s = get_settings()
    if s.llm_provider == "fake" or not s.openai_api_key:
        return fake.embed(text, s.embedding_dim)
    return await _embeddings().aembed_query(text)


def dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=None)
