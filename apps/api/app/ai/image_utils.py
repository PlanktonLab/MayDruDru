"""Image helpers. All functions are CPU bound and synchronous: request
handlers must run them through `asyncio.to_thread` (see `read_image_upload`)."""

import asyncio
import base64
import io
import warnings

from PIL import Image

from ..config import get_settings


class InvalidImage(ValueError):
    """Not a readable image."""


class ImageTooLarge(InvalidImage):
    """Bytes or decoded pixels over the configured limit."""


def load(data: bytes) -> Image.Image:
    """Decode an image, refusing anything whose pixel count exceeds the limit
    *before* the pixels are allocated."""
    limit = get_settings().max_image_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data))
            w, h = img.size
            if w * h > limit:
                raise ImageTooLarge(f"{w}x{h}")
            img.load()
    except ImageTooLarge:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
        raise ImageTooLarge(str(e)) from e
    except Exception as e:
        raise InvalidImage(str(e)) from e
    return img


def dimensions(data: bytes) -> tuple[int, int]:
    return load(data).size


def shrink_for_model(data: bytes, max_edge: int | None = None) -> bytes:
    """Resize so the long edge is <= max_edge (default from settings) and
    re-encode as PNG. Keeps model cost bounded (SPEC §7.1)."""
    max_edge = max_edge or get_settings().image_max_edge
    img = load(data)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    w, h = img.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="PNG")  # no optimize=True: ~10x slower for a few % smaller
    return out.getvalue()


def to_data_url(data: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def make_preview(data: bytes, max_edge: int = 240) -> bytes:
    img = load(data).convert("RGB")
    img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=85)
    return out.getvalue()


def to_png(data: bytes) -> bytes:
    img = load(data)
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


async def read_image_upload(file, max_bytes: int | None = None) -> bytes:
    """Read an UploadFile with a byte cap and normalise it to PNG off the event loop.

    Raises ImageTooLarge (bytes or pixels over the limit) or InvalidImage; the
    caller maps them to its own error format.
    """
    cap = max_bytes or get_settings().max_upload_bytes
    data = await file.read(cap + 1)
    if len(data) > cap:
        raise ImageTooLarge(f"{len(data)} bytes")
    return await asyncio.to_thread(to_png, data)
