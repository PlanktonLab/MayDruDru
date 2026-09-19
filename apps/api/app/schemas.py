"""Pydantic request / response models for the admin API."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, create_model, field_validator

from .models import ROLES
from .security import PASSWORD_MIN_LENGTH

Role = Literal[ROLES]
Password = Field(min_length=PASSWORD_MIN_LENGTH, max_length=200)

# ------------------------------------------------------------------ auth

class LoginIn(BaseModel):
    email: str
    password: str
    tenant_slug: str | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    tenant_id: str
    email: str
    name: str
    role: str
    is_active: bool = True
    created_at: datetime | None = None


class BootstrapIn(BaseModel):
    tenant_name: str = Field(min_length=1, max_length=200)
    tenant_slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    owner_email: EmailStr
    owner_password: str = Password
    owner_name: str = "Owner"


class TenantOut(BaseModel):
    id: str
    name: str
    slug: str
    settings: dict = {}


class MemberIn(BaseModel):
    email: EmailStr
    name: str = Field(default="", max_length=120)
    role: Role = "viewer"
    password: str = Password


class MemberPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=PASSWORD_MIN_LENGTH, max_length=200)

    @field_validator("password", mode="before")
    @classmethod
    def _blank_is_unchanged(cls, v):
        return v or None


class ApiKeyIn(BaseModel):
    name: str
    rate_limit_per_minute: int = 120


class ApiKeyOut(BaseModel):
    id: str
    name: str
    prefix: str
    status: str
    rate_limit_per_minute: int
    last_used_at: datetime | None
    created_at: datetime
    plaintext: str | None = None


class ApiKeyPatch(BaseModel):
    name: str | None = None
    status: Literal["active", "disabled"] | None = None
    rate_limit_per_minute: int | None = None


# ------------------------------------------------------------------ content

class GoalIn(BaseModel):
    name: str
    description: str = ""
    aliases: list[str] = []


class GoalOut(GoalIn):
    id: str


# ---- 示範資料 (SPEC §6.5): the persona every replica of a platform shows

DEMO_DATA_MAX_FIELDS = 20
DEMO_DATA_MAX_VALUE = 60
# Fields are whatever the platform needs (a tax office and a bank share none):
# `key` is an opaque id the form generates, `label` is the name people see.


class DemoDataField(BaseModel):
    """A value the clerk typed for this platform. Whatever they typed is what
    the replica shows, verbatim — there is no second kind of value (a `real`
    flag existed until v0.7; nobody could tell what it meant, and a value you
    typed yourself is by definition the one you want on the page)."""
    key: str = Field(min_length=1, max_length=40, pattern=r"^[a-z][a-z0-9_]*$")
    label: str = Field(min_length=1, max_length=40)
    value: str = Field(default="", max_length=DEMO_DATA_MAX_VALUE)


def _validated_demo_data(fields: list[DemoDataField] | None) -> list[DemoDataField] | None:
    if fields is None:
        return None
    if len(fields) > DEMO_DATA_MAX_FIELDS:
        raise ValueError(f"示範資料最多 {DEMO_DATA_MAX_FIELDS} 個欄位")
    keys = [f.key for f in fields]
    if len(set(keys)) != len(keys):
        raise ValueError("示範資料的 key 不可重複")
    return fields


# ---- 假資料同步 (SPEC §6.5): the clerk's answer to what a replica reported


class FakeDataPick(BaseModel):
    """One value kept from a replica's 假資料清單. With `key` it rewrites that
    示範資料 field (a shared value was corrected); without one it becomes a new
    field, so the rest of the batch stops inventing its own."""
    key: str = Field(default="", max_length=40)
    label: str = Field(min_length=1, max_length=40)
    value: str = Field(default="", max_length=DEMO_DATA_MAX_VALUE)
    # what the replica currently shows for this field, so a correction can be
    # swapped into the page instead of costing a whole redraw
    replaces: str = Field(default="", max_length=DEMO_DATA_MAX_VALUE)


class FakeDataSyncIn(BaseModel):
    adopt: list[FakeDataPick] = []
    # redraw this screen with the values above before anyone approves it
    regenerate: bool = False


class PlatformIn(BaseModel):
    display_name: str
    brand: str
    channel: Literal["mobile_app", "web", "desktop"] = "mobile_app"
    category: str = ""
    aliases: list[str] = []
    demo_data: list[DemoDataField] = []

    @field_validator("demo_data")
    @classmethod
    def _check_demo_data(cls, v):
        return _validated_demo_data(v)


class PlatformPatch(BaseModel):
    display_name: str | None = None
    brand: str | None = None
    channel: Literal["mobile_app", "web", "desktop"] | None = None
    category: str | None = None
    aliases: list[str] | None = None
    demo_data: list[DemoDataField] | None = None

    @field_validator("demo_data")
    @classmethod
    def _check_demo_data(cls, v):
        return _validated_demo_data(v)


class StyleDocOut(BaseModel):
    id: str
    platform_id: str
    ai_generated: dict
    human_notes: str
    version: int
    has_embedding: bool
    updated_at: datetime


class StyleDocPatch(BaseModel):
    human_notes: str


class PlatformOut(BaseModel):
    id: str
    display_name: str
    brand: str
    channel: str
    category: str
    aliases: list[str]
    demo_data: list[DemoDataField] = []
    style_doc_version: int = 0
    flow_count: int = 0
    component_count: int = 0


# ---- 平台元件庫 (SPEC §6.5)

class ComponentRect(BaseModel):
    """The reviewer's rectangle on the replica, as fractions of the rendered page."""
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


