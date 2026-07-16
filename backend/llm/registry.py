"""Owner-scoped BYOK registry with an explicit shared environment pool.

The process owns one registry, but user keys are never exposed through its
unscoped methods.  Callers with an authenticated owner use ``for_owner()``;
legacy callers without user context use ``shared_view()`` (or the unscoped
compatibility methods, which are deliberately shared-only).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit, urlunsplit

from backend.config import settings
from backend.models import ProviderConfig
from backend.llm.providers import BaseProvider, build_provider

logger = logging.getLogger(__name__)


class SharedPoolLimitError(RuntimeError):
    """Stable, non-retryable signal raised before a shared provider call."""

    retryable = False


class _SharedPoolUsageLimiter:
    def __init__(self) -> None:
        self._usage: Dict[tuple[str, str], tuple[int, int]] = {}
        self._lock = Lock()

    def consume(self, owner_id: str, messages: List[Any]) -> None:
        day = datetime.now(timezone.utc).date().isoformat()
        estimated_tokens = max(1, sum(
            len(str(getattr(message, "content", "")))
            for message in messages
        ) // 4)
        request_limit = max(0, int(settings.shared_pool_daily_request_limit))
        token_limit = max(0, int(settings.shared_pool_daily_estimated_token_limit))
        with self._lock:
            for key in list(self._usage):
                if key[1] != day:
                    self._usage.pop(key, None)
            key = (owner_id, day)
            requests, tokens = self._usage.get(key, (0, 0))
            if (
                request_limit <= 0
                or token_limit <= 0
                or requests + 1 > request_limit
                or tokens + estimated_tokens > token_limit
            ):
                raise SharedPoolLimitError("shared_pool_daily_limit_reached")
            self._usage[key] = (requests + 1, tokens + estimated_tokens)

    def clear(self) -> None:
        with self._lock:
            self._usage.clear()


_shared_pool_usage = _SharedPoolUsageLimiter()


class _GuardedSharedProvider:
    """Owner-bound proxy that charges each real shared-pool invocation."""

    def __init__(self, provider: BaseProvider, owner_id: str) -> None:
        self._provider = provider
        self._owner_id = owner_id
        self.provider_id = provider.provider_id
        self.provider_type = provider.provider_type
        self.model = provider.model
        self.config = provider.config

    async def ainvoke(self, messages: List[Any]):
        if not settings.shared_pool_enabled:
            raise SharedPoolLimitError("shared_pool_disabled")
        _shared_pool_usage.consume(self._owner_id, messages)
        return await self._provider.ainvoke(messages)

    def __getattr__(self, name: str):
        return getattr(self._provider, name)


class RegistryQuotaError(RuntimeError):
    """Stable owner-registry quota signal translated by the HTTP layer."""

    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code


class ExpertRegistryView:
    """Read-only provider selection view for one owner or the shared pool.

    If an owner has any BYOK entry, the owner view contains only that owner's
    entries (including disabled ones).  The shared pool is a fallback for
    owners with no BYOK configuration; it must never be mixed into paid
    owner work or multi-expert grading.
    """

    def __init__(self, registry: "ExpertRegistry", owner_id: Optional[str]) -> None:
        self._registry = registry
        self.owner_id = owner_id

    def get(self, provider_id: str) -> Optional[BaseProvider]:
        return self._registry._get_visible(provider_id, self.owner_id)

    def list_available(self) -> List[BaseProvider]:
        return self._registry._list_available(self.owner_id)

    def list_configs(self) -> List[Dict[str, object]]:
        return self._registry._list_configs(self.owner_id)

    def list_enabled_configs(self) -> List[ProviderConfig]:
        """Return raw enabled configs for trusted backend consumers only."""

        return self._registry._list_enabled_configs(self.owner_id)

    def count(self) -> int:
        return len(self.list_available())

    def pick_default(self) -> Optional[BaseProvider]:
        return self._registry._pick_default(self.owner_id)

    def uses_shared_pool(self) -> bool:
        return self._registry._uses_shared_pool(self.owner_id)


class ExpertRegistry:
    """Thread-safe shared + owner-specific LLM provider registry."""

    MAX_PROVIDERS_PER_OWNER = 8
    MAX_OWNER_PROVIDERS_GLOBAL = 1000
    MAX_CONFIG_BYTES_PER_OWNER = 16 * 1024
    MAX_OWNER_CONFIG_BYTES_GLOBAL = 2 * 1024 * 1024

    def __init__(self) -> None:
        # Storage keys are internal. Shared entries retain their logical ID for
        # backwards-compatible unit tests; owner entries use an opaque suffix.
        self._providers: Dict[str, BaseProvider] = {}
        self._configs: Dict[str, ProviderConfig] = {}
        self._shared_provider_ids: set[str] = set()  # internal storage IDs
        self._entry_owners: Dict[str, Optional[str]] = {}
        self._public_provider_ids: Dict[str, str] = {}
        self._lock = Lock()
        self._seed_from_settings()

    @staticmethod
    def _owner_storage_id(owner_id: str, provider_id: str) -> str:
        owner_digest = hashlib.sha256(owner_id.encode("utf-8")).hexdigest()
        return f"owner:{owner_digest}:{provider_id}"

    def _seed_from_settings(self) -> None:
        """Populate the shared pool from environment variables at startup."""

        if settings.gemini_api_key:
            self.register(ProviderConfig(
                provider_type="gemini",
                api_key=settings.gemini_api_key,
                model=settings.gemini_model,
            ), shared=True)
        if settings.openai_api_key and settings.openai_api_key != "YOUR_API_KEY_HERE":
            self.register(ProviderConfig(
                provider_type="openai",
                api_key=settings.openai_api_key,
                model=settings.openai_model,
                base_url=settings.openai_api_base,
            ), shared=True)
        if settings.zhipu_api_key:
            self.register(ProviderConfig(
                provider_type="zhipu",
                api_key=settings.zhipu_api_key,
                model=settings.zhipu_model,
                base_url=settings.zhipu_api_base,
            ), shared=True)
        if settings.anthropic_api_key:
            self.register(ProviderConfig(
                provider_type="anthropic",
                api_key=settings.anthropic_api_key,
                model=settings.anthropic_model,
            ), shared=True)

    def register(
        self,
        config: ProviderConfig,
        *,
        owner_id: Optional[str] = None,
        shared: bool = False,
    ) -> str:
        """Register or replace one logical provider and return its public ID.

        ``owner_id`` is mandatory for BYOK API callers.  Ownerless direct calls
        remain supported for internal/tests compatibility and are shared-pool
        registrations, never process-global user entries.
        """

        if shared and owner_id is not None:
            raise ValueError("A shared provider cannot have an owner_id")
        provider = build_provider(config)
        provider_id = provider.provider_id
        is_shared = shared or owner_id is None
        storage_id = (
            provider_id
            if is_shared
            else self._owner_storage_id(owner_id, provider_id)
        )
        with self._lock:
            if not is_shared:
                owner_storage_ids = [
                    key for key, entry_owner in self._entry_owners.items()
                    if entry_owner == owner_id and key != storage_id
                ]
                global_owner_storage_ids = [
                    key for key, entry_owner in self._entry_owners.items()
                    if entry_owner is not None and key != storage_id
                ]
                config_bytes = self._config_resident_bytes(config)
                owner_bytes = sum(
                    self._config_resident_bytes(self._configs[key])
                    for key in owner_storage_ids
                    if key in self._configs
                )
                global_bytes = sum(
                    self._config_resident_bytes(self._configs[key])
                    for key in global_owner_storage_ids
                    if key in self._configs
                )
                if len(owner_storage_ids) >= self.MAX_PROVIDERS_PER_OWNER:
                    raise RegistryQuotaError("expert_owner_count_limit", 429)
                if len(global_owner_storage_ids) >= self.MAX_OWNER_PROVIDERS_GLOBAL:
                    raise RegistryQuotaError("expert_global_count_limit", 429)
                if owner_bytes + config_bytes > self.MAX_CONFIG_BYTES_PER_OWNER:
                    raise RegistryQuotaError("expert_owner_bytes_limit", 413)
                if global_bytes + config_bytes > self.MAX_OWNER_CONFIG_BYTES_GLOBAL:
                    raise RegistryQuotaError("expert_global_bytes_limit", 413)
            self._providers[storage_id] = provider
            self._configs[storage_id] = config
            self._entry_owners[storage_id] = None if is_shared else owner_id
            self._public_provider_ids[storage_id] = provider_id
            if is_shared:
                self._shared_provider_ids.add(storage_id)
            else:
                self._shared_provider_ids.discard(storage_id)
        logger.info(
            "Registered %s expert; provider_type=%s",
            "shared" if is_shared else "owner-scoped",
            config.provider_type,
        )
        return provider_id

    def unregister(self, provider_id: str, *, owner_id: Optional[str] = None) -> bool:
        """Remove a shared direct entry or one owner's BYOK entry.

        Authenticated APIs always pass ``owner_id`` and therefore cannot touch
        shared entries or another owner's storage key.
        """

        storage_id = (
            provider_id
            if owner_id is None
            else self._owner_storage_id(owner_id, provider_id)
        )
        with self._lock:
            existed = storage_id in self._providers
            self._providers.pop(storage_id, None)
            self._configs.pop(storage_id, None)
            self._shared_provider_ids.discard(storage_id)
            self._entry_owners.pop(storage_id, None)
            self._public_provider_ids.pop(storage_id, None)
        if existed:
            logger.info("Unregistered expert")
        return existed

    def unregister_for_owner(self, owner_id: str, provider_id: str) -> str:
        """Return ``removed``, ``shared_read_only``, or ``not_found``."""

        if self.unregister(provider_id, owner_id=owner_id):
            return "removed"
        with self._lock:
            if self._shared_storage_id(provider_id) is not None:
                return "shared_read_only"
        return "not_found"

    def set_enabled_for_owner(
        self,
        owner_id: str,
        provider_id: str,
        enabled: bool,
    ) -> str:
        """Return ``updated``, ``shared_read_only``, or ``not_found``."""

        storage_id = self._owner_storage_id(owner_id, provider_id)
        with self._lock:
            config = self._configs.get(storage_id)
            if config is not None:
                config.enabled = enabled
                return "updated"
            if self._shared_storage_id(provider_id) is not None:
                return "shared_read_only"
        return "not_found"

    def for_owner(self, owner_id: str) -> ExpertRegistryView:
        if not owner_id:
            raise ValueError("owner_id is required for an owner registry view")
        return ExpertRegistryView(self, owner_id)

    def shared_view(self) -> ExpertRegistryView:
        return ExpertRegistryView(self, None)

    # Unscoped compatibility methods are intentionally shared-only. This is
    # the secure default for legacy endpoints with no authenticated user.
    def get(self, provider_id: str) -> Optional[BaseProvider]:
        return self._get_visible(provider_id, None)

    def list_available(self) -> List[BaseProvider]:
        return self._list_available(None)

    def list_configs(self) -> List[Dict[str, object]]:
        return self._list_configs(None)

    def list_enabled_configs(self) -> List[ProviderConfig]:
        return self._list_enabled_configs(None)

    def count(self) -> int:
        return len(self.list_available())

    def pick_default(self) -> Optional[BaseProvider]:
        return self._pick_default(None)

    def pick_shared_default(self) -> Optional[BaseProvider]:
        return self._pick_default(None)

    def _shared_storage_id(self, provider_id: str) -> Optional[str]:
        for storage_id in self._shared_provider_ids:
            if (
                storage_id in self._providers
                and self._public_provider_ids.get(storage_id, storage_id) == provider_id
            ):
                return storage_id
        return None

    def _visible_storage_ids(self, owner_id: Optional[str]) -> Dict[str, str]:
        """Build logical provider ID -> internal ID. Caller holds ``_lock``."""

        owner_entries: Dict[str, str] = {}
        if owner_id is not None:
            for storage_id, entry_owner in self._entry_owners.items():
                if (
                    entry_owner == owner_id
                    and storage_id in self._providers
                    and storage_id in self._configs
                ):
                    public_id = self._public_provider_ids.get(
                        storage_id,
                        self._providers[storage_id].provider_id,
                    )
                    owner_entries[public_id] = storage_id
            if owner_entries:
                return owner_entries

            # Environment keys are an explicit, kill-switched fallback.  A
            # public owner receives at most one shared expert so grading cannot
            # multiply free-pool spend through multi-expert fan-out.
            if not settings.shared_pool_enabled:
                return {}

            shared_candidates = [
                storage_id for storage_id in self._shared_provider_ids
                if storage_id in self._providers and storage_id in self._configs
                and self._configs[storage_id].enabled
            ]
            if not shared_candidates:
                return {}
            shared_candidates.sort(key=lambda storage_id: (
                self._configs[storage_id].provider_type != settings.default_provider,
                self._public_provider_ids.get(storage_id, storage_id),
            ))
            selected = shared_candidates[0]
            public_id = self._public_provider_ids.get(selected, selected)
            return {public_id: selected}

        visible: Dict[str, str] = {}
        for storage_id in self._shared_provider_ids:
            if storage_id not in self._providers or storage_id not in self._configs:
                continue
            public_id = self._public_provider_ids.get(storage_id, storage_id)
            visible[public_id] = storage_id
        return visible

    def _get_visible(
        self,
        provider_id: str,
        owner_id: Optional[str],
    ) -> Optional[BaseProvider]:
        with self._lock:
            storage_id = self._visible_storage_ids(owner_id).get(provider_id)
            if storage_id is None:
                return None
            provider = self._providers.get(storage_id)
            if (
                provider is not None
                and owner_id is not None
                and storage_id in self._shared_provider_ids
            ):
                return _GuardedSharedProvider(provider, owner_id)  # type: ignore[return-value]
            return provider

    def _list_available(self, owner_id: Optional[str]) -> List[BaseProvider]:
        with self._lock:
            visible = self._visible_storage_ids(owner_id)
            return [
                (
                    _GuardedSharedProvider(self._providers[visible[provider_id]], owner_id)
                    if owner_id is not None
                    and visible[provider_id] in self._shared_provider_ids
                    else self._providers[visible[provider_id]]
                )
                for provider_id in sorted(visible)
                if self._configs[visible[provider_id]].enabled
            ]

    def _uses_shared_pool(self, owner_id: Optional[str]) -> bool:
        if owner_id is None:
            return False
        with self._lock:
            visible = self._visible_storage_ids(owner_id)
            return bool(visible) and all(
                storage_id in self._shared_provider_ids
                for storage_id in visible.values()
            )

    def _list_enabled_configs(self, owner_id: Optional[str]) -> List[ProviderConfig]:
        with self._lock:
            visible = self._visible_storage_ids(owner_id)
            return [
                self._configs[visible[provider_id]]
                for provider_id in sorted(visible)
                if self._configs[visible[provider_id]].enabled
            ]

    def _list_configs(self, owner_id: Optional[str]) -> List[Dict[str, object]]:
        with self._lock:
            visible = self._visible_storage_ids(owner_id)
            out: List[Dict[str, object]] = []
            for provider_id in sorted(visible):
                storage_id = visible[provider_id]
                config = self._configs[storage_id]
                is_shared = storage_id in self._shared_provider_ids
                out.append({
                    "provider_id": provider_id,
                    "provider_type": config.provider_type,
                    "model": config.model,
                    "base_url": self._public_base_url(config.base_url),
                    "enabled": config.enabled,
                    "display_name": config.display_name or provider_id,
                    "max_concurrent": config.max_concurrent,
                    "rpm": config.rpm,
                    "api_key": "***",
                    "scope": "shared" if is_shared else "owner",
                    "is_shared": is_shared,
                    "editable": not is_shared,
                })
            return out

    def _pick_default(self, owner_id: Optional[str]) -> Optional[BaseProvider]:
        available = self._list_available(owner_id)
        if not available:
            return None
        for provider in available:
            if provider.provider_type == settings.default_provider:
                return provider
        return available[0]

    @staticmethod
    def _config_resident_bytes(config: ProviderConfig) -> int:
        return sum(len((value or "").encode("utf-8")) for value in (
            config.api_key,
            config.model,
            config.base_url,
            config.display_name,
        ))

    @staticmethod
    def _public_base_url(value: Optional[str]) -> Optional[str]:
        """Return only a safe origin; never echo userinfo, path, query or fragment."""

        if not value:
            return None
        try:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname:
                return None
            host = parsed.hostname
            if ":" in host and not host.startswith("["):
                host = f"[{host}]"
            netloc = f"{host}:{parsed.port}" if parsed.port is not None else host
            return urlunsplit((parsed.scheme, netloc, "", "", ""))
        except ValueError:
            return None


# Module-level singleton is lazy so provider SDKs are not initialized before
# proxy environment variables are configured by backend.main.
_registry: Optional[ExpertRegistry] = None
_registry_lock = Lock()


def get_expert_registry() -> ExpertRegistry:
    """FastAPI dependency returning the process registry."""

    global _registry
    if _registry is None:
        with _registry_lock:
            if _registry is None:
                _registry = ExpertRegistry()
    return _registry
