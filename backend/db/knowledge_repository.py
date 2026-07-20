from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select

from backend.db.models import (
    AssignmentKnowledgeDocumentRecord,
    AssignmentRecord,
    KnowledgeChunkRecord,
    KnowledgeDocumentRecord,
)
from backend.db.session import session_scope


@dataclass(frozen=True)
class KnowledgeDocument:
    id: str
    owner_id: str
    stored_file_id: str | None
    title: str
    original_name: str
    content_type: str | None
    size_bytes: int
    sha256: str
    status: str
    parser_version: str
    chunk_count: int
    error_code: str | None
    created_at: float
    updated_at: float

    def public(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "original_name": self.original_name,
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "sha256": self.sha256,
            "status": self.status,
            "parser_version": self.parser_version,
            "chunk_count": self.chunk_count,
            "error_code": self.error_code,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _document(record: KnowledgeDocumentRecord) -> KnowledgeDocument:
    return KnowledgeDocument(**{
        column.name: getattr(record, column.name)
        for column in KnowledgeDocumentRecord.__table__.columns
    })


def create_document(*, document_id: str | None = None, owner_id: str, stored_file_id: str | None,
                    title: str, original_name: str, content_type: str | None, size_bytes: int,
                    sha256: str, status: str = "processing", parser_version: str = "v1") -> KnowledgeDocument:
    now = time.time()
    record = KnowledgeDocumentRecord(
        id=document_id or f"doc_{uuid.uuid4().hex[:16]}", owner_id=owner_id,
        stored_file_id=stored_file_id, title=title, original_name=original_name,
        content_type=content_type, size_bytes=size_bytes, sha256=sha256,
        status=status, parser_version=parser_version, chunk_count=0,
        created_at=now, updated_at=now,
    )
    with session_scope() as session:
        session.add(record)
    return _document(record)


def get_document(document_id: str, owner_id: str) -> KnowledgeDocument | None:
    with session_scope() as session:
        record = session.scalar(select(KnowledgeDocumentRecord).where(
            KnowledgeDocumentRecord.id == document_id,
            KnowledgeDocumentRecord.owner_id == owner_id,
        ))
        return _document(record) if record else None


def get_document_by_hash(owner_id: str, sha256: str) -> KnowledgeDocument | None:
    with session_scope() as session:
        record = session.scalar(select(KnowledgeDocumentRecord).where(
            KnowledgeDocumentRecord.owner_id == owner_id,
            KnowledgeDocumentRecord.sha256 == sha256,
        ))
        return _document(record) if record else None


def list_documents(owner_id: str) -> list[KnowledgeDocument]:
    with session_scope() as session:
        records = list(session.scalars(select(KnowledgeDocumentRecord).where(
            KnowledgeDocumentRecord.owner_id == owner_id
        ).order_by(KnowledgeDocumentRecord.created_at.desc())))
        return [_document(record) for record in records]


def update_document(document_id: str, owner_id: str, **fields) -> KnowledgeDocument | None:
    allowed = {"status", "chunk_count", "error_code", "stored_file_id", "title"}
    values = {key: value for key, value in fields.items() if key in allowed}
    values["updated_at"] = time.time()
    with session_scope() as session:
        record = session.scalar(select(KnowledgeDocumentRecord).where(
            KnowledgeDocumentRecord.id == document_id, KnowledgeDocumentRecord.owner_id == owner_id
        ))
        if record is None:
            return None
        for key, value in values.items():
            setattr(record, key, value)
        session.flush()
        return _document(record)


def replace_document_chunks(document_id: str, chunks: list[str]) -> None:
    with session_scope() as session:
        session.execute(delete(KnowledgeChunkRecord).where(KnowledgeChunkRecord.document_id == document_id))
        session.add_all([
            KnowledgeChunkRecord(id=f"chunk_{uuid.uuid4().hex[:16]}", document_id=document_id,
                                 chunk_index=index, content=content,
                                 chunk_metadata={}, token_count=len(content.split()))
            for index, content in enumerate(chunks)
        ])
        record = session.get(KnowledgeDocumentRecord, document_id)
        if record:
            record.chunk_count = len(chunks)
            record.status = "ready"
            record.error_code = None
            record.updated_at = time.time()


def list_selected_documents(assignment_id: str, owner_id: str) -> list[KnowledgeDocument]:
    """Personal documents selected for an assignment.

    Teacher ownership is resolved through the assignment; the selection itself
    lives in ``assignment_knowledge_documents`` (replacing the legacy
    task-scoped table). Only ready documents are returned so retrieval never
    surfaces a document still being parsed.
    """
    with session_scope() as session:
        records = list(session.scalars(
            select(KnowledgeDocumentRecord)
            .join(AssignmentKnowledgeDocumentRecord,
                  AssignmentKnowledgeDocumentRecord.document_id == KnowledgeDocumentRecord.id)
            .join(AssignmentRecord, AssignmentRecord.id == AssignmentKnowledgeDocumentRecord.assignment_id)
            .where(AssignmentKnowledgeDocumentRecord.assignment_id == assignment_id,
                   AssignmentRecord.teacher_id == owner_id,
                   KnowledgeDocumentRecord.owner_id == owner_id,
                   KnowledgeDocumentRecord.status == "ready")
            .order_by(AssignmentKnowledgeDocumentRecord.selected_at)
        ))
        return [_document(record) for record in records]


def list_chunks(document_ids: list[str]) -> list[KnowledgeChunkRecord]:
    if not document_ids:
        return []
    with session_scope() as session:
        return list(session.scalars(select(KnowledgeChunkRecord).where(
            KnowledgeChunkRecord.document_id.in_(document_ids)
        ).order_by(KnowledgeChunkRecord.document_id, KnowledgeChunkRecord.chunk_index)))


def set_task_documents(*, assignment_id: str, owner_id: str, document_ids: list[str]) -> list[KnowledgeDocument]:
    """Select up to three ready personal documents for an assignment.

    Name kept for import compatibility while the retriever/API migrate to the
    assignment scope (Task 6). Ownership is checked through the assignment.
    """
    with session_scope() as session:
        assignment = session.scalar(
            select(AssignmentRecord).where(
                AssignmentRecord.id == assignment_id, AssignmentRecord.teacher_id == owner_id
            )
        )
        if assignment is None:
            raise ValueError("Assignment not found")
        unique_ids = list(dict.fromkeys(document_ids))
        if len(unique_ids) > 3:
            raise ValueError("An assignment can select at most 3 personal knowledge documents")
        if unique_ids:
            valid = set(session.scalars(select(KnowledgeDocumentRecord.id).where(
                KnowledgeDocumentRecord.id.in_(unique_ids), KnowledgeDocumentRecord.owner_id == owner_id,
                KnowledgeDocumentRecord.status == "ready"
            )))
            if valid != set(unique_ids):
                raise ValueError("One or more knowledge documents are unavailable")
        session.execute(delete(AssignmentKnowledgeDocumentRecord).where(
            AssignmentKnowledgeDocumentRecord.assignment_id == assignment_id
        ))
        session.add_all([AssignmentKnowledgeDocumentRecord(assignment_id=assignment_id, document_id=document_id)
                         for document_id in unique_ids])
    return list_selected_documents(assignment_id, owner_id)


def delete_document(document_id: str, owner_id: str) -> KnowledgeDocument | None:
    with session_scope() as session:
        record = session.scalar(select(KnowledgeDocumentRecord).where(
            KnowledgeDocumentRecord.id == document_id, KnowledgeDocumentRecord.owner_id == owner_id
        ))
        if record is None:
            return None
        result = _document(record)
        session.execute(delete(AssignmentKnowledgeDocumentRecord).where(
            AssignmentKnowledgeDocumentRecord.document_id == document_id
        ))
        session.execute(delete(KnowledgeChunkRecord).where(KnowledgeChunkRecord.document_id == document_id))
        session.delete(record)
        return result