COMPONENT_KINDS = Literal["nav_bar", "tab_bar", "header", "footer", "other"]


class ComponentIn(BaseModel):
    rect: ComponentRect
    name: str = Field(min_length=1, max_length=80)
    kind: COMPONENT_KINDS = "other"


class ComponentPatch(BaseModel):
    """Rename or re-type a stored component; the snippet itself never changes."""
    name: str | None = Field(default=None, min_length=1, max_length=80)
    kind: COMPONENT_KINDS | None = None


class ComponentOut(BaseModel):
    id: str
    platform_id: str
    name: str
    kind: str
    width: int
    height: int
    thumb_url: str | None
    created_by: str | None
    created_at: datetime


class FlowIn(BaseModel):
    platform_id: str
    name: str


class FlowPatch(BaseModel):
    name: str | None = None


class StepIn(BaseModel):
    flow_id: str
    title: str = "新步驟"
    instruction: str = ""
    stuck_hint: str = ""
    canvas_x: float = 0
    canvas_y: float = 0
    is_start: bool = False
    is_end: bool = False
    goal_id: str | None = None


class StepPatch(BaseModel):
    title: str | None = None
    instruction: str | None = None
    stuck_hint: str | None = None
    canvas_x: float | None = None
    canvas_y: float | None = None
    is_start: bool | None = None
    is_end: bool | None = None
    # null clears it (the field must be present to count — see patch_step)
    goal_id: str | None = None


class StepDuplicateIn(BaseModel):
    target_flow_id: str
    canvas_x: float | None = None
    canvas_y: float | None = None


class EdgeIn(BaseModel):
    flow_id: str
    from_step_id: str
    to_step_id: str
    condition_label: str = ""
    sort_order: int = 0


class EdgePatch(BaseModel):
    condition_label: str | None = None
    sort_order: int | None = None


class VariantSummary(BaseModel):
    id: str
    theme: str
    status: str
    progress: str = ""
    error: str = ""
    has_original: bool = False
    original_version: str | None = None
    replica_png_url: str | None = None
    replica_version: str | None = None
    stepcard_url: str | None = None
    stepcard_preview_url: str | None = None
    stepcard_thumb_url: str | None = None
    drift_count: int = 0
    attempts: int = 0


class StepOut(BaseModel):
    id: str
    flow_id: str
    title: str
    instruction: str
    stuck_hint: str
    canvas_x: float
    canvas_y: float
    is_start: bool
    is_end: bool
    goal_id: str | None = None
    drift_count: int
    variants: list[VariantSummary] = []


