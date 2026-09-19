"""Error codes exposed through the public API (SPEC §8.4)."""

from fastapi import HTTPException


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(status_code=status, detail={"code": code, "message": message})
        self.code = code


PLATFORM_NOT_FOUND = "platform_not_found"
FLOW_NOT_FOUND = "flow_not_found"
FLOW_NOT_PUBLISHED = "flow_not_published"
SCREENSHOT_UNRECOGNIZED = "screenshot_unrecognized"
CLARIFICATION_LIMIT = "clarification_limit_reached"
SESSION_EXPIRED = "session_expired"
RATE_LIMITED = "rate_limited"
MODEL_FAILURE = "model_failure"
INVALID_ACTION = "invalid_action"
IMAGE_TOO_LARGE = "image_too_large"
IMAGE_INVALID = "image_invalid"
SESSION_BUSY = "session_busy"
# screenshot outcomes that are not a step (SPEC §7.5 fallback ladder)
SCREEN_OFF_FLOW = "screen_off_flow"            # a known platform, but a page no flow teaches
SCREEN_NOT_APP = "screen_not_app"              # home screen, lock screen, settings …
SCREEN_NOT_SCREENSHOT = "screen_not_screenshot"  # a photo of something that is not a screen
SCREEN_UNREADABLE = "screen_unreadable"        # too blurry / dark / cropped
PLATFORM_UNKNOWN = "platform_unknown"          # an app the tenant has no content for
