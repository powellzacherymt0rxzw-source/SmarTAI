from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from sqlalchemy import select

from backend.db.models import ProviderConfigRecord
from backend.db.session import session_scope
from backend.models import ProviderConfig
from backend.security.secrets import EncryptedSecret, decrypt_secret, encrypt_secret


@dataclass(frozen=True)
class StoredProviderConfig:
    id: str
    config: ProviderConfig


def _associated_data(owner_id: str, record_id: str) -> str:
    return f"provider-config:{owner_id}:{record_id}"


def _to_config(record: ProviderConfigRecord, master_key: str) -> ProviderConfig:
    api_key = decrypt_secret(
        EncryptedSecret(record.encrypted_api_key, record.nonce, record.key_version),
        master_key=master_key,
        associated_data=_associated_data(record.owner_id, record.id),
    )
    return ProviderConfig(
        provider_type=record.provider_type,
        api_key=api_key,
        model=record.model,
        base_url=record.base_url,
        enabled=record.enabled,
        display_name=record.display_name,
        max_concurrent=max(1, record.max_concurrent),
        rpm=max(0, record.rpm),
    )


def upsert_provider_config(owner_id: str, config: ProviderConfig, *, master_key: str) -> ProviderConfigRecord:
    now = time.time()
    with session_scope() as session:
        record = session.scalar(select(ProviderConfigRecord).where(
            ProviderConfigRecord.owner_id == owner_id,
            ProviderConfigRecord.provider_type == config.provider_type,
            ProviderConfigRecord.model == config.model,
        ))
        if record is None:
            record = ProviderConfigRecord(
                id=uuid.uuid4().hex,
                owner_id=owner_id,
                provider_type=config.provider_type,
                model=config.model,
                created_at=now,
            )
            session.add(record)
        encrypted = encrypt_secret(
            config.api_key,
            master_key=master_key,
            associated_data=_associated_data(owner_id, record.id),
        )
        record.base_url = config.base_url
        record.display_name = config.display_name
        record.encrypted_api_key = encrypted.ciphertext
        record.nonce = encrypted.nonce
        record.key_version = encrypted.key_version
        record.enabled = config.enabled
        record.max_concurrent = max(1, config.max_concurrent)
        record.rpm = max(0, config.rpm)
        record.updated_at = now
        return record


def list_provider_configs(owner_id: str, *, master_key: str) -> list[StoredProviderConfig]:
    with session_scope() as session:
        records = list(session.scalars(select(ProviderConfigRecord).where(
            ProviderConfigRecord.owner_id == owner_id).order_by(ProviderConfigRecord.created_at)))
    return [StoredProviderConfig(id=record.id, config=_to_config(record, master_key)) for record in records]


def get_provider_config(owner_id: str, provider_id: str, *, master_key: str) -> StoredProviderConfig | None:
    with session_scope() as session:
        record = session.scalar(select(ProviderConfigRecord).where(
            ProviderConfigRecord.id == provider_id,
            ProviderConfigRecord.owner_id == owner_id,
        ))
    if record is None:
        return None
    return StoredProviderConfig(id=record.id, config=_to_config(record, master_key))


def set_provider_enabled(owner_id: str, provider_id: str, enabled: bool) -> bool:
    with session_scope() as session:
        record = session.scalar(select(ProviderConfigRecord).where(
            ProviderConfigRecord.id == provider_id,
            ProviderConfigRecord.owner_id == owner_id,
        ))
        if record is None:
            return False
        record.enabled = enabled
        record.updated_at = time.time()
        return True


def delete_provider_config(owner_id: str, provider_id: str) -> bool:
    with session_scope() as session:
        record = session.scalar(select(ProviderConfigRecord).where(
            ProviderConfigRecord.id == provider_id,
            ProviderConfigRecord.owner_id == owner_id,
        ))
        if record is None:
            return False
        session.delete(record)
        return True
