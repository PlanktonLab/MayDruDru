I have a complete picture. Here is the exact map.

---

# SOP_Tutor — Port Map

Root: `/Users/sam/Documents/MyProject/mixProject/SOP_Tutor`
Top level: `README.md`, `SPEC.md` (v0.8), `CLAUDE.md`, `.env.example`, `.gitignore`, `.claude/launch.json`, `docker-compose.yml`, `backend/`, `frontend/`, `docker/`.

---

## 1. `backend/pyproject.toml` + `requirements.txt`

**`/Users/sam/Documents/MyProject/mixProject/SOP_Tutor/backend/pyproject.toml`**

```toml
[project]
name = "sop-tutor-backend"; version = "0.1.0"; requires-python = ">=3.12"
```

Declared deps (unpinned ranges):
`fastapi[standard]>=0.115`, `sqlalchemy[asyncio]>=2.0`, `asyncpg`, `psycopg[binary,pool]`, `pgvector`, `alembic`, `pydantic-settings`, `arq`, `redis`, `minio`, `cryptography`, `pillow`, `httpx`, `python-multipart`, `pyjwt`, `passlib[bcrypt]`, `bcrypt<4.1`, `langchain>=1`, `langchain-openai`, `langgraph>=1`, `langgraph-checkpoint-postgres`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp`.

`[project.optional-dependencies] dev = ["pytest", "pytest-asyncio", "aiosqlite"]`

**Tool config — only one block exists:**
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```
**There is NO ruff config, NO mypy config** anywhere in the repo (no `.ruff.toml`, `mypy.ini`, `setup.cfg`, `tox.ini`). Frontend lint is `oxlint` instead of eslint. Worth deciding at monorepo time.

**`backend/requirements.txt`** is a fully-pinned lock-style list (~140 lines), a superset of pyproject. Notable exact pins: `fastapi==0.141.1`, `starlette==1.6.0`, `uvicorn==0.53.0`, `SQLAlchemy==2.0.54`, `asyncpg==0.31.0`, `psycopg==3.3.5`, `pgvector==0.5.0`, `alembic==1.20.0`, `pydantic==2.13.5`, `pydantic-settings==2.15.0`, `arq==0.28.0`, `redis==5.3.1`, `hiredis==3.4.1`, `minio==7.2.20`, `cryptography==50.0.1`, `pillow==12.3.0`, `httpx==0.28.1`, `python-multipart==0.0.32`, `PyJWT==2.14.0`, `passlib==1.7.4`, `bcrypt==4.0.1`, `argon2-cffi==25.1.0`, `langchain==1.4.0`, `langchain-core==1.6.3`, `langchain-openai==1.6.2`, `langgraph==1.2.11`, `langgraph-checkpoint==4.2.0`, `langgraph-checkpoint-postgres==3.1.2`, `langgraph-checkpoint-redis==0.5.2`, `langsmith==0.12.5`, `openai==3.14.1`, `tiktoken==0.14.0`, `numpy==2.5.3`, `opentelemetry-*==1.44.0` (semconv `0.65b0`), `playwright==1.63.0`, `sentry-sdk==2.69.2`, `pytest==9.1.1`, `pytest-asyncio==1.4.0`, `aiosqlite==0.22.1`.
Note: `playwright`, `sentry-sdk`, `aiosqlite`, `redisvl`, `argon2-cffi` are in requirements.txt but not in pyproject — the api/worker images install the full file.

**`backend/renderer/requirements.txt`**: `fastapi[standard]>=0.115` + `playwright==1.63.0` (comment: must match the browsers in `docker/renderer.Dockerfile`).

**`backend/alembic.ini`**: `script_location = alembic`, `prepend_sys_path = .`, `sqlalchemy.url = postgresql://sop:sop@localhost:5432/sop` (overwritten at runtime, see §11).

---

## 2. `backend/app/config.py` — `Settings`

`model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")`. `DEFAULT_SECRET_KEY = "change-me-please"`. Accessor: `@lru_cache get_settings() -> Settings`.

Every field with its default:

| field | default |
|---|---|
| `app_name: str` | `"SOP Tutor"` |
| `env: str` | `"dev"` |
| `secret_key: str` | `DEFAULT_SECRET_KEY` |
| `jwt_expire_minutes: int` | `60*12` = 720 |
| `database_url: str` | `postgresql+asyncpg://sop:sop@localhost:5432/sop` |
| `database_url_sync: str` | `postgresql://sop:sop@localhost:5432/sop` |
| `redis_url: str` | `redis://localhost:6379/0` |
| `s3_endpoint: str` | `localhost:9000` |
| `s3_access_key: str` | `minioadmin` |
| `s3_secret_key: str` | `minioadmin` |
| `s3_secure: bool` | `False` |
| `s3_bucket_private: str` | `sop-private` |
| `s3_bucket_public: str` | `sop-public` |
| `public_media_base_url: str` | `http://localhost:8000/media` |
| `original_encryption_key: str` | `""` (Fernet; derived in dev) |
| `renderer_url: str` | `http://localhost:8100` |
| `renderer_token: str` | `""` |
| `max_upload_bytes: int` | `20*1024*1024` |
| `max_image_pixels: int` | `40_000_000` |
| `login_attempts_per_minute: int` | `10` |
| `session_ttl_seconds: int` | `86400` |
| `original_ttl_days: int` | `7` |
| `locate_confidence_threshold: float` | `0.6` |
| `locate_low_confidence: float` | `0.35` |
| `intent_confidence_threshold: float` | `0.7` |
| `max_clarifications: int` | `3` |
| `max_generation_attempts: int` | `3` |
| `stale_job_minutes: int` | `45` |
| `replica_visual_review: bool` | `True` |
| `visual_review_min_score: float` | `0.85` |
| `focus_box_area_limit: float` | `0.6` |
| `retrieval_top_k: int` | `5` |
| `llm_provider: str` | `"openai"` (`openai` \| `fake`) |
| `openai_api_key: str` | `""` |
| `openai_base_url: str` | `""` |
| `default_model: str` | `"gpt-5.6-luna"` |
| `model_structure` / `model_styledoc` / `model_describe` / `model_rerank` / `model_intent` / `model_assistant` | `""` each |
| `model_replica: str` | `"gpt-5.6-sol"` |
| `assistant_max_tool_rounds: int` | `6` |
| `embedding_model: str` | `"text-embedding-3-small"` |
| `embedding_dim: int` | `1536` |
| `llm_timeout_seconds: float` | `180.0` |
| `llm_max_retries: int` | `2` |
| `image_max_edge: int` | `1500` |
| `price_input_per_m: float` | `1.25` |
| `price_cached_input_per_m: float` | `0.125` |
| `price_output_per_m: float` | `10.0` |
| `otel_exporter_otlp_endpoint: str` | `""` |
| `otel_service_name: str` | `"sop-tutor"` |
| `bootstrap_tenant_name` / `bootstrap_owner_email` / `bootstrap_owner_password` | `""` each |
| `cors_origins: list[str]` | `["http://localhost:5173", "http://localhost:8080"]` |

Methods:
- `model_for(task: str) -> str` — `getattr(self, f"model_{task}", "") or self.default_model`. This is the whole per-task model override mechanism; task names must match a `model_<task>` field.
- `is_production -> bool` — `env.lower() in ("prod","production")`.
- **`insecure_defaults() -> list[str]`** returns zh-TW problem strings; flags, in order:
  1. `secret_key` in `(DEFAULT_SECRET_KEY, "")` **or** `len < 32` → `"SECRET_KEY 未設定或過短（至少 32 字元）"`
  2. `not original_encryption_key` → `"ORIGINAL_ENCRYPTION_KEY 未設定"`
  3. `s3_access_key == "minioadmin"` or `s3_secret_key == "minioadmin"` → `"S3/MinIO 仍使用預設帳密"`
  4. `not renderer_token` → `"RENDERER_TOKEN 未設定"`
  5. `bootstrap_owner_password` set and `len < 12` → `"BOOTSTRAP_OWNER_PASSWORD 過短（至少 12 字元）"`

  Consumed by `main.check_settings()`: production → `RuntimeError("拒絕以不安全的設定啟動：" + "；".join(problems))`; dev → `log.warning`.

---

## 3. `backend/app/models.py` — schema

`Base` from `app/db.py`. `EMBED_DIM = 1536`. `now()` = tz-aware UTC. `new_id()` = `uuid4().hex` (32 chars, so all PKs are `String(32)`). `TsMixin` adds `created_at`, `updated_at: DateTime(timezone=True)` (`onupdate=now`).

**No `version` column on any table** except `StyleDoc.version` / `StyleDocVersion.version` / `FlowVersion.version` (content versioning, not optimistic locking). There is **no row-level optimistic-concurrency `version` column anywhere**.

**`tenant_id` columns** (all `ForeignKey("tenants.id", ondelete="CASCADE"), index=True` unless noted): `users`, `api_keys`, `goals`, `platforms`, `platform_components`, `flows`. Plain `String(32), index=True` (no FK): `flow_versions.tenant_id`, `event_logs.tenant_id`, `llm_usage.tenant_id` (nullable), `eval_cases.tenant_id`, `eval_runs.tenant_id`.
**`steps`, `edges`, `variants`, `style_docs`, `style_doc_versions` have NO `tenant_id`** — they are scoped by joining up to `Flow`/`Platform` (see `deps._tenant_scoped`).

Tables:

- **`tenants`** (TsMixin): `id` PK, `name String(200)`, `slug String(80) unique`, `settings JSON default dict` (holds `stepcard_layout`, `policy`, legacy `assistant`).
- **`users`** (TsMixin): `id`, `tenant_id`, `email String(320)`, `name String(120)=""`, `password_hash String(200)`, `role String(20)="viewer"`, `is_active Boolean=True`, `password_changed_at DateTime(tz) nullable`. `UniqueConstraint("tenant_id","email", name="uq_user_tenant_email")`.
  `ROLES = ("viewer","reviewer","editor","admin","owner")` — ascending privilege.
- **`api_keys`** (TsMixin): `id`, `tenant_id`, `name String(120)`, `prefix String(12) index`, `key_hash String(128) unique`, `status String(20)="active"` (`active|disabled`), `rate_limit_per_minute Integer=120`, `last_used_at DateTime(tz) nullable`.
- **`goals`** (TsMixin): `id`, `tenant_id`, `name String(120)`, `description Text=""`, `aliases JSON=list`.
- **`platforms`** (TsMixin): `id`, `tenant_id`, `display_name String(160)`, `brand String(120)`, `channel String(30)="mobile_app"` (`mobile_app|web|desktop`), `category String(40)=""`, `aliases JSON=list`, `demo_data JSON=list` (`[{key,label,value,real}]`), `canvas_x/canvas_y Float=0` (unused since v0.2), `collapsed Boolean=False`, `owner_tenant_id String(32) nullable`, `forked_from_id String(32) nullable` (reserved for v2).
  Relationships: `style_doc` (1:1, `uselist=False`, cascade all/delete-orphan), `flows` (1:N, cascade).
