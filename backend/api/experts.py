"""
Experts API router — BYOK (Bring Your Own Key) management endpoints.

  POST /experts/keys        — register a new provider
  GET  /experts/available   — list available providers (redacted keys)
  GET  /experts/catalog     — list allowlisted official provider links
  POST /experts/select      — enable/disable specific providers
  PUT  /experts/{id}        — update an owner provider without key echo
  POST /experts/{id}/verify — run one explicit minimal verification request
  DELETE /experts/{id}      — remove a provider
"""
from __future__ import annotations

import asyncio
import logging
from typing import Literal, Optional
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from backend.auth import require_teacher
from backend.config import settings
from backend.models import ProviderConfig, User
from backend.llm.registry import (
    ExpertRegistry,
    RegistryQuotaError,
    get_expert_registry,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/experts", tags=["experts"])


class AddKeyRequest(BaseModel):
    provider_type: Literal["openai", "gemini", "anthropic", "zhipu"]
    api_key: str = Field(min_length=1, max_length=512)
    model: str = Field(min_length=1, max_length=200)
    base_url: Optional[str] = Field(default=None, max_length=512)
    display_name: Optional[str] = Field(default=None, max_length=120)
    max_concurrent: int = Field(default=5, ge=1, le=10)
    rpm: int = Field(default=0, ge=0, le=10_000)


class SelectRequest(BaseModel):
    provider_id: str
    enabled: bool


class UpdateKeyRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, max_length=512)
    model: str = Field(min_length=1, max_length=200)
    base_url: Optional[str] = Field(default=None, max_length=512)
    display_name: Optional[str] = Field(default=None, max_length=120)
    max_concurrent: int = Field(default=5, ge=1, le=10)
    rpm: int = Field(default=0, ge=0, le=10_000)


_OFFICIAL_PROVIDER_BASE_URLS = {
    "openai": ("api.openai.com", "/v1"),
    "zhipu": ("open.bigmodel.cn", "/api/paas/v4"),
}

_PROVIDER_CATALOG = (
    {
        "provider_type": "gemini",
        "display_name": "Google Gemini",
        "docs_url": "https://ai.google.dev/gemini-api/docs",
        "console_url": "https://aistudio.google.com/app/apikey",
        "usage_url": "https://aistudio.google.com/usage",
    },
    {
        "provider_type": "openai",
        "display_name": "OpenAI",
        "docs_url": "https://platform.openai.com/docs",
        "console_url": "https://platform.openai.com/api-keys",
        "usage_url": "https://platform.openai.com/usage",
    },
    {
        "provider_type": "zhipu",
        "display_name": "Zhipu AI",
        "docs_url": "https://docs.bigmodel.cn/",
        "console_url": "https://open.bigmodel.cn/usercenter/apikeys",
        "usage_url": "https://open.bigmodel.cn/console/overview",
    },
    {
        "provider_type": "anthropic",
        "display_name": "Anthropic",
        "docs_url": "https://docs.anthropic.com/en/docs",
        "console_url": "https://platform.claude.com/settings/keys",
        "usage_url": "https://platform.claude.com/usage",
    },
)


def _validated_provider_base_url(
    provider_type: str,
    value: Optional[str],
) -> Optional[str]:
    if not value or not value.strip():
        return None
    try:
        parsed = urlsplit(value.strip())
        parsed_port = parsed.port
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "provider_base_url_not_allowed"},
        ) from exc
    official = _OFFICIAL_PROVIDER_BASE_URLS.get(provider_type)
    normalized_path = parsed.path.rstrip("/")
    if (
        official is None
        or parsed.scheme != "https"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.hostname != official[0]
        or parsed_port not in {None, 443}
        or normalized_path not in {"", official[1]}
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "provider_base_url_not_allowed"},
        )
    return urlunsplit(("https", official[0], official[1], "", ""))


@router.post("/keys")
def add_key(
    request: AddKeyRequest,
    current: User = Depends(require_teacher),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Register or update a provider's API key."""
    api_key = request.api_key.strip()
    model = request.model.strip()
    if not api_key or not model:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "expert_fields_blank"},
        )
    config = ProviderConfig(
        provider_type=request.provider_type,
        api_key=api_key,
        model=model,
        base_url=_validated_provider_base_url(
            request.provider_type,
            request.base_url,
        ),
        display_name=request.display_name.strip() if request.display_name else None,
        max_concurrent=request.max_concurrent,
        rpm=request.rpm,
    )
    try:
        provider_id = registry.register(config, owner_id=current.id)
    except RegistryQuotaError as exc:
        raise HTTPException(
            exc.status_code,
            detail={"code": exc.code},
        ) from exc
    return {
        "status": "success",
        "provider_id": provider_id,
        "scope": "owner",
        "is_shared": False,
    }


