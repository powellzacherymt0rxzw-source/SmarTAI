"""Migration round-trip smoke (Task 1).

Verifies the single normalized baseline is reversible on SQLite: starting from
an empty DB, ``upgrade head → downgrade base → upgrade head`` must all succeed.
This catches batch-alter downgrade issues (constraint names, dropped columns)
that an upgrade-only check misses, and proves the clean baseline creates every
retained + education table from an empty database.
"""
from __future__ import annotations

from io import StringIO

from alembic import command
from alembic.config import Config


def _alembic_config(db_url: str, monkeypatch) -> Config:
    cfg = Config("alembic.ini")
    cfg.set_main_option("script_location", "backend/db/migrations")
    # env.py reads SMARTAI_DATABASE_URL; also force light mode so the SQLite URL
    # passes validate_database_mode(). Use monkeypatch so the env is restored
    # after the test and doesn't leak into other tests' configure_database().
    monkeypatch.setenv("SMARTAI_DATABASE_URL", db_url)
    monkeypatch.setenv("SMARTAI_DATABASE_HEAVY", "OFF")
    return cfg


def test_migration_downgrade_from_empty_head_then_upgrade(tmp_path, monkeypatch):
    """Upgrade to head, downgrade straight to base, then back to head — full reversibility."""
    db_url = f"sqlite:///{(tmp_path / 'fullround.db').as_posix()}"
    cfg = _alembic_config(db_url, monkeypatch)

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")


def test_normalized_tables_exist_after_roundtrip(tmp_path, monkeypatch):
    """After a full downgrade→upgrade roundtrip the education tables reappear."""
    db_url = f"sqlite:///{(tmp_path / 'roundtrip.db').as_posix()}"
    cfg = _alembic_config(db_url, monkeypatch)

    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    from sqlalchemy import inspect
    from backend.db.session import configure_database

    configure_database(db_url)
    tables = set(inspect(configure_database()).get_table_names())
    assert {
        "courses",
        "course_enrollments",
        "assignments",
        "assignment_questions",
        "submissions",
        "submission_revisions",
        "submission_answers",
        "grading_runs",
        "grade_results",
        "teacher_reviews",
        "stored_files",
    } <= tables
    # Legacy tables must not reappear after the roundtrip.
    assert not ({"tasks", "grading_jobs", "task_knowledge_documents"} & tables)


def _postgresql_sql(monkeypatch, revision: str) -> str:
    from backend.config import settings

    database_url = "postgresql+psycopg://smartai:smartai@localhost/smartai_test"
    monkeypatch.setenv("SMARTAI_DATABASE_URL", database_url)
    monkeypatch.setenv("SMARTAI_DATABASE_HEAVY", "ON")
    monkeypatch.setattr(settings, "database_heavy", True)
    output = StringIO()
    cfg = Config("alembic.ini", output_buffer=output)
    cfg.set_main_option("script_location", "backend/db/migrations")
    if ":" in revision:
        command.downgrade(cfg, revision, sql=True)
    else:
        command.upgrade(cfg, revision, sql=True)
    return output.getvalue()


def test_postgresql_upgrade_adds_deferred_foreign_keys_after_tables(monkeypatch):
    sql = _postgresql_sql(monkeypatch, "head")
    deferred_constraints = {
        "fk_stored_files_submission_revision": ("stored_files", "submission_revisions"),
        "fk_stored_files_knowledge_document": ("stored_files", "knowledge_documents"),
        "fk_knowledge_documents_stored_file": ("knowledge_documents", "stored_files"),
        "fk_submissions_current_revision": ("submissions", "submission_revisions"),
        "fk_submission_revisions_submission": ("submission_revisions", "submissions"),
    }

    for constraint, (source_table, target_table) in deferred_constraints.items():
        alter_position = sql.index(f"ADD CONSTRAINT {constraint}")
        assert sql.index(f"CREATE TABLE {source_table}") < alter_position
        assert sql.index(f"CREATE TABLE {target_table}") < alter_position

    stored_files_definition = sql.split("CREATE TABLE stored_files", 1)[1].split(");", 1)[0]
    assert "REFERENCES submission_revisions" not in stored_files_definition
    assert "REFERENCES knowledge_documents" not in stored_files_definition


def test_postgresql_downgrade_drops_deferred_foreign_keys_before_tables(monkeypatch):
    sql = _postgresql_sql(monkeypatch, "0001_normalized_learning:base")
    constraint_tables = {
        "fk_stored_files_submission_revision": "stored_files",
        "fk_stored_files_knowledge_document": "stored_files",
        "fk_knowledge_documents_stored_file": "knowledge_documents",
        "fk_submissions_current_revision": "submissions",
        "fk_submission_revisions_submission": "submission_revisions",
    }

    for constraint, table_name in constraint_tables.items():
        assert sql.index(f"DROP CONSTRAINT {constraint}") < sql.index(
            f"DROP TABLE {table_name}"
        )
