"""
Experts API router — BYOK (Bring Your Own Key) management endpoints.

  POST /experts/keys        — register a new provider
  GET  /experts/available   — list available providers (redacted keys)
  POST /experts/select      — enable/disable specific providers
  DELETE /experts/{id}      — remove a provider
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import get_current_user
from backend.config import settings
from backend.db.provider_repository import delete_provider_config, set_provider_enabled, upsert_provider_config
from backend.models import ProviderConfig, User
from backend.llm.registry import get_scoped_expert_registry, ExpertRegistry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/experts", tags=["experts"])


class AddKeyRequest(BaseModel):
    provider_type: str  # "openai" | "gemini" | "anthropic" | "zhipu"
    api_key: str
    model: str
    base_url: Optional[str] = None
    display_name: Optional[str] = None
    max_concurrent: int = 5
    rpm: int = 0  # Per-minute request cap; 0 = unlimited (only max_concurrent applies)


class SelectRequest(BaseModel):
    provider_id: str
    enabled: bool


@router.post("/keys")
def add_key(
    request: AddKeyRequest,
    current: User = Depends(get_current_user),
    registry: ExpertRegistry = Depends(get_scoped_expert_registry),
):
    """Register or update a provider's API key."""
    config = ProviderConfig(
        provider_type=request.provider_type,
        api_key=request.api_key,
        model=request.model,
        base_url=request.base_url,
        display_name=request.display_name or None,
        max_concurrent=max(1, request.max_concurrent),
        rpm=max(0, request.rpm),
    )
    if not settings.provider_encryption_key:
        raise HTTPException(503, detail="Provider credential encryption is not configured.")
    record = upsert_provider_config(current.id, config, master_key=settings.provider_encryption_key)
    provider_id = registry.register(config, provider_id=record.id)
    return {"status": "success", "provider_id": provider_id}


@router.get("/available")
def list_available(
    current: User = Depends(get_current_user),
    registry: ExpertRegistry = Depends(get_scoped_expert_registry),
):
    """List all configured providers with redacted API keys.

    Each item contains: provider_id, provider_type, model, base_url, enabled,
    display_name, max_concurrent. The frontend dropdown uses provider_id as
    value and display_name as label.
    """
    return registry.list_configs()


@router.post("/select")
def select_provider(
    request: SelectRequest,
    current: User = Depends(get_current_user),
    registry: ExpertRegistry = Depends(get_scoped_expert_registry),
):
    """Enable or disable a specific provider."""
    if set_provider_enabled(current.id, request.provider_id, request.enabled):
        return {"status": "success", "provider_id": request.provider_id, "enabled": request.enabled}
    return {"status": "not_found", "message": f"Provider {request.provider_id} not found."}


@router.delete("/{provider_id}")
def remove_provider(
    provider_id: str,
    current: User = Depends(get_current_user),
    registry: ExpertRegistry = Depends(get_scoped_expert_registry),
):
    """Remove a provider entirely."""
    existed = delete_provider_config(current.id, provider_id)
    if existed:
        return {"status": "success", "message": f"Provider {provider_id} removed."}
    return {"status": "not_found", "message": f"Provider {provider_id} not found."}
