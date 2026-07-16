"""
Experts API router — BYOK (Bring Your Own Key) management endpoints.

  POST /experts/keys        — register a new provider
  GET  /experts/available   — list available providers (redacted keys)
  POST /experts/select      — enable/disable specific providers
  DELETE /experts/{id}      — remove a provider
"""
from __future__ import annotations

import logging
from typing import Literal, Optional
from urllib.parse import urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.auth import require_teacher
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


_OFFICIAL_PROVIDER_BASE_URLS = {
    "openai": ("api.openai.com", "/v1"),
    "zhipu": ("open.bigmodel.cn", "/api/paas/v4"),
}


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