@router.get("/available")
def list_available(
    current: User = Depends(require_teacher),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """List all configured providers with redacted API keys.

    Each item contains: provider_id, provider_type, model, base_url, enabled,
    display_name, max_concurrent. The frontend dropdown uses provider_id as
    value and display_name as label.
    """
    return registry.for_owner(current.id).list_configs()


@router.get("/catalog")
def provider_catalog(current: User = Depends(require_teacher)):
    """Return a fixed allowlist of official provider destinations."""

    return list(_PROVIDER_CATALOG)


@router.post("/select")
def select_provider(
    request: SelectRequest,
    current: User = Depends(require_teacher),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Enable or disable a specific provider."""
    outcome = registry.set_enabled_for_owner(
        current.id,
        request.provider_id,
        request.enabled,
    )
    if outcome == "shared_read_only":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "shared_provider_read_only",
                "provider_id": request.provider_id,
            },
        )
    if outcome == "not_found":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )
    return {
        "status": "success",
        "provider_id": request.provider_id,
        "enabled": request.enabled,
    }


@router.put("/{provider_id}")
def update_provider(
    provider_id: str,
    request: UpdateKeyRequest,
    current: User = Depends(require_teacher),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Update one owner BYOK entry while preserving an omitted key."""

    visible = next(
        (
            item for item in registry.for_owner(current.id).list_configs()
            if item["provider_id"] == provider_id
        ),
        None,
    )
    if visible is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")
    if visible["editable"] is False:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "shared_provider_read_only",
                "provider_id": provider_id,
            },
        )

    api_key = request.api_key.strip() if request.api_key else None
    model = request.model.strip()
    if not model:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "expert_fields_blank"},
        )
    provider_type = str(visible["provider_type"])
    try:
        outcome = registry.update_for_owner(
            current.id,
            provider_id,
            api_key=api_key,
            model=model,
            base_url=_validated_provider_base_url(
                provider_type,
                request.base_url,
            ),
            display_name=(
                request.display_name.strip()
                if request.display_name and request.display_name.strip()
                else None
            ),
            max_concurrent=request.max_concurrent,
            rpm=request.rpm,
        )
    except RegistryQuotaError as exc:
        raise HTTPException(
            exc.status_code,
            detail={"code": exc.code},
        ) from exc

    if outcome["status"] == "shared_read_only":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "shared_provider_read_only",
                "provider_id": provider_id,
            },
        )
    if outcome["status"] == "not_found":
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")
    if outcome["status"] == "conflict":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "expert_provider_conflict",
                "provider_id": outcome.get("provider_id"),
            },
        )
    return {
        "status": "success",
        "provider_id": outcome["provider_id"],
        "verification_status": "unverified",
    }


@router.post("/{provider_id}/verify")
async def verify_provider(
    provider_id: str,
    current: User = Depends(require_teacher),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Run one explicit minimal request and store only a safe summary."""

    outcome, provider = registry.owned_provider_for_verification(
        current.id,
        provider_id,
    )
    if outcome == "shared_read_only":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "shared_provider_read_only",
                "provider_id": provider_id,
            },
        )
    if outcome == "not_found" or provider is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Provider not found")

    try:
        timeout_seconds = max(5, min(int(settings.llm_timeout), 30))
        await asyncio.wait_for(
            provider.ainvoke([
                HumanMessage(content="Reply with exactly OK."),
            ]),
            timeout=timeout_seconds,
        )
    except Exception as exc:
        error_code = _verification_error_code(exc)
        summary = registry.record_verification_for_owner(
            current.id,
            provider_id,
            expected_provider=provider,
            success=False,
            error_code=error_code,
        )
        if summary is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "code": "expert_verification_stale",
                    "provider_id": provider_id,
                },
            ) from exc
        logger.warning(
            "BYOK verification failed; provider_type=%s exception_type=%s code=%s",
            provider.provider_type,
            type(exc).__name__,
            error_code,
        )
        raise HTTPException(
            _verification_http_status(error_code),
            detail={
                "code": error_code,
                "provider_id": provider_id,
            },
        ) from exc

    summary = registry.record_verification_for_owner(
        current.id,
        provider_id,
        expected_provider=provider,
        success=True,
    )
    if summary is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "expert_verification_stale",
                "provider_id": provider_id,
            },
        )
    return {
        "status": "success",
        "provider_id": provider_id,
        "verification_status": "verified",
        "last_checked_at": summary["last_checked_at"],
        "verified_at": summary["verified_at"],
    }


@router.delete("/{provider_id}")
def remove_provider(
    provider_id: str,
    current: User = Depends(require_teacher),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Remove a provider entirely."""
    outcome = registry.unregister_for_owner(current.id, provider_id)
    if outcome == "shared_read_only":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={
                "code": "shared_provider_read_only",
                "provider_id": provider_id,
            },
        )
    if outcome == "not_found":
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Provider not found",
        )
    return {"status": "success", "message": f"Provider {provider_id} removed."}


def _verification_error_code(exc: Exception) -> str:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "expert_verification_timeout"
    status_code = getattr(exc, "status_code", None)
    response = getattr(exc, "response", None)
    if status_code is None and response is not None:
        status_code = getattr(response, "status_code", None)
    if status_code in {401, 403}:
        return "expert_verification_auth_failed"
    if status_code == 404:
        return "expert_verification_model_not_found"
    if status_code == 429:
        return "expert_verification_rate_limited"
    if isinstance(exc, (ConnectionError, OSError)):
        return "expert_verification_connection_failed"
    return "expert_verification_provider_error"


def _verification_http_status(error_code: str) -> int:
    if error_code == "expert_verification_rate_limited":
        return status.HTTP_429_TOO_MANY_REQUESTS
    if error_code in {
        "expert_verification_timeout",
        "expert_verification_connection_failed",
    }:
        return status.HTTP_503_SERVICE_UNAVAILABLE
    return status.HTTP_502_BAD_GATEWAY