class EdgeOut(BaseModel):
    id: str
    flow_id: str
    from_step_id: str
    to_step_id: str
    condition_label: str
    sort_order: int


class FlowOut(BaseModel):
    id: str
    platform_id: str
    # the documents its 終點 steps deliver, in canvas order
    goal_ids: list[str] = []
    name: str
    status: str
    current_version_id: str | None
    current_version: int | None = None
    drift_count: int
    updated_at: datetime


class CanvasOut(BaseModel):
    platforms: list[PlatformOut]
    goals: list[GoalOut]
    flows: list[FlowOut]
    steps: list[StepOut]
    edges: list[EdgeOut]


class LayoutItem(BaseModel):
    """A step position. Extra keys (e.g. the old `kind`) are ignored."""
    id: str
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)


class LayoutIn(BaseModel):
    items: list[LayoutItem]


class RenderCardsOut(BaseModel):
    """A whole flow sent to the card renderer: how many steps were queued, how many had nothing to render yet."""
    queued: int
    skipped: int


class UnfinishedStep(BaseModel):
    step_id: str
    theme: str


class ValidationOut(BaseModel):
    ok: bool
    errors: list[str]
    publishable: bool
    publish_errors: list[str]
    unfinished: list[UnfinishedStep] = []


class FlowVersionOut(BaseModel):
    id: str
    version: int
    created_at: datetime
    published_by: str | None
    step_count: int


# ------------------------------------------------------------------ variants

class FocusBox(BaseModel):
    id: str
    type: Literal["keep_text", "data_region", "block"]
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)
    note: str = ""


class FocusBoxesIn(BaseModel):
    boxes: list[FocusBox]
    """承辦人員給 AI 的補充說明，隨 Focus Box 一起存；None 表示不更動。"""
    prompt_notes: str | None = Field(default=None, max_length=1000)


class Annotation(BaseModel):
    id: str
    type: Literal["tap", "capture", "input", "gesture", "note"]
    number: int
    label: str = Field(max_length=60)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(ge=0, le=1, default=0)
    h: float = Field(ge=0, le=1, default=0)
    example_text: str = ""
    direction: Literal["up", "down", "left", "right", "long_press", ""] = ""


class AnnotationsIn(BaseModel):
    annotations: list[Annotation]


class ReviewIn(BaseModel):
    decision: Literal["approve", "regenerate"]
    feedback: str = ""


class AdvancedEditIn(BaseModel):
    html: str


# ------------------------------------------------------------------ step card layout (SPEC §9.1)

class LayoutCanvas(BaseModel):
    w: int = Field(ge=400, le=2400)  # the renderer's page width limit
    h: int = Field(ge=300, le=4000)
    margin: int = Field(default=64, ge=0, le=600)  # safe margin the editor draws and snaps to


class LayoutFrame(BaseModel):
    """The frame is a window on the replica: `x`/`y` place it, `w`/`h` size the
    window in canvas px (`h` 0: the replica's own height at this scale, so a
    template carries over to replicas of another height), `zoom` and `ox`/`oy`
    (replica px) move the replica behind it.

    `align`/`valign` place the window by rule instead of by `x`/`y` — on the
    canvas's safe margin or its centre line. Screenshots differ in height, so
    a fixed `y` would put every step's window somewhere else; a rule keeps
    them all in the same place, and the text group anchored to the window
    follows it."""

    x: int = Field(ge=-2000, le=4000)
    y: int = Field(ge=-2000, le=6000)
    w: int = Field(ge=40, le=4000)
    h: int = Field(default=0, ge=0, le=6000)
    zoom: float = Field(default=1.0, ge=1.0, le=3.0)
    ox: int = Field(default=0, ge=-8000, le=8000)
    oy: int = Field(default=0, ge=-8000, le=8000)
    align: Literal["free", "left", "center", "right"] = "free"
    valign: Literal["free", "top", "middle", "bottom"] = "free"


