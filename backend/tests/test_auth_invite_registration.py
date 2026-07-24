"""Invite-only registration contract for the rebuilt G00 auth entry."""
from __future__ import annotations

import os
import time

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.config import settings
from backend.main import app
from backend.state import get_invite_store, remove_user, store_invite


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "registration_closed", True)
    yield TestClient(app)
    invites = get_invite_store()
    for code in [key for key in invites if key.startswith("G00")]:
        invites.pop(code, None)


def _remove_registered(response) -> None:
    if response.status_code == 200:
        remove_user(response.json()["user"]["id"])


def test_public_registration_remains_closed(client):
    response = client.post(
        "/auth/register",
        json={
            "username": "g00_public",
            "password": "secret12",
            "email": "public@example.com",
        },
    )
    assert response.status_code == 403


def test_valid_invite_is_email_bound_and_single_use(client):
    store_invite(
        "G00VALID",
        {
            "role": "teacher",
            "course_id": None,
            "email": "invited@example.com",
            "expires_at": time.time() + 3600,
            "invited_by": "teacher",
        },
    )
    mismatch = client.post(
        "/auth/register",
        json={
            "username": "g00_wrong_email",
            "password": "secret12",
            "email": "other@example.com",
            "invite_code": "g00valid",
        },
    )
    assert mismatch.status_code == 400
    assert "G00VALID" in get_invite_store()

    success = client.post(
        "/auth/register",
        json={
            "username": "g00_invited",
            "password": "secret12",
            "email": "INVITED@example.com",
            "invite_code": " g00valid ",
        },
    )
    assert success.status_code == 200
    assert success.json()["user"]["role"] == "teacher"
    assert success.json()["user"]["email"] == "invited@example.com"
    assert "G00VALID" not in get_invite_store()

    reused = client.post(
        "/auth/register",
        json={
            "username": "g00_reused",
            "password": "secret12",
            "email": "invited@example.com",
            "invite_code": "G00VALID",
        },
    )
    assert reused.status_code == 400
    _remove_registered(success)


def test_expired_invite_is_rejected_and_removed(client):
    store_invite(
        "G00EXPIRED",
        {
            "role": "teacher",
            "course_id": None,
            "email": "",
            "expires_at": time.time() - 1,
            "invited_by": "teacher",
        },
    )
    response = client.post(
        "/auth/register",
        json={
            "username": "g00_expired",
            "password": "secret12",
            "email": "expired@example.com",
            "invite_code": "G00EXPIRED",
        },
    )
    assert response.status_code == 400
    assert "G00EXPIRED" not in get_invite_store()


def test_registration_strips_username_and_rejects_space_only_value(client):
    store_invite(
        "G00SPACES",
        {
            "role": "teacher",
            "course_id": None,
            "email": "",
            "expires_at": time.time() + 3600,
            "invited_by": "teacher",
        },
    )
    response = client.post(
        "/auth/register",
        json={
            "username": "   ",
            "password": "secret12",
            "email": "spaces@example.com",
            "invite_code": "G00SPACES",
        },
    )
    assert response.status_code == 422
    assert "G00SPACES" in get_invite_store()