- **`style_docs`** (TsMixin): `id`, `platform_id FK unique`, `ai_generated JSON=dict`, `human_notes Text=""`, `version Integer=0`, `embedding Vector(1536) nullable`. Back-ref `platform`.
- **`platform_components`** (TsMixin): `id`, `tenant_id`, `platform_id FK index`, `name String(80)`, `kind String(20)="other"` from `COMPONENT_KINDS = ("nav_bar","tab_bar","header","footer","other")`, `html Text`, `width/height Integer=0`, `thumb_key String(300) nullable`, `created_by String(32) nullable`.
- **`style_doc_versions`** (no TsMixin): `id`, `style_doc_id FK index`, `version Integer`, `ai_generated JSON`, `human_notes Text`, `reason String(200)`, `created_at`.
- **`flows`** (TsMixin): `id`, `tenant_id`, `platform_id FK index`, `name String(160)`, `status String(20)="draft"` (`draft|published`), `current_version_id String(32) nullable`, `canvas_x/canvas_y Float=0` (unused), `drift_count Integer=0`. Relationships: `platform`, `steps` (cascade), `edges` (cascade).
- **`steps`** (TsMixin): `id`, `flow_id FK index`, `title String(200)=""`, `instruction Text=""`, `stuck_hint Text=""`, `canvas_x/canvas_y Float=0`, `is_start Boolean=False`, `is_end Boolean=False`, `goal_id FK goals.id ondelete=SET NULL nullable index`, `drift_count Integer=0`. Relationships: `flow`, `variants` (cascade).
  A flow's goals = distinct `goal_id` of its end steps (migration 0007 moved goals from flows to steps).
- **`edges`** (TsMixin): `id`, `flow_id FK index`, `from_step_id FK steps.id index`, `to_step_id FK steps.id index`, `condition_label String(120)=""`, `sort_order Integer=0`.
- **`variants`** (TsMixin): `id`, `step_id FK index`, `theme String(10)` (`light|dark`), `status String(20)="not_uploaded"`, `original_key String(300) nullable`, `original_uploaded_at DateTime(tz) nullable`, `original_uploaded_by String(32) nullable`, `original_width/original_height Integer=0`, `focus_boxes JSON=list`, `prompt_notes Text=""`, `structure JSON nullable`, `replica_html_key/replica_png_key String(300) nullable`, `replica_width/replica_height Integer=0`, `kept_texts JSON=list`, `fake_data JSON=list` (`[{key,label,value,source}]`), `fake_data_reviewed Boolean=False`, `check_report JSON nullable`, `review_history JSON=list`, `attempts Integer=0`, `progress String(60)=""`, `error Text=""`, `thread_id String(64) nullable` (LangGraph checkpoint thread), `annotations JSON=list`, `stepcard_key/stepcard_preview_key String(300) nullable`, `stepcard_width/stepcard_height Integer=0`, `stepcard_layout JSON nullable`, `description Text=""`, `keywords JSON=list`, `embedding Vector(1536) nullable`, `drift_count Integer=0`. `UniqueConstraint("step_id","theme", name="uq_variant_step_theme")`.
  Status values: `not_uploaded, uploaded, focusing, processing, pending_review, approved, annotating, rendering, completed, failed`. `JOB_OWNED_STATUSES = frozenset({"processing","approved","rendering"})` — the API refuses edits in these.
- **`flow_versions`**: `id`, `flow_id FK index`, `tenant_id String(32) index`, `version Integer`, `snapshot JSON`, `published_by String(32) nullable`, `created_at`. `UniqueConstraint("flow_id","version", name="uq_flow_version")`.
- **`event_logs`**: `id`, `tenant_id index`, `session_id String(64) index`, `event_type String(40) index`, `flow_id String(32) nullable index`, `step_id String(32) nullable`, `payload JSON=dict`, `source String(20)="api"` (`api|playground|eval`), `created_at index`.
- **`llm_usage`**: `id`, `tenant_id nullable index`, `task String(40) index`, `model String(80)`, `input_tokens/cached_tokens/output_tokens Integer=0`, `latency_ms Integer=0`, `cost_usd Float=0`, `ref_type String(20)=""`, `ref_id String(64)=""`, `created_at index`.
- **`eval_cases`** (TsMixin): `id`, `tenant_id index`, `image_key String(300)`, `platform_id String(32)`, `step_id/goal_id String(32) nullable`, `text Text=""`, `note String(200)=""`.
- **`eval_runs`**: `id`, `tenant_id index`, `status String(20)="running"`, `label String(200)=""`, `config JSON=dict`, `results JSON=list`, `summary JSON=dict`, `started_at`, `finished_at nullable`.

Module-level indexes (HNSW / pgvector):
```python
Index("ix_variants_embedding", Variant.embedding, postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"})
Index("ix_style_docs_embedding", StyleDoc.embedding, postgresql_using="hnsw", postgresql_ops={"embedding": "vector_cosine_ops"})
```

**`backend/app/db.py`**: `Base(DeclarativeBase)`; lazy `engine()` — `create_async_engine(database_url, pool_pre_ping=True, pool_size=10, max_overflow=10, pool_timeout=30, pool_recycle=1800)`; `sessionmaker()` — `async_sessionmaker(engine(), expire_on_commit=False)`; `release_connection(db)` (commits to return the connection before a slow await); `get_db()` async generator dependency.

---

## 4. `backend/app/main.py` — app construction

- **Module-level, before app creation:**
  `MultiPartParser.spool_max_size = get_settings().max_upload_bytes + 1024*1024` (= 21 MiB) — so Starlette never spools an upload to disk (privacy rule).
- `_bootstrap_from_env()` — no-op unless all three `bootstrap_*` settings are set; aborts if any tenant exists; otherwise creates `Tenant(name=..., slug="default")` + `User(role="owner", password_hash=hash_password(...))`. (Note: does **not** set `password_changed_at`, unlike the `/api/auth/bootstrap` route.)
- `check_settings()` — see §2.
- **`lifespan`**: `check_settings()` → `setup_tracing()` → `storage.ensure_buckets()` (exceptions logged, not fatal) → `await _bootstrap_from_env()` (exceptions logged with a warning that `/api/auth/bootstrap` is still open) → `yield`. No shutdown work.
- **`create_app()`**: `FastAPI(title=s.app_name, version="0.1.0", lifespan=lifespan)`.
  - **Middleware — only CORS**: `CORSMiddleware(allow_origins=s.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])`. No auth middleware, no request-id, no exception middleware.
  - **Routers mounted, in this order**: `auth, tenant, catalog_admin, components, flows, variants, playground, evals, dashboard, public_api, media`. Prefixes are declared on each router, not here.
  - `GET /health` → `{"ok": True, "provider": s.llm_provider, "model": s.default_model}`.
- `app = create_app()` at import time.

`app/routers/variant_views.py` is **not** a router — it is a serializer module and is deliberately not imported by `main.py`.

---

## 5. Routers — every endpoint

### `routers/auth.py` — `APIRouter(prefix="/api/auth", tags=["auth"])`
`LOGIN_WINDOW_SECONDS = 60`; `BOOTSTRAP_LOCK_ID = 0x50505401` (pg advisory lock).
Helpers: `login_rate_key(client_ip, email) -> f"login:{ip}:{email.lower()}"`; `_login_allowed(request,email)` — Redis `INCR` + `EXPIRE 60`, fails **open** if Redis is down.

| method | path | auth | purpose |
|---|---|---|---|
| POST | `/api/auth/login` | none (rate limited per IP+email) | `LoginIn{email,password,tenant_slug?}` → `TokenOut{access_token}`. Always spends one bcrypt verify even for unknown emails (timing). 429 on rate limit, 401 otherwise. |
| GET | `/api/auth/me` | `current_user` | `UserOut` |
| GET | `/api/auth/bootstrap-status` | none | `{"needs_bootstrap": tenant_count == 0}` |
| POST | `/api/auth/bootstrap` | none, guarded | `BootstrapIn` → first tenant + owner under `pg_advisory_xact_lock`; 403 if any tenant exists. Sets `password_changed_at`. |

### `routers/public_api.py` — `APIRouter(prefix="/v1", tags=["public"])`
**Every endpoint uses `caller: ApiCaller = Depends(api_caller)` (X-API-Key).** Three layers documented in the module docstring: Chat API, Session API, stateless building blocks.

Local models: `SessionCreate{external_user_id, hint?, known_context?, theme:"light"|"dark"}`, `MessageIn{text}`, `SessionAction{action: next|prev|choose_branch|choose_option|restart, edge_id?, option_id?}`, `ChatCreate{external_user_id, theme, policy?}`, `IntentIn{text, known_context?}`.
`_read_png(file)` maps `ImageTooLarge`→`ApiError(413, IMAGE_TOO_LARGE)`, `InvalidImage`→`ApiError(400, IMAGE_INVALID)`.

| method | path | purpose |
|---|---|---|
| POST | `/v1/chat` | `ChatEngine.start(...)`; returns `{chat_id, messages:[{kind:"text",text:greeting}]}`. `external_user_id` is hashed via `hash_external_user`. |
| POST | `/v1/chat/{chat_id}/messages` | multipart `text: Form(None)` + `file: File(None)`; one 虛擬客服 turn. Strips `_debug` from the response. 400 `INVALID_ACTION` if neither text nor file. |
| GET | `/v1/chat/{chat_id}` | `ChatEngine(db).status(...)` |
| POST | `/v1/locate` | multipart `file` + Form `platform_id?, flow_id?, step_id?, goal_id?`. Runs `ai.retrieval.locate` with the tenant `Policy` thresholds, then `services.guide.locate_guidance`. Returns `{**res.public(), "guidance": g.to_dict()}`. Deletes the PNG in `finally`. |
| POST | `/v1/intent` | `resolve_intent(...)` → `IntentOutcome.public()` |
| GET | `/v1/flows/{flow_id}/steps` | query `goal_id?, from_step_id?, theme=light, number_from=1`. Published snapshot only; 404 `FLOW_NOT_PUBLISHED` / `FLOW_NOT_FOUND`. Returns `{**step_rows, version, messages}`. |
| POST | `/v1/sessions` | `SessionEngine.start(...)`, `source="api"` |
| POST | `/v1/sessions/{session_id}/messages` | `handle(..., {"kind":"text","text":...})` |
| POST | `/v1/sessions/{session_id}/screenshots` | multipart `file`; `handle(..., {"kind":"screenshot"}, screenshot=png)` |
| POST | `/v1/sessions/{session_id}/actions` | `handle(..., {"kind":"action", **body})` |
| GET | `/v1/sessions/{session_id}` | `SessionEngine.status` |
| GET | `/v1/catalog/platforms` | `tenant_catalog()[0]`, filtered to `has_flows` |
| GET | `/v1/catalog/goals` | `tenant_catalog()[1]`, filtered to `has_flows` |
| GET | `/v1/catalog/flows` | `tenant_catalog()[2]` |
| GET | `/v1/catalog/flows/{flow_id}/cards` | published snapshot → `{flow, version, edges, steps:[{id,title,instruction,is_start,is_end,cards:{theme:{image_url,preview_url,width,height}}}]}` |

