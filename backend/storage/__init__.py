from backend.storage.base import StorageBackend
from backend.storage.local import LocalStorage
from backend.storage.object import S3Storage
from backend.config import settings
from functools import lru_cache


def build_storage() -> StorageBackend:
    if settings.storage_backend == "local":
        return LocalStorage()
    if settings.storage_backend == "object":
        return S3Storage()
    raise ValueError(f"Unsupported SMARTAI_STORAGE_BACKEND: {settings.storage_backend}")


@lru_cache(maxsize=1)
def get_storage() -> StorageBackend:
    return build_storage()

__all__ = ["StorageBackend", "LocalStorage", "S3Storage", "build_storage", "get_storage"]
