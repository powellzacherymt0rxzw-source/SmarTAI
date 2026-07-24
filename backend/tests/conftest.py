"""Keep the test suite on an isolated SQLite database and storage directory."""

import os
import tempfile
from pathlib import Path

_TEST_ROOT = Path(tempfile.mkdtemp(prefix="smartai-tests-"))
os.environ.setdefault("SMARTAI_DATABASE_URL", f"sqlite:///{(_TEST_ROOT / 'test.db').as_posix()}")
os.environ.setdefault("SMARTAI_DATABASE_AUTO_CREATE", "true")
os.environ.setdefault("SMARTAI_SEED_TEST_USERS", "false")
os.environ.setdefault("SMARTAI_STORAGE_ROOT", str(_TEST_ROOT / "uploads"))
os.environ.setdefault("SMARTAI_PROVIDER_ENCRYPTION_KEY", "test-suite-provider-master-key")

import pytest  # noqa: E402

from backend.db.session import configure_database, create_schema  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_database():
    configure_database(os.environ["SMARTAI_DATABASE_URL"])
    create_schema()
    yield