### `routers/tenant.py` — `APIRouter(prefix="/api", tags=["tenant"])`
| method | path | auth |
|---|---|---|
| GET | `/api/tenant` | `current_user` |
| PUT | `/api/tenant/stepcard-layout` | `require("admin")` |
| GET | `/api/tenant/policy` | `current_user` |
| PUT | `/api/tenant/policy` | `require("admin")` |
| GET | `/api/tenant/assistant` | `current_user` (legacy shape) |
| GET | `/api/members` | `current_user` |
| POST | `/api/members` | `require("admin")` |
| PATCH | `/api/members/{member_id}` | `require("admin")` |
| DELETE | `/api/members/{member_id}` | `require("admin")` |
| GET | `/api/api-keys` | `require("admin")` |
| POST | `/api/api-keys` | `require("admin")` (returns plaintext once) |
| PATCH | `/api/api-keys/{key_id}` | `require("admin")` |
| DELETE | `/api/api-keys/{key_id}` | `require("admin")` |

Guard helpers: `removes_last_owner(target, active_owner_count, new_role=None, ...)`, `_active_owner_count`, `_email_taken`.

### `routers/catalog_admin.py` — `APIRouter(prefix="/api", tags=["catalog"])`
| method | path | auth |
|---|---|---|
| GET | `/api/goals` | `current_user` |
| POST | `/api/goals` | `require("admin")` |
| PUT | `/api/goals/{goal_id}` | `require("admin")` |
| DELETE | `/api/goals/{goal_id}` | `require("admin")` |
| GET | `/api/platforms` | `current_user` |
| POST | `/api/platforms` | `require("editor")` |
| PATCH | `/api/platforms/{platform_id}` | `require("editor")` |
| DELETE | `/api/platforms/{platform_id}` | `require("admin")` (purges assets first) |
| GET | `/api/platforms/{platform_id}/style-doc` | `current_user` |
| PATCH | `/api/platforms/{platform_id}/style-doc` | `require("editor")` |
| GET | `/api/platforms/{platform_id}/style-doc/versions` | `current_user` |

### `routers/components.py` — `APIRouter(prefix="/api", tags=["components"])`
| method | path | auth |
|---|---|---|
| GET | `/api/platforms/{platform_id}/components` | `current_user` |
| POST | `/api/variants/{variant_id}/components` | `require("editor")` (calls renderer `/extract`) |
| PATCH | `/api/components/{component_id}` | `require("editor")` |
| GET | `/api/components/{component_id}/thumb.png` | `current_user` (private bucket) |
| DELETE | `/api/components/{component_id}` | `require("admin")` |

### `routers/flows.py` — `APIRouter(prefix="/api", tags=["flows"])`
| method | path | auth |
|---|---|---|
| GET | `/api/canvas` | `current_user` → `CanvasOut` (platforms+goals+flows+steps+edges, variants as summaries) |
| PUT | `/api/canvas/layout` | `require("editor")` |
| POST | `/api/flows` | `require("editor")` |
| PATCH | `/api/flows/{flow_id}` | `require("editor")` |
| DELETE | `/api/flows/{flow_id}` | `require("editor")` |
| GET | `/api/flows/{flow_id}/validate` | `current_user` → `ValidationOut` |
| POST | `/api/flows/{flow_id}/publish` | `require_any("reviewer")` |
| POST | `/api/flows/{flow_id}/unpublish` | `require_any("reviewer")` |
| POST | `/api/flows/{flow_id}/render-cards` | `require("editor")` → `RenderCardsOut{queued,skipped}` |
| GET | `/api/flows/{flow_id}/versions` | `current_user` |
| POST | `/api/flows/{flow_id}/rollback/{version_id}` | `require_any("reviewer")` |
| POST | `/api/steps` | `require("editor")` |
| GET | `/api/steps/{step_id}` | `current_user` |
| PATCH | `/api/steps/{step_id}` | `require("editor")` (re-renders cards if card text changed) |
| DELETE | `/api/steps/{step_id}` | `require("editor")` |
| POST | `/api/steps/{step_id}/duplicate` | `require("editor")` |
| POST | `/api/edges` | `require("editor")` |
| PATCH | `/api/edges/{edge_id}` | `require("editor")` |
| DELETE | `/api/edges/{edge_id}` | `require("editor")` |

Helpers worth porting intact: `_purge_or_503(variants)` (objects deleted before rows, 503 on failure), `layout_positions`, `default_goal_for_end`, `card_text_changed`, `_rerender_cards`, `_copy_private`, `_duplicate_variant`, `renderable_variants`.

### `routers/variants.py` — `APIRouter(prefix="/api", tags=["variants"])`
`ensure_not_job_owned(v)` raises if `v.status in JOB_OWNED_STATUSES`. `start_job(db, v, status, progress, job, *args)` flips state and enqueues via `jobs.enqueue`.

| method | path | auth |
|---|---|---|
| GET | `/api/variants/{variant_id}` | `current_user` |
| GET | `/api/meta/annotation-types` | none declared (no dependency) |
| POST | `/api/variants/{variant_id}/original` | `require("editor")` (multipart upload, encrypted to private bucket) |
| GET | `/api/variants/{variant_id}/original.png` | `current_user` |
| DELETE | `/api/variants/{variant_id}/original` | `require("editor")` |
| PUT | `/api/variants/{variant_id}/focus-boxes` | `require("editor")` |
| POST | `/api/variants/{variant_id}/process` | `require("editor")` → enqueues `process_variant` |
| GET | `/api/review/queue` | `current_user` |
| POST | `/api/variants/{variant_id}/review` | `require_any("reviewer")` → enqueues `resume_variant` |
| POST | `/api/variants/{variant_id}/fake-data` | `require("editor")` (adopts picks into platform `demo_data`) |
| GET | `/api/variants/{variant_id}/replica.png` | `current_user` |
| GET | `/api/variants/{variant_id}/replica.html` | `current_user` |
| PUT | `/api/variants/{variant_id}/replica-html` | `require("admin")` (advanced edit; runs `unsafe_html_problems`) |
| PUT | `/api/variants/{variant_id}/annotations` | `require("editor")` |
| POST | `/api/variants/{variant_id}/card-preview` | `current_user` → `CardPreviewOut` |
| PUT | `/api/variants/{variant_id}/stepcard-layout` | `require("editor")` |
| POST | `/api/variants/{variant_id}/render-card` | `require("editor")` → enqueues `render_stepcard` |

### `routers/playground.py` — `APIRouter(prefix="/api/playground", tags=["playground"])` — all `current_user`
`POST /sessions`, `POST /sessions/{id}/messages`, `POST /sessions/{id}/screenshots`, `POST /sessions/{id}/actions`, `GET /sessions/{id}`, `POST /chats`, `GET /chats/{chat_id}`, `POST /chats/{chat_id}/messages` (multipart text+file). Responses keep `_debug`.

### `routers/evals.py` — `APIRouter(prefix="/api/evals", tags=["evals"])`
`GET /cases` (`current_user`), `POST /cases` (`require("editor")`, multipart + Form `platform_id, step_id?, goal_id?, text, note`), `GET /cases/{case_id}/image.png` (`require("editor")`), `DELETE /cases/{case_id}` (`require("editor")`), `POST /runs` (`require("editor")` → enqueues `run_eval`), `GET /runs` (`current_user`), `GET /runs/{run_id}` (`current_user`).

### `routers/dashboard.py` — `APIRouter(prefix="/api/dashboard", tags=["dashboard"])`
`GET /summary?days=30` (`ge=1, le=365`), `current_user`.

### `routers/media.py` — `APIRouter(tags=["media"])`, no prefix
`GET /media/{key:path}` — **no auth**. Rejects `".."` and anything not starting with `PUBLIC_PREFIXES = ("cards/","previews/","thumbs/")` → 404. Serves from the public bucket with `Cache-Control: public, max-age=31536000, immutable`; content type `image/jpeg` for `.jpg` else `image/png`.

---

## 6. `deps.py` + `security.py`

**`app/security.py`**
- `pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")`; `PASSWORD_MIN_LENGTH = 12`.
- `hash_password(p)`, `verify_password(p, h)` (swallows exceptions → False).
- `hash_password_async(p)` / `verify_password_async(p, h|None)` — via `asyncio.to_thread`; the async verify spends a real bcrypt round against `_dummy_hash()` when `h is None`, so unknown accounts cost the same.
- `create_token(user_id, tenant_id, role) -> str` — HS256, claims `{sub, tid, role, iat, exp=now+jwt_expire_minutes}`.
- `decode_token(token) -> dict` — HS256 with `settings.secret_key`.
- `token_predates_password_change(payload, password_changed_at) -> bool` — whole-second comparison of `iat`.
- `generate_api_key() -> (plaintext, prefix, hash)` — `"sk_" + secrets.token_urlsafe(32)`, prefix = first 10 chars.
- `hash_api_key(raw) -> sha256 hex`.
- `hash_external_user(tenant_id, external_user_id) -> sha256(f"{tid}:{uid}")[:32]`.

**`app/deps.py`**
- `ROLE_RANK = {role: rank for rank, role in enumerate(ROLES)}` → viewer 0, reviewer 1, editor 2, admin 3, owner 4. `LAST_USED_RESOLUTION = timedelta(minutes=1)`.
- `@dataclass CurrentUser{id, tenant_id, role, email, name}` with `at_least(role)`.
- `async current_user(request, db=Depends(get_db)) -> CurrentUser` — requires `Authorization: Bearer …`; 401 `"未登入"` / `"登入已失效"` / `"帳號不存在或已停用"` / `"密碼已變更，請重新登入"`.
- `require(role)` — dependency factory, minimum-rank gate, 403 `f"需要 {role} 以上的權限"`.
- `require_any(*roles)` — exact-role gate that admins and owners always pass, 403 `f"需要 {', '.join(roles)} 角色"`.
- `_tenant_scoped(model, tenant_id)` — `Variant` joins `Step`→`Flow`; `Step`/`Edge` join `Flow`; otherwise the model needs its own `tenant_id` (else `TypeError`).
- `get_owned(db, model, obj_id, user, not_found_message, *, options=())` — tenant-scoped load or 404 with a zh-TW message.
- `@dataclass ApiCaller{tenant_id, api_key_id, name}`.
- `_check_rate_limit(key)` — **fixed one-minute window per API key**: Redis key `f"rl:{key.id}:{epoch_minute}"`, `INCR`, `EXPIRE 70` on first hit; any Redis exception returns silently (fails open). Over limit → `ApiError(429, RATE_LIMITED, "超過速率限制")`.
- `last_used_is_stale(last_used_at, now)`.
- `api_caller(x_api_key: Header(alias="X-API-Key"), db)` — 401 `{"code":"unauthorized","message":"缺少 X-API-Key"}` / `"API key 無效或已停用"`; looks the key up by `key_hash`, requires `status == "active"`, rate-limits, then updates `last_used_at` at most once a minute.

Login rate limiting is separate and lives in `routers/auth.py` (per IP+email, `login_attempts_per_minute`).

---

## 7. `app/services/*`

