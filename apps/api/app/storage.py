"""Object storage (S3 compatible via MinIO).

Clerk originals and eval screenshots are encrypted at the application layer
(Fernet) before upload, so the private bucket never holds plaintext
screenshots. Every function here is synchronous (the MinIO client blocks):
call them from request handlers through `asyncio.to_thread`.
"""

import base64
import hashlib
import io
from datetime import datetime
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken
from minio import Minio
from minio.error import S3Error

from .config import get_settings


@lru_cache
def client() -> Minio:
    s = get_settings()
    return Minio(s.s3_endpoint, access_key=s.s3_access_key, secret_key=s.s3_secret_key, secure=s.s3_secure)


@lru_cache
def fernet() -> Fernet:
    s = get_settings()
    key = s.original_encryption_key
    if not key:
        if s.is_production:
            raise RuntimeError("ORIGINAL_ENCRYPTION_KEY must be set in production")
        # dev only: derive a stable key so api and worker agree
        key = base64.urlsafe_b64encode(hashlib.sha256(("orig:" + s.secret_key).encode()).digest()).decode()
    return Fernet(key.encode())


def ensure_buckets() -> None:
    s = get_settings()
    c = client()
    for b in (s.s3_bucket_private, s.s3_bucket_public):
        if not c.bucket_exists(b):
            c.make_bucket(b)


def put(bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    client().put_object(bucket, key, io.BytesIO(data), len(data), content_type=content_type)
    return key


def get(bucket: str, key: str) -> bytes:
    resp = client().get_object(bucket, key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


def delete(bucket: str, key: str) -> None:
    """Delete an object. A missing object counts as deleted; any other storage
    error propagates, so callers only forget a key once it is really gone."""
    try:
        client().remove_object(bucket, key)
    except S3Error as e:
        if e.code != "NoSuchKey":
            raise


def exists(bucket: str, key: str) -> bool:
    try:
        client().stat_object(bucket, key)
        return True
    except S3Error:
        return False


def list_objects(bucket: str, prefix: str) -> list[tuple[str, datetime | None]]:
    """(key, last_modified) for every object under a prefix."""
    return [(o.object_name, o.last_modified) for o in client().list_objects(bucket, prefix=prefix, recursive=True)]


# ---- originals (encrypted, private)

ORIGINALS_PREFIX = "originals/"


def put_original(tenant_id: str, variant_id: str, data: bytes) -> str:
    key = f"{ORIGINALS_PREFIX}{tenant_id}/{variant_id}.bin"
    put(get_settings().s3_bucket_private, key, fernet().encrypt(data))
    return key


def get_original(key: str) -> bytes:
    return fernet().decrypt(get(get_settings().s3_bucket_private, key))


def delete_original(key: str) -> None:
    delete(get_settings().s3_bucket_private, key)


# ---- other private objects

def put_private(key: str, data: bytes, content_type: str) -> str:
    return put(get_settings().s3_bucket_private, key, data, content_type)


def get_private(key: str) -> bytes:
    return get(get_settings().s3_bucket_private, key)


def delete_private(key: str) -> None:
    delete(get_settings().s3_bucket_private, key)


def put_sealed(key: str, data: bytes) -> str:
    """Private and encrypted — for screenshots that may contain personal data (eval cases)."""
    return put(get_settings().s3_bucket_private, key, fernet().encrypt(data))


def get_sealed(key: str) -> bytes:
    raw = get(get_settings().s3_bucket_private, key)
    try:
        return fernet().decrypt(raw)
    except InvalidToken:  # objects written before encryption was introduced
        return raw


# ---- public, content-addressed

def put_public_hashed(prefix: str, data: bytes, ext: str, content_type: str) -> str:
    """Public, unguessable, content-addressed key -> long cache."""
    digest = hashlib.sha256(data).hexdigest()
    key = f"{prefix}/{digest}.{ext}"
    s = get_settings()
    if not exists(s.s3_bucket_public, key):
        put(s.s3_bucket_public, key, data, content_type)
    return key


def thumb_key_for(card_key: str | None) -> str | None:
    """The canvas thumbnail sits next to its Step Card: cards/{t}/{sha}.png -> thumbs/{t}/{sha}.jpg."""
    if not card_key or not card_key.startswith("cards/"):
        return None
    return "thumbs/" + card_key[len("cards/"):].rsplit(".", 1)[0] + ".jpg"


def get_public(key: str) -> bytes:
    return get(get_settings().s3_bucket_public, key)


def public_url(key: str | None) -> str | None:
    if not key:
        return None
    return f"{get_settings().public_media_base_url.rstrip('/')}/{key}"