class LayoutText(BaseModel):
    """The text group — title, then the annotation list — placed as one block.
    `valign` is where it sits vertically: at its own `y` (`free`, the Apple
    poster way: every step's title at the same spot), or with its top,
    middle or bottom on the frame's. `align` is the group's axis: everything
    on one left edge, or the title centred and the list — as wide as its
    widest row, rows left-aligned — centred under it."""

    x: int = Field(ge=-2000, le=4000)
    y: int = Field(ge=-2000, le=6000)
    w: int = Field(ge=40, le=4000)
    align: Literal["left", "center"] = "left"
    valign: Literal["free", "top", "middle", "bottom"] = "free"
    gap: int = Field(default=48, ge=0, le=600)  # between the title block and the list


class LayoutTitle(BaseModel):
    size: int = Field(ge=12, le=400)
    number: bool = True
    gap: int = Field(default=0, ge=-200, le=400)  # between the step number and the title


class LayoutList(BaseModel):
    size: int = Field(ge=8, le=300)
    icon: int = Field(ge=8, le=400)
    gap: int = Field(ge=0, le=400)  # between rows


class LayoutMask(BaseModel):
    """Dim everything but the annotated regions."""

    enabled: bool = False
    opacity: float = Field(default=0.4, ge=0.0, le=0.7)
    pad: int = Field(default=6, ge=0, le=400)      # replica px around each region
    radius: int = Field(default=12, ge=0, le=200)
    blur: int = Field(default=0, ge=0, le=40)      # blur (replica px) on the dimmed area; 0 is plain dimming


LAYOUT_VERSION = 2  # layouts stored before this shape are ignored, not converted


class StepCardLayout(BaseModel):
    """A complete layout: the tenant's template for a channel, or the built-in one."""

    v: Literal[2]  # required: a layout stored before this shape is dropped, not converted
    canvas: LayoutCanvas
    frame: LayoutFrame
    text: LayoutText
    title: LayoutTitle
    list: LayoutList
    mask: LayoutMask = LayoutMask()


def _partial(model: type[BaseModel], name: str) -> type[BaseModel]:
    """The same fields, all optional: what a step stores over the template."""
    fields = {}
    for n, f in model.model_fields.items():
        typ = Annotated[f.annotation, *f.metadata] if f.metadata else f.annotation  # keep ge/le
        fields[n] = (Optional[typ], None)  # noqa: UP007
    return create_model(name, __config__=ConfigDict(extra="ignore"), **fields)  # type: ignore[call-overload]


LayoutCanvasPatch = _partial(LayoutCanvas, "LayoutCanvasPatch")
LayoutFramePatch = _partial(LayoutFrame, "LayoutFramePatch")
LayoutTextPatch = _partial(LayoutText, "LayoutTextPatch")
LayoutTitlePatch = _partial(LayoutTitle, "LayoutTitlePatch")
LayoutListPatch = _partial(LayoutList, "LayoutListPatch")
LayoutMaskPatch = _partial(LayoutMask, "LayoutMaskPatch")


class StepCardLayoutPatch(BaseModel):
    """What one step changes about its template — only the keys it touched,
    so later template edits still reach everything it left alone."""

    v: Literal[2]  # required, so a layout from before this shape never passes as a partial one
    canvas: LayoutCanvasPatch | None = None  # type: ignore[valid-type]
    frame: LayoutFramePatch | None = None  # type: ignore[valid-type]
    text: LayoutTextPatch | None = None  # type: ignore[valid-type]
    title: LayoutTitlePatch | None = None  # type: ignore[valid-type]
    list: LayoutListPatch | None = None  # type: ignore[valid-type]
    mask: LayoutMaskPatch | None = None  # type: ignore[valid-type]

    def sparse(self) -> dict:
        """Only the keys that were set; an empty dict means "follows the template"."""
        blocks = {k: v for k, v in self.model_dump(exclude_none=True).items() if k != "v" and v}
        return {"v": LAYOUT_VERSION, **blocks} if blocks else {}


