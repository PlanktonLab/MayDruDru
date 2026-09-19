"""Application settings. Everything is injected through environment variables
(see .env.example at the repo root)."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_SECRET_KEY = "change-me-please"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "MayDru"
    env: str = "dev"  # dev | production — production refuses insecure defaults at startup
    secret_key: str = DEFAULT_SECRET_KEY
    jwt_expire_minutes: int = 60 * 12

    database_url: str = "postgresql+asyncpg://maydru:maydru@localhost:5432/maydru"
    database_url_sync: str = "postgresql://maydru:maydru@localhost:5432/maydru"
    redis_url: str = "redis://localhost:6379/0"

    # object storage (S3 compatible)
    s3_endpoint: str = "localhost:9000"
    # Browser-facing endpoint used only when creating presigned download URLs.
    # Docker services talk to `minio:9000`, but a clerk's browser cannot resolve
    # that internal hostname.
    s3_public_endpoint: str = ""
    # The browser-facing endpoint may use TLS even when the internal Docker
    # endpoint (`minio:9000`) does not.
    s3_public_secure: bool | None = None
    # MinIO's default bucket region. Supplying it lets a client sign URLs for
    # the browser-facing endpoint without attempting to connect to that host.
    s3_region: str = "us-east-1"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_secure: bool = False
    s3_bucket_private: str = "maydru-private"   # originals (encrypted), replicas, eval images
    s3_bucket_public: str = "maydru-public"     # step cards (content-hashed keys)
    public_media_base_url: str = "http://localhost:8000/media"
    original_encryption_key: str = ""        # Fernet key; generated at startup if empty (dev only)
    # Separate Fernet key for citizen PII at rest (phone / ID last-4 hashes, contact
    # details). Kept apart from ORIGINAL_ENCRYPTION_KEY so officer originals and
    # citizen PII can be rotated independently (SPEC §11).
    pii_encryption_key: str = ""

    renderer_url: str = "http://localhost:8100"
    renderer_token: str = ""                 # shared secret sent as X-Renderer-Token; required in production

    # request limits
    max_upload_bytes: int = 20 * 1024 * 1024
    max_image_pixels: int = 40_000_000       # decoded pixels; guards against decompression bombs
    login_attempts_per_minute: int = 10      # per client IP + email

    # retention / thresholds
    session_ttl_seconds: int = 60 * 60 * 24
    original_ttl_days: int = 7
    locate_confidence_threshold: float = 0.6
    locate_low_confidence: float = 0.35   # below this a best guess is not even worth asking about
    intent_confidence_threshold: float = 0.7
    max_clarifications: int = 3
    max_generation_attempts: int = 3
    stale_job_minutes: int = 45              # a variant/eval stuck longer than this is marked failed
    replica_visual_review: bool = True
    visual_review_min_score: float = 0.85
    focus_box_area_limit: float = 0.6  # fraction of the screenshot
    retrieval_top_k: int = 5

    # LLM
    llm_provider: str = "openai"  # openai | fake
    openai_api_key: str = ""
    openai_base_url: str = ""
    default_model: str = "gpt-5.6-luna"
    model_structure: str = ""
    model_replica: str = "gpt-5.6-sol"
    model_styledoc: str = ""
    model_describe: str = ""
    model_rerank: str = ""
    model_intent: str = ""
    model_assistant: str = ""          # Playground 虛擬客服 (tool calling)
    assistant_max_tool_rounds: int = 6   # model → tools → model … per chat turn
    embedding_model: str = "text-embedding-3-small"
    embedding_dim: int = 1536
    llm_timeout_seconds: float = 180.0
    llm_max_retries: int = 2
    # LINE 只等幾秒就判定逾時並重送整批事件，所以意圖分類不能用 llm_timeout_seconds
    # 那種「跑圖片分析用」的上限（SPEC §9 紅線 6：模型慢了要能立刻落回規則式分類）。
    line_intent_timeout_seconds: float = 8.0
    image_max_edge: int = 1500
    # USD per 1M tokens, used for cost estimates on the dashboard
    price_input_per_m: float = 1.25
    price_cached_input_per_m: float = 0.125
    price_output_per_m: float = 10.0

    # LINE channel (SPEC §8) — the bot is a channel of this API, not a separate service.
    # line_sender: noop never touches the network (tests, local dev); line uses the real Messaging API.
    line_sender: str = "noop"  # noop | line
    line_channel_secret: str = ""
    line_channel_access_token: str = ""

    # public front-ends; used to build links inside LINE messages and CORS defaults
    apply_web_base_url: str = "http://localhost:5174"
    admin_web_base_url: str = "http://localhost:5173"

    # tracing
    otel_exporter_otlp_endpoint: str = ""
    otel_service_name: str = "maydru"

    # bootstrap (dev convenience): create tenant + owner at first start when set
    bootstrap_tenant_name: str = ""
    bootstrap_owner_email: str = ""
    bootstrap_owner_password: str = ""

    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:5173",  # admin-web dev
            "http://localhost:5174",  # apply-web dev
            "http://localhost:8201",  # admin-web container
            "http://localhost:8202",  # apply-web container
        ]
    )

    def model_for(self, task: str) -> str:
        return getattr(self, f"model_{task}", "") or self.default_model

    @property
    def is_production(self) -> bool:
        return self.env.lower() in ("prod", "production")

    def insecure_defaults(self) -> list[str]:
        """Settings that are fine on a laptop but must never reach a deployment."""
        problems = []
        if self.secret_key in (DEFAULT_SECRET_KEY, "") or len(self.secret_key) < 32:
            problems.append("SECRET_KEY 未設定或過短（至少 32 字元）")
        if not self.original_encryption_key:
            problems.append("ORIGINAL_ENCRYPTION_KEY 未設定")
        if not self.pii_encryption_key:
            problems.append("PII_ENCRYPTION_KEY 未設定")
        if self.s3_access_key == "minioadmin" or self.s3_secret_key == "minioadmin":
            problems.append("S3/MinIO 仍使用預設帳密")
        if not self.renderer_token:
            problems.append("RENDERER_TOKEN 未設定")
        if self.bootstrap_owner_password and len(self.bootstrap_owner_password) < 12:
            problems.append("BOOTSTRAP_OWNER_PASSWORD 過短（至少 12 字元）")
        if self.line_sender == "line" and not (self.line_channel_secret and self.line_channel_access_token):
            problems.append("LINE_SENDER=line 但 LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN 未設定")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