- **`guide.py`** — the generic guidance layer every channel sits on.
  Constants: `CHANNEL_LABEL = {"mobile_app":"手機 App","web":"網頁版","desktop":"電腦版"}`; actions `SEND="send"`, `RESTART="restart"`, `ASK="ask"`, `RETAKE="retake"`, `HANDOFF="handoff"`, `ACTIONS`.
  - `card_for(step: dict, theme: str) -> tuple[dict|None, str]`
  - `goal_for(snapshot, goal_id, fallback=None) -> str|None`
  - `step_rows(snapshot, goal_id=None) -> dict`
  - `@dataclass StepBatch{messages, sent, textual, unknown}`
  - `async step_messages(snapshot, step_ids, theme, *, goal_id=None, start_number=1, policy=None) -> StepBatch`
  - `@dataclass IntentOutcome{platform_id, brand, goal_id, flow_id, needs, reason, intent, usage}` + `.public()`
  - `async resolve_intent(db, tenant_id, text, known, *, content_mode="published", ref_id="") -> IntentOutcome`
  - `@dataclass Guidance{outcome, action, advice, ask, options, ask_kind, flow_id, flow_name, step_id, step_title, step_index, total_steps, step_ids, restart, platform_id, platform_name, _seen, _kind, _photographed, _issues, _difference}` + `.to_dict()` (drops `_`-prefixed and falsy)
  - `async decide_guidance(db, tenant_id, res: LocateResult, *, content_mode, policy=None, session_flow_id=None, session_goal_id=None, snapshots=None) -> Guidance`
  - `phrase_guidance(g, policy=None) -> Guidance`
  - `async locate_guidance(db, tenant_id, res, *, content_mode, theme="light", session_flow_id=None, session_goal_id=None, goal_noun=None, policy=None, snapshots=None) -> Guidance` (decide then phrase)
  - `assistant_profile(settings) -> dict`
- **`policy.py`** — all wording/tone/behaviour lives here, nothing in the engines.
  `POLICY_KEY="policy"`, `LEGACY_KEY="assistant"`; enums `DELIVERY=("all_at_once","one_by_one")`, `ON_AMBIGUOUS=("ask","best_guess")`, `ON_OFF_FLOW=("restart","ask_goal","handoff")`, `ON_NOT_APP_SCREEN=("restart","ask_platform","handoff")`, `ON_UNKNOWN_PLATFORM=("ask_platform","handoff")`, `ON_UNREADABLE=("retake","handoff")`; `DEFAULTS: dict`, `_ENUMS`, `TEMPLATES: dict[str, dict[str,str]]` (built-in zh-TW and en sets), `LANGUAGE_NAMES` (zh-TW, zh-CN, en, ja, vi, id, …); `class Policy` (with `Policy.from_settings(settings)`, `.text(key, **kw)`, `.to_dict()`, `.locate_threshold`, `.locate_low`, `.noun`, `.goal_noun`); `class _Safe(dict)` for missing `{placeholders}`.
- **`publish.py`** — draft/publish lifecycle: `unfinished_steps(steps, reachable)`, `async validate_flow(db, flow_id) -> dict`, `async publish_flow(db, flow_id, user_id) -> FlowVersion`, `async rollback_flow(db, flow_id, version_id) -> FlowVersion`, `async unpublish_flow(db, flow_id)`. Only the *light* variant must be completed; dark is optional.
- **`stepcard.py`** — the Step Card HTML generator.
  `LIMITS = {"title":12,"instruction":40,"label":30}`; `TYPE_COLOR = {"tap":"#2f6fed","capture":"#f59e0b","input":"#10b981","gesture":"#8b5cf6","note":"#6b7280"}`; `PALETTE`; `DEFAULT_ROWS=5`; `GRID=8`; `DEFAULT_MASK={"enabled":False,"opacity":0.4,"pad":6,"radius":12,"blur":0}`; `ICON_DIR = Path(__file__).with_name("stepcard_icons")` (`capture.svg`, `input.svg`, `note.svg`, `tap.svg`); `GESTURE_T=28`, `GESTURE_DEFAULT_LEN=64`; `POINT_SIZE={"tap":(48,48),"input":(200,40)}`.
  Public: `default_layout(replica_w, replica_h, channel="mobile_app") -> dict`, `focus_boxes(annotations, fw, fh, pad=0)`, `layout_vars(layout, replica_w) -> dict[str,str]`, `build_card_html(*, replica_html, replica_w, replica_h, annotations, title, instruction, theme, layout, step_number) -> (html, card_width)`.
- **`content.py`** — flow snapshots (published = frozen `FlowVersion`, draft = built live for Playground only).
  `build_snapshot(db, flow_id, *, strict=True)`, `load_snapshot(db, tenant_id, flow_id, content_mode)`, `find_flow(db, tenant_id, platform_id, goal_id, content_mode)`, `tenant_catalog(db, tenant_id, content_mode="published") -> (platforms, goals, flows)`, `card_url(card)`, `card_preview_url(card)`, `snapshot_step`, `snapshot_start`, `outgoing`, `step_goal`, `snapshot_goals`, `goal_name`, `goals_below(snapshot) -> dict[str,set[str]]`, `relevant_edges(snapshot, step_id, goal_id, below=None)`, `walk(snapshot, goal_id=None, start_id=None)`, `straight_from(snapshot, step_id, goal_id=None)`, `flow_goal_ids(steps)`.
- **`assets.py`** — private objects owned by variants. `PURGE_FAILED_MESSAGE`, `class AssetPurgeError(RuntimeError)`, `private_objects(v) -> list[(bucket,key)]`, `async purge_variant_assets(variants)`, `variants_of_step/flow/platform(db, id)`. Rule: objects are deleted *before* rows.
- **`card_context.py`** — everything a Step Card render needs besides the replica.
  `TENANT_LAYOUT_KEY = "stepcard_layout"`; `@dataclass CardContext` (tenant_id, title, instruction, layout, number, …); `valid_template(layout, what)`, `valid_patch(patch)`, `merge_layout(template, patch)`, `tenant_layout(tenant, channel)`, `resolve_layouts(v, tenant, channel) -> (template, patch, merged, default)`, `async load_card_context(db, v) -> CardContext`.
- **`numbered_card.py`** — per-conversation card numbering. `LINE_PREVIEW_EDGE = 240`; regexes `_NUM = --step-num:"\d*"`, `_WIDTH = --canvas-w:(\d+)px`; `html_key_for(card_key)`, `numbered_keys(card_key, n) -> (png_key, preview_key)`, `with_step_number(html, n)`, `async numbered_card(card: dict, n: int) -> dict` (falls back to the base card on any failure).
- **`demo_data.py`** — deliberately dependency-free (no models/schemas). `SHARED, NEW = "shared","new"`; `KEY_RE = ^[a-z][a-z0-9_]*$`; `key_from(label, taken)`, `annotate(rows, demo_data) -> list[dict]`, `unreviewed_count(rows)`, `merge(demo_data, picks)`, `value_changes(report, picks)`, `regenerate_feedback(picks)`.

---

## 8. `app/ai/*`