class StepCardLayoutIn(BaseModel):
    patch: StepCardLayoutPatch | None = None  # None or empty: the step follows the template


class TenantLayoutIn(BaseModel):
    channel: Literal["mobile_app", "web"]
    layout: StepCardLayout | None = None  # None goes back to the built-in default


class CardPreviewIn(BaseModel):
    annotations: list[Annotation] | None = None  # unsaved edits; the stored ones otherwise
    template: StepCardLayout | None = None       # an unsaved template; the tenant's (or the built-in) otherwise
    patch: StepCardLayoutPatch | None = None     # unsaved step changes; the stored ones otherwise


class CardPreviewOut(BaseModel):
    html: str
    channel: str
    replica_w: int
    replica_h: int
    layout: StepCardLayout       # what the page was drawn with (template + patch)
    template: StepCardLayout     # the tenant's, or the built-in one
    patch: dict                  # this step's stored changes ({} when it follows the template)
    built_in: StepCardLayout


class VariantOut(BaseModel):
    id: str
    step_id: str
    theme: str
    status: str
    progress: str
    error: str
    attempts: int
    has_original: bool
    original_version: str | None
    original_width: int
    original_height: int
    focus_boxes: list[dict]
    prompt_notes: str
    structure: dict | None
    replica_png_url: str | None
    replica_version: str | None
    replica_width: int
    replica_height: int
    kept_texts: list
    fake_data: list
    fake_data_reviewed: bool
    check_report: dict | None
    review_history: list
    annotations: list[dict]
    stepcard_url: str | None
    stepcard_preview_url: str | None
    stepcard_thumb_url: str | None
    stepcard_layout: dict | None
    description: str
    drift_count: int
    updated_at: datetime


# ------------------------------------------------------------------ evals

class EvalCaseOut(BaseModel):
    id: str
    platform_id: str
    step_id: str | None
    goal_id: str | None
    text: str
    note: str
    image_url: str
    created_at: datetime


class EvalRunOut(BaseModel):
    id: str
    status: str
    label: str
    config: dict
    summary: dict
    results: list
    started_at: datetime
    finished_at: datetime | None


class EvalRunIn(BaseModel):
    label: str = ""
    content_mode: Literal["published", "draft"] = "draft"


# ------------------------------------------------------------------ playground

class PolicyIn(BaseModel):
    """客服策略 (SPEC §8.1): voice, behaviour and wording of the citizen-facing
    engines. Empty strings mean "use the built-in for the language"."""
    language: str = Field(default="zh-TW", max_length=10)
    name: str = Field(default="", max_length=40)
    tone: str = Field(default="", max_length=200)
    goal_noun: str = Field(default="", max_length=20)
    extra_rules: str = Field(default="", max_length=2000)
    handoff_message: str = Field(default="", max_length=300)
    delivery: Literal["all_at_once", "one_by_one"] = "all_at_once"
    on_ambiguous: Literal["ask", "best_guess"] = "ask"
    on_off_flow: Literal["restart", "ask_goal", "handoff"] = "restart"
    on_not_app_screen: Literal["restart", "ask_platform", "handoff"] = "restart"
    on_unknown_platform: Literal["ask_platform", "handoff"] = "ask_platform"
    on_unreadable: Literal["retake", "handoff"] = "retake"
    locate_threshold: float = Field(default=0.6, ge=0, le=1)
    locate_low: float = Field(default=0.35, ge=0, le=1)
    templates: dict[str, str] = Field(default_factory=dict)


class PlaygroundStart(BaseModel):
    external_user_id: str = "playground"
    hint: str | None = None
    known_context: dict[str, Any] | None = None
    content_mode: Literal["published", "draft"] = "published"
    theme: Literal["light", "dark"] = "light"


class ChatStart(BaseModel):
    content_mode: Literal["published", "draft"] = "published"


class TextIn(BaseModel):
    text: str


class ActionIn(BaseModel):
    action: Literal["next", "prev", "choose_branch", "choose_option", "restart"]
    edge_id: str | None = None
    option_id: str | None = None