- **`llm.py`**
  ```python
  async def structured_call(task: str, schema: type[T], system: str, text: str,
                            images: list[bytes] | None = None, *,
                            tenant_id: str | None = None, ref_type: str = "",
                            ref_id: str = "", fake_context: dict | None = None
                            ) -> tuple[T, dict]:   # (parsed_output, usage_record)
  ```
  Behaviour: opens OTel `span(f"llm.{task}", task, provider, images=len)`. If `llm_provider == "fake"` → `fake.respond(task, schema, text, images, fake_context or {})`, synthesises a usage dict (`len(text)//3 + 800*len(images)` input tokens), records usage, returns. Otherwise: `model_name = settings.model_for(task)`; `_chat_model(model_name).with_structured_output(schema, include_raw=True)`; content list is `[{"type":"text",...}]` then every image as `image_url` data URL with `detail:"high"` — **images last so the cacheable prefix stays stable**; `ainvoke([SystemMessage(system), HumanMessage(content)])`; any exception → `ModelError(f"{task}: {e}")`; missing `parsed` → `ModelError`; usage read from `raw.usage_metadata`; span gets `tokens.input/output/cached`.
  Also: `class ModelError(Exception)`; `@lru_cache _chat_model(model, *, responses_api=False)` (OpenAI via `init_chat_model`, `use_responses_api` for the assistant's function tools); `@lru_cache _embeddings()`; `async record_usage(task, model, usage, latency_ms, tenant_id, ref_type="", ref_id="") -> dict` (cost = `((inp-cached)*price_input + cached*price_cached + out*price_output)/1e6`, written to `llm_usage`, failures only logged); `async embed(text) -> list[float]` (falls back to `fake.embed` when provider is fake or no key); `dumps(obj)`.
- **`fake.py`** — deterministic stand-ins for `LLM_PROVIDER=fake`. `embed(text, dim)` (character-bigram hashing, L2-normalised), `_img_hash(data)` (32×32 grayscale pixel hash, not PNG bytes), `respond(task, schema, text, images, ctx) -> BaseModel` (branches on `schema is StructureAnalysis / ReplicaOutput / StyleDocAI / ScreenshotDescription / RerankResult / IntentResult / VisualReview`), `_fake_intent(text, ctx)`, `_call(name, args, text="")`, `assistant_reply(messages, catalog) -> AIMessage` (fake tool-calling transcript).
- **`retrieval.py`** — the screenshot ladder. Outcomes: `LOCATED, AMBIGUOUS, OFF_FLOW, UNKNOWN_PLATFORM, NOT_APP_SCREEN, NOT_A_SCREENSHOT, UNREADABLE` + tuple `OUTCOMES`. `_SYSTEM_KINDS=("home_screen","lock_screen","system_screen")`, `_POOL=12`, `_PRIOR_STEPS=3`.
  `@dataclass LocateResult{ok, outcome, step_id, flow_id, variant_id, platform_id, platform_guess, confidence, theme, scope, reason, relation, difference, kind, photographed, quality_issues, candidates, screen, description, usage}` + `.public()`.
  ```python
  async def locate(db, tenant_id, png: bytes, *, flow_id, platform_id,
                   content_mode="published", session_id="", flow_version_id=None,
                   step_id=None, goal_id=None, snapshot=None,
                   threshold=None, low=None) -> LocateResult
  ```
  One shrink per turn shared by describe + rerank; `release_connection(db)` before model calls.
  `decide(result, *, threshold, low, platform_known) -> str` — order: confident same-screen → LOCATED; `kind=="unreadable"` → UNREADABLE; `"not_a_screen"` → NOT_A_SCREENSHOT; system kinds → NOT_APP_SCREEN; above `low` → AMBIGUOUS; `same_app_other_screen` or platform known → OFF_FLOW; else UNKNOWN_PLATFORM.
  Also `_published_entries`, `_scored_entries` (pgvector cosine), `lexical_scores(query_terms, entries)`, `fuse(entries, lexical, *, prior=None, k=5)` (reciprocal-rank fusion), `step_prior(snapshot, step_id, goal_id)`, `_platform_by_name`, `_fetch_replica`.
  **Intent parsing lives in `services/guide.resolve_intent` + `ai/agents.parse_intent`, not here.**
- **`agents.py`** — the model tasks (task names line up with `model_<task>` settings): `shrink(data, max_edge=None)`, `description_text(d, platform_name="", theme="")`, `screen_keywords(d, secrets=None)`, `styledoc_text(ai, human_notes, platform_name)`, `analyze_structure(...)`, `generate_replica(...)`, `update_style_doc(...)`, `describe_screenshot(png, *, tenant_id, ref_id="", shrunk=False)`, `rerank(citizen_png, candidates, *, tenant_id, ref_id="", ...)`, `parse_intent(text, platforms, goals, known_context, *, tenant_id, ref_id="")`, `visual_review(original, replica_png, *, tenant_id, variant_id)`.
- **`session_graph.py`** — deterministic Session API engine, a LangGraph graph; one turn = one invocation.
  `SessionState(TypedDict, total=False)`; `PERSISTED_KEYS` = every state key except `event/response/debug`; `MODEL_FAILURE_MESSAGE`; `TurnContext` + `_ctx()` / `_policy()` (contextvars); `_reply(state, response, debug=None)` (single exit for every node); `match_option(options, text)`; `class SessionStore` (`key`, `save`, `load`, `delete` — Redis, session TTL, self-serialised); `class SessionLock` (short Redis lock per session); nodes `handle_start`, `handle_text`, `handle_screenshot`, `handle_action` with `route(state)`; helpers `_snapshot`, `_escalation`, `_clarify`, `_card_for`, `_step_response`, `_goal_label`, `_completed_response`, `_start_flow`, `_resolve_flow`, `_ask_platform`, `_ask_channel`, `_ask_goal`, `_after_intent`, `_run_intent`, `_apply_option`, `_switch_flow_if_needed`, `_move_to`, `_count_drift`; `build_session_graph()`, `graph()`; `class SessionEngine(db)` with `start(tenant_id, external_user_hash, *, hint, known_context, theme, source)`, `handle(tenant_id, session_id, event, screenshot=None)`, `status(tenant_id, session_id)`, `_turn`, `_public_state`.
  **Screenshots travel through the run `config`, never through state** — they can never be persisted.
- **`ingestion_graph.py`** — variant pipeline. Flow (from the module docstring): `analyze → generate → safety_check → (render → check → [visual_check] → mark_pending) → review(interrupt) → finalize`. A `revalue` review skips `generate` and goes straight to `safety_check`.
  `IngestState(TypedDict, total=False)`; `_set(variant_id, **fields)`; **`transition(variant_id, from_statuses: tuple[str,...], **values) -> bool`** (the conditional-write primitive used everywhere); `_original(variant_id)`; nodes `analyze`, `generate`, `safety_check`, `reject_unsafe`, `render`, `check`, `visual_check`, `mark_pending`, `review` (returns `Command[Literal["finalize","generate","safety_check"]]`), `finalize`; routers `route_after_safety`, `route_after_check`, `route_after_visual`; `_swap_values`, `_platform_context`, `refresh_style_doc(platform_id, tenant_id, variant_id)`, `build_graph()`, `platform_context(db, platform)`, `initial_state(variant_id)`.
- **`assistant.py`** — 虛擬客服 tool-calling agent (Playground + `/v1/chat`).
  `MODEL_FAILURE_TEXT`, `HISTORY_LIMIT = 24`, `SCREENSHOT_NOTE = "（民眾附上一張截圖）"`.
  `system_prompt(tenant_name, platforms, goals, flows, policy=None)`, `greeting(platforms, goals, policy=None)`; `@dataclass ChatState` (+`to_json`/`from_json`); `class ChatStore` (Redis `key/save/load`); `class ChatTurn` with `snapshot`, `say`, and **four tools**: `get_flow_steps(flow_id, goal_id=None)`, `send_step_cards(flow_id, step_ids)`, `locate_screenshot()`, `ask_choice(question, options)` — returned from `tools()`; `answer_without_model()` is the deterministic fallback when the model is unavailable.
  `class ChatEngine(db, tenant_name="", tenant_settings=None)` with `policy_for`, `start(tenant_id, *, content_mode="published", source="playground", ...)`, `status`, `handle(tenant_id, chat_id, text, screenshot)`, `_turn`, `_model_call`. Screenshot lives only in the turn context; it never enters the Redis transcript nor the assistant model.
- **`tracing.py`** — `setup()` (idempotent; `TracerProvider` with `service.name`; adds an OTLP **HTTP** exporter at `<endpoint>/v1/traces` only when `otel_exporter_otlp_endpoint` is set) and `@contextmanager span(name, **attrs)`. Spans carry metadata only, never prompts or images.
- **`schemas.py`** — structured-output models: `UIElement`, `DataRegion`, `FocusMapping`, `StructureAnalysis`, `FakeDatum`, `ReplicaOutput`, `StyleDocAI`, `ScreenshotDescription`, `RerankResult`, `IntentResult`, `VisualReview`; `SCREEN_KINDS = ("app_screen","web_page","home_screen","lock_screen","system_screen","not_a_screen","unreadable")`.
- **`checks.py`** — `unsafe_html_problems(html)` (static safety, runs before the renderer and on admin-edited HTML), `check_replica(html, *, structure, focus_boxes, kept_texts, …)`, `demo_data_problems`, `component_problems`, `normalize_component_html`, `scrub_pii(structure, check_report)`, `needs_scrub`, `focus_area(boxes)`. Constants `BLOCKED_TAGS`, `URL_ATTRS`, `SAFE_DATA_IMAGE`, `UNSAFE_CSS`, `SCRIPT_SCHEME`, `EXTERNAL_URL`, `REDACTED="＊＊＊"`, `COMPONENT_REQUIRED_BY = {"tab_bar":"has_tab_bar","nav_bar":"has_nav_bar","header":"has_nav_bar"}`.
- **`prompts.py`** — `STRUCTURE_SYSTEM`, `REPLICA_SYSTEM` (appended with `_load_example()` reading `app/ai/examples/esun_mockup.html`), `STYLEDOC_SYSTEM`, `DESCRIBE_SYSTEM`, `RERANK_SYSTEM`, `VISUAL_REVIEW_SYSTEM`, `INTENT_SYSTEM`, `KIND_LABEL`, plus builders `demo_data_section(fields)`, `notes_section(notes)`, `components_section(components, width)`.
- **`html_text.py`** — `replace_texts(html, changes) -> (html, missed)`; used for `revalue` reviews so a wording fix costs no model call.
- **`image_utils.py`** — `InvalidImage`, `ImageTooLarge`, `load`, `dimensions`, `shrink_for_model(data, max_edge=None)`, `to_data_url`, `make_preview(data, max_edge=240)`, `to_png`, `async read_image_upload(file, max_bytes=None)`.

---

## 9. `app/worker/`

**`worker/main.py`** — entrypoint `arq app.worker.main.WorkerSettings`.
```python
async def startup(ctx): setup_tracing(); storage.ensure_buckets()

class WorkerSettings:
    functions = [process_variant, resume_variant, render_stepcard,
                 func(run_eval, timeout=EVAL_JOB_TIMEOUT_SECONDS)]
    cron_jobs = [cron(sweep_stale_jobs, minute=set(range(0, 60, 10))),   # every 10 min
                 cron(cleanup_originals, minute={5})]                     # hourly at :05
    on_startup = startup
    redis_settings = jobs.redis_settings()
    job_serializer = staticmethod(job_serializer)      # JSON, not pickle
    job_deserializer = staticmethod(job_deserializer)
    max_jobs = 4
    job_timeout = 900
    keep_result = 3600
```

**`worker/tasks.py`** — constants `EVAL_JOB_TIMEOUT_SECONDS = 2*60*60`, `EVAL_CONCURRENCY = 3`, `ORPHAN_MIN_AGE = 1h`, `THUMB_EDGE = 800`, `RESUME_PROGRESS = {"approve":"審核通過，整理中","revalue":"更新畫面上的假資料"}`.
- `async process_variant(ctx, variant_id) -> str` — new `thread_id = f"{variant_id}:{uuid4().hex[:8]}"`, deletes the previous thread's checkpoint (it holds verbatim screen text), runs `build_graph().compile(checkpointer=AsyncPostgresSaver.from_conn_string(database_url_sync))` until the review interrupt. Returns `"no-variant" | "no-original" | "paused-for-review"`.
- `async resume_variant(ctx, variant_id, decision, feedback, user_id, changes=None) -> str` — resumes with `Command(resume={"decision","feedback","changes"})`; on `approve` also `_drop_thread_after_approval`.
- `async render_stepcard(ctx, variant_id) -> str` — loads the card context, builds card HTML, calls `render_html(card_html, card_w, scale=2)`, stores PNG under `cards/{tenant}` (content-hashed), the page itself privately (`html_key_for(key)`), a LINE preview under `previews/{tenant}` and a canvas thumb; final write is conditional (`transition(..., ("rendering",), …, status="completed")`), returns `key` or `"superseded"`/`"skipped"`.
- `async run_eval(ctx, run_id)` / `_run_eval` / `_eval_case` / `_save_eval` / `_eval_summary` — one DB session per case, `Semaphore(3)`, results persisted incrementally; summary has `cases, platform_accuracy, step_accuracy, intent_platform_accuracy, intent_goal_accuracy, avg_latency_ms, total_cost_usd, total_tokens`.
- **cron** `sweep_stale_jobs(ctx) -> dict` — rows older than `stale_job_minutes` in a job-owned state go back to something actionable: `processing→failed`, `approved→annotating`, `rendering→annotating`, running `EvalRun`s older than `max(stale_job_minutes, EVAL_JOB_TIMEOUT+600s)` → `failed`.
- **cron** `cleanup_originals(ctx) -> dict{expired, orphans, scrubbed}` — (1) originals past `original_ttl_days` in `uploaded/focusing/failed` are deleted then the key cleared; (2) objects under `originals/` referenced by no row and older than 1 h are deleted; (3) `scrub_pii` on variants that no longer have an original.
- Failure discipline: `_error_text(e)` (CancelledError → `"處理逾時或被中斷，請重新送出"`), `_on_failure(coro)` uses `asyncio.shield` so bookkeeping survives cancellation, `_mark_failed` falls back `approved→annotating` when the approval already committed.

---

## 10. Infrastructure modules

- **`storage.py`** — MinIO, synchronous (call through `asyncio.to_thread`). `@lru_cache client()`, `@lru_cache fernet()` (raises in production without `ORIGINAL_ENCRYPTION_KEY`; in dev derives `urlsafe_b64(sha256("orig:"+secret_key))` so api and worker agree), `ensure_buckets()`, `put/get/delete/exists/list_objects(bucket, …)`, `ORIGINALS_PREFIX = "originals/"`, `put_original/get_original/delete_original` (Fernet-encrypted), `put_private/get_private/delete_private`, `put_sealed/get_sealed` (encrypted, for eval images), `put_public_hashed(prefix, data, ext, content_type)` (content-addressed key), `thumb_key_for(card_key)`, `get_public(key)`, `public_url(key)` (prefixes `public_media_base_url`).
- **`redis_client.py`** — 8 lines: `@lru_cache redis() -> aioredis.Redis` from `redis_url`, `decode_responses=False`.
- **`renderer_client.py`** — exceptions `RendererError`, `RendererTimeout`, `RendererRejected`, `RendererUnavailable`; `_raise_for_status` maps 504→Timeout, 401/403→Rejected(token), 4xx→Rejected, 502/503→Unavailable, 5xx→Error. `async render_html(html, width, scale=2, full_page=True, timeout=60.0) -> (png, css_w, css_h)` (sends `X-Renderer-Token`), `async extract_element(html, width, rect, attrs=None, …)`.
- **`jobs.py`** — **JSON job serialisation, not pickle** (`job_serializer`/`job_deserializer`), `redis_settings()` = `RedisSettings.from_dsn(redis_url)`, module-level `pool()` (`create_pool`), `async enqueue(name, *args, **kwargs) -> str|None`.
- **`events.py`** — `async log_event(db, tenant_id, session_id, event_type, *, flow_id=None, step_id=None, payload=None, source="api")` → one `EventLog` row + commit. Never stores screenshots or identifying data.
- **`dag.py`** — `paths_from_start(edges, start_id) -> set[str]`, `step_number(edges, start_id, step_id) -> int|None` (1-based **longest** path; None if unreachable or cyclic), `_has_cycle`, `validate_dag(step_ids, edges, start_ids, end_ids) -> list[str]`.
- **`errors.py`** — `class ApiError(HTTPException)` with `detail={"code","message"}`; codes `PLATFORM_NOT_FOUND, FLOW_NOT_FOUND, FLOW_NOT_PUBLISHED, SCREENSHOT_UNRECOGNIZED, CLARIFICATION_LIMIT, SESSION_EXPIRED, RATE_LIMITED, MODEL_FAILURE, INVALID_ACTION, IMAGE_TOO_LARGE, IMAGE_INVALID, SESSION_BUSY, SCREEN_OFF_FLOW, SCREEN_NOT_APP, SCREEN_NOT_SCREENSHOT, SCREEN_UNREADABLE, PLATFORM_UNKNOWN`.

---

## 11. Alembic

**`backend/alembic/env.py`** — the DB URL is taken from settings, not `alembic.ini`:
```python
config.set_main_option("sqlalchemy.url",
    get_settings().database_url_sync.replace("postgresql://", "postgresql+psycopg://", 1))
```
Imports `app.db.Base` and `app.models` (registration), `target_metadata = Base.metadata`. Standard offline/online runners; online uses `engine_from_config(..., poolclass=pool.NullPool)`. `prepend_sys_path = .` in `alembic.ini` makes `app` importable, so migrations must be run from `backend/`. The api image runs `alembic upgrade head` in its CMD.

Migrations (linear chain 0001 → 0010):

| rev | file | one line |
|---|---|---|
| 0001 | `0001_init.py` | Explicit DDL for the v1 schema (was `metadata.create_all`); imports `pgvector.sqlalchemy.Vector`. |
| 0002 | `0002_password_changed_at.py` | Adds `users.password_changed_at`; guarantees the two HNSW vector indexes (`VECTOR_INDEXES = (("ix_variants_embedding","variants"),("ix_style_docs_embedding","style_docs"))`). |
| 0003 | `0003_stepcard_layout.py` | Adds `variants.stepcard_layout`. |
| 0004 | `0004_platform_demo_data.py` | Adds `platforms.demo_data`. |
| 0005 | `0005_platform_components.py` | Creates the `platform_components` table. |
| 0006 | `0006_variant_prompt_notes.py` | Adds `variants.prompt_notes`. |
| 0007 | `0007_step_goals.py` | Goals move from flows to end steps (`steps.goal_id`); data migration. |
| 0008 | `0008_variant_fake_data_reviewed.py` | Adds `variants.fake_data_reviewed`. |
| 0009 | `0009_variant_keywords.py` | Adds `variants.keywords` — the screen's own words for hybrid retrieval (backfills via `json`). |
| 0010 | `0010_snapshot_media_keys.py` | Rewrites published snapshots to store object **keys** instead of absolute media URLs (uses `json`, `re`, `urlsplit`). |

---

## 12. Tests

**`backend/tests/conftest.py` is 4 lines** — environment only, **no fixtures, no DB, no aiosqlite engine**:
```python
import os
os.environ.setdefault("LLM_PROVIDER", "fake")
os.environ.setdefault("SECRET_KEY", "test-secret")
os.environ.setdefault("PUBLIC_MEDIA_BASE_URL", "http://m")
```
Consequences for the port: the whole suite is **pure unit tests** — no database is started, no `TestClient`/`httpx.ASGITransport` app fixture, no auth-header helper. `aiosqlite` is in the dev extras and in `requirements.txt` but is never used by any test (grep confirms zero references). Fake-LLM behaviour comes from the env var above, not a fixture. Only three test modules define fixtures at all: `test_snapshot_media.py:19`, `test_assistant.py:79,84`, `test_extract_renderer.py:29,34`. `tests/__init__.py` is empty but present (tests import each other, e.g. `from tests.test_assistant import MULTI_SNAPSHOT`). Async tests rely on `asyncio_mode = "auto"`.

| file | tests | one line |
|---|---|---|
| `test_ai_session.py` | 6 | Session engine helpers with no Redis/DB: `PERSISTED_KEYS`, `_reply`, `match_option`. |
| `test_api_auth.py` | 4 | JWT create/decode, password hashing/verify, `token_predates_password_change`, `login_rate_key`, `last_used_is_stale`. |
| `test_api_guards.py` | 11 | Role gates and request-model validation (`HTTPException`, pydantic `ValidationError`). |
| `test_api_variant_views.py` | 6 | The privacy serializers: `can_see_original_data`, `public_structure`, `redact_check_report`, `variant_summary`, `original_version`. |
| `test_assistant.py` | 17 | 虛擬客服 tool loop against the fake model; content and side effects stubbed at the module boundary. Exports `MULTI_SNAPSHOT`. |
| `test_card_context.py` | 3 | `merge_layout` / `resolve_layouts` / `TENANT_LAYOUT_KEY` against `default_layout`. |
| `test_checks.py` | 14 | `check_replica` and `focus_area` over a fixed `STRUCT`. |
| `test_dag.py` | 7 | `validate_dag`, `paths_from_start`, `step_number`. |
| `test_extract_renderer.py` | 5 | Integration against the renderer's `/extract`; **whole module skipped** when `docker compose up -d renderer` is not reachable. |
| `test_fake_and_security.py` | 5 | `ai.fake` output shapes + api-key/password primitives. |
| `test_fake_data_sync.py` | 24 | 假資料同步: sorting a report into 沿用/新增 and folding picks into 示範資料. |
| `test_goal_branches.py` | 5 | Multi-goal flows read as one straight line per document; snapshot compat shims. |
| `test_guide_retrieval.py` | 15 | Guidance layer + retrieval ladder without a DB: scoring, fusion, `decide`, per-outcome actions. |
| `test_numbered_card.py` | 5 | `numbered_card` helpers against `build_card_html` / `default_layout`. |
| `test_platform_context.py` | 26 | 平台脈絡: 示範資料 persona + shared component library — prompt sections, checks, offline wiring. |
| `test_snapshot_media.py` | 8 | Snapshots store object keys; moving the media domain reaches already-published flows. |
| `test_stepcard.py` | 14 | `build_card_html`, `default_layout`, `focus_boxes`, `layout_vars`, `GRID`. |
| `test_worker_failures.py` | 4 | Jobs leave rows actionable on any exit including `asyncio.CancelledError`; DB writes replaced with recorders. |

---

## 13. `backend/renderer/main.py`

FastAPI app, `docs_url=None, redoc_url=None, openapi_url=None`. Env: `ENV`, `RENDERER_TOKEN`, `RENDERER_MAX_HTML_BYTES` (default 3 MiB), `RENDERER_MAX_PAGE_HEIGHT` (12000 css px), `RENDERER_TIMEOUT_SECONDS` (45), `RENDERER_CONCURRENCY` (4), `RENDERER_MAX_SNIPPET_CHARS` (200000). `MAX_BODY_BYTES = 2*MAX_HTML_BYTES + 64KiB`. Refuses to start when `ENV=production` and `RENDERER_TOKEN` is empty.

**Auth**: an `@app.middleware("http")` named `guard` — every path except `/health` requires `hmac.compare_digest(header "x-renderer-token", TOKEN)` when `TOKEN` is set → 401 `{"detail":"invalid renderer token"}`; also 413 if `Content-Length` > `MAX_BODY_BYTES`.

Endpoints:
- `GET /health` — unauthenticated; relaunches the browser if needed; 503 `{"ok":false,"browser":"disconnected"}` or `{"ok":true}`.
- `POST /render` — body `RenderIn{html(min 1), width 200..2400 default 390, scale 1..3 default 2, full_page=True, height 1..4000 default 100}`. Returns raw PNG with headers `x-css-width`, `x-css-height`. 413 html too large, 422 page too tall, 504 timeout, 503 browser disconnected.
- `POST /extract` — body `ExtractIn{html, width, rect: ExtractRect{x,y,w,h as 0..1 fractions}, scale, attrs: dict[str,str]}` with a validator limiting `attrs` to ≤8 entries matching `^data-[a-z][a-z0-9-]{0,30}$` / `^[A-Za-z0-9_-]{1,64}$`. Returns `{html, x, y, w, h, tag, thumb_png_base64}`.

Hardening: contexts run `java_script_enabled=False`, `service_workers="block"`, `accept_downloads=False`; `context.route("**/*", _allow_only_inline)` aborts everything except `data:` and `about:blank` (top-level navigations get a 204 so `<meta refresh>` cannot commit); Chromium launched with `--proxy-server=http://127.0.0.1:9`, `--host-resolver-rules=MAP * ~NOTFOUND`, `--no-sandbox`, `--disable-dev-shm-usage`, etc.; `asyncio.Semaphore(CONCURRENCY)` permits; every context closed in `finally` via `_close_quietly`.
`backend/renderer/extract_js.py` holds `CHOOSE_JS` (smallest ancestor covering ≥90% of the rectangle) and `SERIALIZE_JS` (inlines differing computed styles, drops any property containing `url(`).

---

## 14. `backend/scripts/e2e_smoke.py`

Runs the whole pipeline against a live stack. `BASE = argv[1] | $SOP_BASE_URL | http://localhost:8000`; reads images from `<repo>/../UImockup` (`ESUN_UI.png`, `Cathay_UI.png`); writes cards to `$SOP_E2E_OUT` (default `/tmp`); password `$SOP_E2E_PASSWORD` default `pass1234-demo`.

Exercises, in order: `bootstrap-status` → `bootstrap` or `login` → `me`; create goals + 3 platforms; get `/api/canvas`; create flow, steps (one `is_end` with `goal_id`) and an edge; `validate`; then per step — upload original, fetch `original.png`, PUT focus boxes, `process`, poll to `pending_review`, check `/api/review/queue`, adopt 假資料 via `/fake-data` and verify it landed in the platform's `demo_data`, `review {decision:"regenerate"}` → poll → `review {decision:"approve"}` → poll to `annotating`, PUT four annotations (tap/capture/input/gesture), `render-card`, poll to `completed`, fetch the public `stepcard_url`; then style-doc, `validate`, `publish`, `versions`; then the **public API** with a freshly created API key — `/v1/catalog/platforms`, `/v1/sessions` + `next`/`next`, an ambiguous-channel session + `choose_option`, `/v1/sessions/{id}/screenshots` locate, `/v1/sessions/{id}` status, and a bad-key 401 check; then `/api/playground/sessions` with `_debug`; then an eval case + run polled to `done`; then `/api/dashboard/summary`. Prints `ALL OK`.

---

## 15. Frontend config

**`frontend/package.json`** — `"type":"module"`, private, v0.0.0.
Scripts: `dev: vite`, `build: tsc -b && vite build`, `lint: oxlint`, `preview: vite preview`.
Dependencies: `@tailwindcss/vite ^4.3.3`, `@tanstack/react-query ^5.103.0`, `clsx ^2.1.1`, `lucide-react ^1.46.0`, `react ^19.2.8`, `react-dom ^19.2.8`, `react-router-dom ^7.18.4`, `tailwindcss ^4.3.3`.
devDependencies: `@types/node ^24.13.3`, `@types/react ^19.2.18`, `@types/react-dom ^19.2.7`, `@vitejs/plugin-react ^6.1.1`, `oxlint ^1.81.0`, `typescript ~6.0.2`, `vite ^8.3.0`.

**`vite.config.ts`** — plugins `react()`, `tailwindcss()`; `const API = process.env.API_URL || 'http://localhost:8000'`; server `port: Number(process.env.PORT) || 5173`, `strictPort: false`, proxy (regex keys): `'^/api/': API`, `'^/v1/': API`, `'^/media/': API`.

**tsconfig** — project references: `tsconfig.json` (`files: []`, refs to app+node). `tsconfig.app.json`: `target/lib es2023`, `module esnext`, `moduleResolution bundler`, `types:["vite/client"]`, `jsx react-jsx`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `noEmit`, `noUnusedLocals/Parameters`, `noFallthroughCasesInSwitch`, `allowArbitraryExtensions`, `skipLibCheck`, `include:["src"]`. `tsconfig.node.json`: same lint flags, `module nodenext`, `types:["node"]`, `include:["vite.config.ts"]`.

**Tailwind v4**, configured entirely in CSS — no `tailwind.config.js`. `src/index.css` starts with `@import "tailwindcss";` then `@variant dark (&:where(.dark, .dark *));` then an `@theme { … }` block mapping Tailwind color names to CSS variables. Dark mode is class-based on `<html>` (`localStorage['theme']`).

**`index.css` CSS variable names**

`@theme` bridge tokens (Tailwind utility names): `--color-primary`, `--color-muted`, `--color-secondary`, `--color-tertiary`, `--color-elevated`, `--color-border`, `--color-background`, `--color-background-lite`, `--color-canvas`, `--color-accent`, `--color-accent-bg`, `--color-danger`, `--color-danger-bg`, `--color-good`, `--color-good-bg`, `--color-warn`, `--color-warn-bg`, `--color-on-accent`, `--color-scrim`, `--shadow-control`, `--font-mono`, `--font-sans`.

`:root` raw tokens (slate series, carried over from the ChillJudge canvas): `--primary`, `--muted`, `--secondary`, `--tertiary`, `--elevated`, `--border`, `--background`, `--background-lite`, `--canvas`, `--accent`, `--accent-bg`, `--on-accent`, `--scrim`, `--scrim-strong`, `--sh-control`, `--danger`, `--danger-bg`, `--shadow-float`, `--shadow-card`, `--shadow-lift`, `--shadow-sheet`, `--shadow-menu`, `--shadow-popover`, `--ease-out`, `--ease-pop`, `--pg-good`, `--pg-good-bg`, `--pg-warn`, `--pg-warn-bg`, `--pg-grid`, `--ann-tap`, `--ann-capture`, `--ann-input`, `--ann-gesture`, `--ann-note`, `--fb-keep`, `--fb-data`, `--fb-block`.

`.dark` overrides: `--primary, --muted, --secondary, --tertiary, --elevated, --border, --background, --background-lite, --canvas, --accent, --accent-bg, --fb-block, --on-accent, --scrim, --scrim-strong, --sh-control, --danger, --danger-bg, --shadow-float, --shadow-card, --shadow-lift, --shadow-sheet, --shadow-menu, --shadow-popover, --pg-good, --pg-good-bg, --pg-warn`.

Also in `index.css`: an `@layer base` block (100%-height html/body/#root, body typography, and an extensive cursor-restoration ruleset undoing Tailwind v4 preflight), and named animations/utilities `pg-nodepop`, `spin`, `pg-menupop`, `pg-sheetin`, `pg-fadein`, `pg-shimmer`, `pg-skeleton`, `pg-working-img` / `pg-breathe`, `pg-reveal`, `pg-ring`, `pg-panelin`, `pg-risein`, `pg-dropin`, `pg-scalein`, plus a `prefers-reduced-motion` block.

`index.html`: `<html lang="zh-Hant">`, title `SOP Tutor 後台`, `#root`, `/src/main.tsx`. (`public/favicon.svg` and `public/icons.svg` exist but `index.html` links neither.)

**`.oxlintrc.json`**: plugins `["react","typescript","oxc"]`; rules `react/rules-of-hooks: error`, `react/only-export-components: ["warn",{allowConstantExport:true}]`.

---

## 16. `frontend/src/` tree

### Entry / shell / router
- **`src/main.tsx`** — `createRoot` → `StrictMode > QueryClientProvider > BrowserRouter > AuthProvider > App`. `QueryClient` defaults `{retry:1, refetchOnWindowFocus:false, staleTime:5000}`. Applies `.dark` on `<html>` from `localStorage['theme']` before render.
- **`src/App.tsx`** — **the router**. `<ToastProvider>` wraps `<Routes>`: `/login` public; everything else under `<Route element={<RequireAuth><AppShell/></RequireAuth>}>` → index redirects to `/canvas`, then `/canvas`, `/review`, `/playground`, `/evals`, `/dashboard`, `/members`, `/api-keys`; legacy `/platforms` and `/goals` redirect to `/canvas`; `*` redirects to `/canvas`.
- **`src/layout/AppShell.tsx`** — **AppShell**: collapsible left sidebar (`localStorage['sop_nav_collapsed']`), `NAV` array `[{/canvas 流程 Workflow}, {/review 審核}, {/playground 測試對話}, {/evals 評測}, {/dashboard 儀表板}, {/members 成員 admin:true}, {/api-keys API Key admin:true}]` filtered by `atLeast('admin')`, dark-mode toggle writing `localStorage['theme']`, logout, `<Outlet/>` in `<main>`.

### `src/lib/` — the API client layer
- **`src/lib/api.ts`** — **the api client module**. `class ApiError extends Error {status, detail}`; token in `localStorage['sop_token']` via `getToken()` / `setToken()`; `detailMessage(body)` unwraps FastAPI `detail` (string, pydantic error array, or `{errors:[…]}`).
  `apiFetch(path, init)` — raw `Response`, injects `Authorization: Bearer <token>`; on 401, **only** logs out if the failing token is still the current one and the path is not `/api/auth/login`, then `window.dispatchEvent(new Event('sop:logout'))`.
  `ensureOk(res)` throws `ApiError`. `api<T>(path, {json?, form?})` sets `Content-Type: application/json` for `json`, passes `FormData` untouched, parses the text body as JSON when possible.
  Verb helpers: `get`, `post`, `put`, `patch`, `del`, and `upload<T>(path, file, extra = {}, method = 'POST')` (builds `FormData` with `file` plus string fields).
  There is **no base URL** — every path is root-relative and resolved by the Vite proxy in dev / nginx in prod.
- **`src/lib/auth.tsx`** — `RANK = {viewer:0, reviewer:1, editor:2, admin:3, owner:4}`; `AuthProvider` (loads `/api/auth/me` on mount, listens for `sop:logout`), `useAuth()`, `RequireAuth`. Context: `{user, loading, login(email,password), logout(), atLeast(role), can('edit'|'review'|'admin'), refresh()}`.
- **`src/lib/types.ts`** — mirrors `backend/app/schemas.py`: `Role`, `User`, `Tenant`, `ApiKey`, `Goal`, `Channel`, `DemoDataField`, `FakeDatum`, `FakeDataPick`, `Platform`, `ComponentKind`, `PlatformComponent`, `StyleDoc`, `FlowStatus`, `Flow`, `VariantStatus`, `Theme`, `VariantSummary`, `Step`, `Edge`, `CanvasData`, `LayoutItem`, `UnfinishedStep`, `Validation`, `RenderCards`, `FlowVersion`, `FocusBoxType`, `FocusBox`, `AnnotationType`, `Annotation`, `Variant`, `LayoutFrame`, `LayoutText`, `LayoutMask`, `StepCardLayout`, `LayoutBlock`, `LayoutPatch`, `CardPreview`, `ReviewQueueItem`, `EvalCase`, `EvalRun`, `StepResponse`, `ClarificationResponse`, `EscalationResponse`, `CompletedResponse`, `SessionResponse`, `DashboardSummary`, `ChatTurnMessage`, `ChatToolCall`, `TenantPolicy`, `TenantPolicyResponse`, `ChatLocateGuidance`, `ChatLocateCandidate`, `ChatLocateDebug`, `ChatTurnDebug`, `ChatTurnResponse`; label maps `ROLE_LABEL`, `CHANNEL_LABEL`, `COMPONENT_KIND_LABEL`, `ANNOTATION_LABEL`, `ANNOTATION_COLOR`.
- **`src/lib/hooks.ts`** — `useCanvas()` (`['canvas']`, **polls every 3 s only while some variant is busy**), `usePlatforms()`, `useGoals()`, `useInvalidate()`.
- **`src/lib/keys.ts`** — keyboard helpers shared by text inputs and shortcut handlers.

### `src/canvas/` — the canvas editor
- **`CanvasEditor.tsx`** (588 lines) — **the canvas editor entry**: the canvas is the whole screen; floating switcher top-left, 發布 top-right, toolbar bottom-centre, step panel right, selection bar above the selected card.
- `FlowCanvas.tsx` (509) — the canvas surface: one flow's steps + connectors on a dotted grid; panning writes the world transform directly, bypassing React.
- `EdgeLayer.tsx` — bezier connectors with arrowheads plus the live drag preview.
- `StepCard.tsx` — one step on the canvas; visual language per state.
- `StepPanel.tsx` — floating panel for the single selected step.
- `SelectionBar.tsx` — floating action bar above the selection.
- `Toolbar.tsx` — bottom toolbar (add step, import screenshots, arrange, zoom).
- `TopBar.tsx` (210) — platform/flow switcher menus + 發布 + version menu.
- `GuideBar.tsx` — the five-stage bottom guide bar with the next action.
- `Workspace.tsx` (183) — the right-hand sheet walking a screenshot through 截圖與重點 → 審核 → 標註與產出.
- `Dialogs.tsx` (388) — 平台設定 (4 tabs), 新增平台, 新增流程.
- `ImportDialog.tsx` — multi-screenshot import with natural-sort ordering.
- `ContextMenu.tsx` — `MenuItem`, `MenuState`, `useContextMenu()`, `ContextMenu`.
- `actions.ts` — editor mutations that write results straight into the `['canvas']` cache.
- `arrange.ts` — 整理排列 left-to-right layout by longest path from start.
- `context.tsx` — editor context provider (viewport passed as props, not context).
- `fields.tsx` — quiet inspector inputs that save on blur/Enter.
- `geometry.ts` — boxes, bezier face routing, fit/focus/zoom/screen→world.
- `guide.ts` — the five stages and their done/next-action state.
- `keys.ts` — keyboard ownership rules for the canvas.
- `model.ts` — scene model for one open flow.
- `status.ts` — **single source of truth for variant status** (`STATUS` table, `isBusy`, stage/word/button/pictures).
- `structure.ts` — local mirror of `dag.py`'s publish checks.
- `useCanvasView.ts` — pan/zoom + fit-to-content viewport hook.
- `useInlineEdit.ts` — one inline-edit behaviour for every text field.
- `useLayoutSaver.ts` — debounced `PUT /api/canvas/layout` with save generations.

### `src/components/`
- **`ui.tsx`** (258) — the shared UI kit (also exports `ToastProvider`).
- `ai/AIStatus.tsx` — the one component used everywhere a job runs.
- **`variant/`** — the **variant components** (three sheet stages + tools):
  `CaptureStage.tsx` (stage 1 截圖與重點), `ReviewStage.tsx` (stage 2 審核), `AnnotateStage.tsx` (stage 3 標註與產出), `BoxEditor.tsx` (generic image+overlay editor shared by focus boxes and annotations, fractional coords), `LayoutEditor.tsx` (Step Card layout editor — loads the worker's own page in an iframe and rewrites only CSS custom properties), `FakeDataSync.tsx` (假資料同步), `SaveComponent.tsx` (存為元件), `AdvancedHtmlModal.tsx` (admin-only replica HTML editing), `GestureGlyph.tsx` (the swipe glyph shared by editor and card), `hooks.ts` (data hooks for the three stages), `parts.tsx` (shared building blocks).
- `platform/PlatformParts.tsx` — 示範資料 + 共用區塊 editors.
- `playground/` — `ChatRoom.tsx` (pure-presentation transcript+composer, intended to become the public web widget), `TurnInspector.tsx` (per-turn tool calls / screenshot read / model rounds / usage), `types.ts`.
- `evals/` — `CaseForm.tsx`, `CaseGrid.tsx`, `RunsTable.tsx`, `lookup.ts`, `queries.ts`.
- `admin/` — `ApiUsageGuide.tsx` (mirrors SPEC §8 and `public_api.py`), `TagInput.tsx`, `shared.tsx`.

### `src/pages/` — 8 pages
`LoginPage.tsx`, `CanvasPage.tsx` (wraps `CanvasEditor`), `ReviewQueuePage.tsx`, `PlaygroundPage.tsx` (311), `EvalsPage.tsx`, `DashboardPage.tsx` (270, inline-SVG trend chart), `MembersPage.tsx`, `ApiKeysPage.tsx`.

### Assets
`src/assets/hero.png`, `src/assets/vite.svg`, `public/favicon.svg`, `public/icons.svg`.

---

## 17. Frontend tests

**There are none.** No `vitest`, `jest`, `@testing-library`, no `*.test.*` / `*.spec.*` files, no `test` script in `package.json`, no `setupTests`. The documented frontend check is `npx tsc -b` (must be zero errors) plus `oxlint`. If the monorepo wants frontend tests, they must be introduced from scratch.

---

## 18. Docker

### `docker/api.Dockerfile`
`FROM python:3.12-slim` → `WORKDIR /app` → `ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1` → apt `libpq5` + `useradd --uid 10001 app` → `COPY backend/requirements.txt .` → `pip install -r requirements.txt` → `COPY backend/ .` → `USER app`, `ENV HOME=/home/app` → `EXPOSE 8000` → `CMD sh -c "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"`. Code stays root-owned (read-only to the runtime user). **Build context is the repo root**, not `backend/`.

### `docker/worker.Dockerfile`
Identical base/layers to the api image; no `EXPOSE`; `CMD ["arq", "app.worker.main.WorkerSettings"]`.

### `docker/renderer.Dockerfile`
`FROM mcr.microsoft.com/playwright/python:v1.63.0-noble` → apt `fonts-noto-cjk fonts-noto-cjk-extra fonts-noto-color-emoji` + `fc-cache -f` → `COPY backend/renderer/requirements.txt .` → `pip install -r requirements.txt` → `COPY backend/renderer/main.py backend/renderer/extract_js.py ./` → `USER pwuser` → `EXPOSE 8100` → `CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8100"]`. Playwright version must stay in lockstep with the base image tag.

### `docker/web.Dockerfile`
Multi-stage. Stage `build`: `node:24-alpine`, `COPY frontend/package*.json`, `npm ci`, `COPY frontend/ .`, `npm run build`. Stage 2: `nginx:1.27-alpine`, `COPY docker/nginx.conf /etc/nginx/conf.d/default.conf`, `COPY --from=build /app/dist /usr/share/nginx/html`, `EXPOSE 80`.

Each Dockerfile has a matching `*.Dockerfile.dockerignore` (all four are byte-identical): excludes `.git`, `**/.env`, `**/.env.*` (keeping `.env.example`), `**/.venv`, `**/node_modules`, `**/__pycache__`, `**/*.pyc`, `**/.pytest_cache`, `**/.DS_Store`, `.claude`, `frontend/dist`, `UImockup`.

### `docker-compose.yml`
`name: sop-tutor`. Anchors: `x-restart: &restart {restart: unless-stopped}` and `x-backend-env: &backend-env` (shared by `api` and `worker`) with `ENV, DATABASE_URL, DATABASE_URL_SYNC, REDIS_URL, S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, RENDERER_URL=http://renderer:8100, RENDERER_TOKEN, PUBLIC_MEDIA_BASE_URL, SECRET_KEY, ORIGINAL_ENCRYPTION_KEY, LLM_PROVIDER, OPENAI_API_KEY, OPENAI_BASE_URL, DEFAULT_MODEL, MODEL_REPLICA, MODEL_STRUCTURE, MODEL_STYLEDOC, MODEL_DESCRIBE, MODEL_RERANK, MODEL_INTENT, REPLICA_VISUAL_REVIEW, VISUAL_REVIEW_MIN_SCORE, EMBEDDING_MODEL, SESSION_TTL_SECONDS, ORIGINAL_TTL_DAYS, LOCATE_CONFIDENCE_THRESHOLD, OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318, BOOTSTRAP_*, CORS_ORIGINS`. Note `MODEL_ASSISTANT` is **not** passed through.

| service | image / build | ports | notes |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:0.8.6-pg17` | `127.0.0.1:5432:5432` | user/db `sop`; volume `pgdata`; `pg_isready` healthcheck |
| `redis` | `redis:8.10.1-alpine` | `127.0.0.1:6379:6379` | `--save 60 1 --appendonly no`, `--requirepass` only when `REDIS_PASSWORD` set (passed via env, never interpolated); volume `redisdata` |
| `minio` | `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` | `127.0.0.1:9000:9000`, `127.0.0.1:9001:9001` | `server /data --console-address ":9001"`; volume `miniodata`; `mc ready local` healthcheck |
| `renderer` | build `docker/renderer.Dockerfile` | `127.0.0.1:8100:8100` | `init: true` (reaps Chromium children); env `ENV`, `RENDERER_TOKEN`; python urllib healthcheck on `/health` |
| `otel-collector` | `otel/opentelemetry-collector-contrib:0.161.0` | none published | mounts `./docker/otel-collector.yaml` read-only |
| `api` | build `docker/api.Dockerfile` | `127.0.0.1:8000:8000` | `*backend-env`; depends on postgres/redis/minio healthy |
| `worker` | build `docker/worker.Dockerfile` | none | `*backend-env`; depends on api started + renderer healthy |
| `web` | build `docker/web.Dockerfile` | **`8080:80`** — the only port published on all interfaces | depends on api |

Volumes: `pgdata`, `redisdata`, `miniodata`.

`docker/otel-collector.yaml`: OTLP receivers on `0.0.0.0:4318` (http) and `:4317` (grpc), `batch` processor, `debug` exporter with `verbosity: basic` — traces go nowhere but the log.

### `docker/nginx.conf`
`proxy_cache_path /var/cache/nginx/media levels=1:2 keys_zone=media:10m max_size=1g inactive=30d use_temp_path=off;`; `upstream sop_api { server api:8000; keepalive 16; }`; `server { listen 80; server_tokens off; }`.
Body limits (uploads must never touch disk): `client_max_body_size 25m`, `client_body_buffer_size 25m`, `client_body_timeout 30s`, `client_header_timeout 15s`, `send_timeout 60s`, `keepalive_timeout 30s`.
Security headers on every location: `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `X-Frame-Options DENY`, `Content-Security-Policy "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"`.
Proxy defaults: HTTP/1.1, `Connection ""`, `Host`, `X-Real-IP`, `X-Forwarded-For $remote_addr` (**overwritten, never trusting a client chain**), `X-Forwarded-Proto`, `proxy_connect_timeout 5s`.
Locations: `/api/` and `/v1/` → `sop_api` with `proxy_request_buffering off`, send 60s / read 120s; `/media/` → `sop_api` with `limit_except GET HEAD { deny all; }`, `proxy_cache media`, `proxy_cache_key $uri`, `valid 200 30d`, `cache_lock on`, `use_stale error timeout updating`, Set-Cookie ignored and hidden; `= /health` → api, read 10s; `/assets/` → static, `expires max`, `try_files $uri =404`; `/` → static SPA, `expires -1`, `try_files $uri /index.html`.

---

## 19. `docker-compose.prod.yml` — answer

**It does not exist, and nothing mentions it.**
- `ls` of the repo root shows exactly one compose file: `docker-compose.yml`.
- `grep -rn "docker-compose" README.md SPEC.md CLAUDE.md frontend/README.md` returns a **single** hit: `CLAUDE.md:13` — “`docker/`、`docker-compose.yml` 一鍵部署（postgres+pgvector、redis、minio、renderer、api、worker、web、otel）”.
- `README.md` §部署 and `SPEC.md` §13 both describe deployment as the *same* single compose file, differentiated only by environment variables: `ENV=production` makes `check_settings()` and the renderer refuse to start on insecure defaults. There is no prod overlay, no `--profile`, no separate prod nginx.

So if the monorepo wants a prod compose overlay, it is new work, not a port.

---

## 20. Porting gotchas worth flagging

1. **Docker build contexts are the repo root**, and all four Dockerfiles `COPY backend/…` / `COPY frontend/…`. Moving `backend/` or `frontend/` under a monorepo subdirectory breaks every `COPY` path, the four `.dockerignore` files, and `docker-compose.yml`'s `build.context: .`.
2. **`alembic.ini` uses `prepend_sys_path = .`** and `env.py` does `from app.config import get_settings` — migrations only work with CWD = `backend/`. The api container relies on this (`WORKDIR /app`, `COPY backend/ .`).
3. **No ruff/mypy config exists.** Adding them at monorepo level will surface a lot at once.
4. **`conftest.py` has no fixtures** — there is no integration test harness to port, and `aiosqlite` is dead weight.
5. **`MultiPartParser.spool_max_size` is set at import time in `main.py`**, before `create_app()`. Any refactor that moves app construction must keep that assignment at module import, or uploads start hitting disk (a documented hard privacy rule).
6. **`MODEL_ASSISTANT` and `ASSISTANT_MAX_TOOL_ROUNDS` exist in `Settings` but are not in `docker-compose.yml`'s `x-backend-env` or `.env.example`** — they can only be set in a deployment by editing compose.
7. `renderer` pins Playwright twice (image tag + `requirements.txt`); they must move together.
8. `scripts/e2e_smoke.py` reads `<repo>/../UImockup` via `pathlib.Path(__file__).resolve().parents[2] / "UImockup"` — a path that depends on the current directory depth and will break on a move.