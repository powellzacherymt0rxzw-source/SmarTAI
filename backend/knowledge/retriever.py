from __future__ import annotations

from typing import Optional

import numpy as np

from backend.db.knowledge_repository import list_chunks, list_selected_documents
from backend.rag.embedder import BM25Embedder
from backend.rag.store import InMemoryTaskRetriever
from backend.tools.knowledge import KnowledgeChunk, KnowledgeRetriever


class PersistentKnowledgeRetriever(KnowledgeRetriever):
    """Read selected user documents from the database and rank chunks with BM25."""

    async def retrieve(self, query: str, k: int = 5, *, scope: Optional[str] = None) -> list[KnowledgeChunk]:
        if not query or not scope:
            return []
        documents = list_selected_documents_for_scope(scope)
        chunks = list_chunks([document.id for document in documents])
        if not chunks:
            return []
        scores = await BM25Embedder().score(query, np.zeros((len(chunks), 1), dtype=np.float32),
                                            chunk_texts=[chunk.content for chunk in chunks])
        if not np.any(scores > 0):
            query_terms = set(query.lower().split())
            scores = np.asarray([
                len(query_terms.intersection(set(chunk.content.lower().split()))) / max(1, len(query_terms))
                for chunk in chunks
            ], dtype=np.float32)
        top = np.argsort(-scores)[:max(0, int(k))]
        names = {document.id: document.original_name for document in documents}
        return [KnowledgeChunk(content=chunks[int(index)].content,
                               source=names.get(chunks[int(index)].document_id, "knowledge"),
                               score=float(scores[int(index)]))
                for index in top if float(scores[int(index)]) > 0]


class CombinedKnowledgeRetriever(InMemoryTaskRetriever):
    """Keep existing task uploads while adding persistent personal documents."""

    def __init__(self) -> None:
        super().__init__()
        self._persistent = PersistentKnowledgeRetriever()

    async def retrieve(self, query: str, k: int = 5, *, scope: Optional[str] = None) -> list[KnowledgeChunk]:
        transient = await super().retrieve(query, k, scope=scope)
        persistent = await self._persistent.retrieve(query, k, scope=scope)
        return sorted(transient + persistent, key=lambda item: item.score, reverse=True)[:max(0, int(k))]


def list_selected_documents_for_scope(scope: str):
    """Resolve an assignment scope to its teacher owner without exposing cross-user documents."""
    from backend.db.session import session_scope
    from backend.db.models import AssignmentRecord
    from sqlalchemy import select
    with session_scope() as session:
        assignment = session.scalar(select(AssignmentRecord).where(AssignmentRecord.id == scope))
        if assignment is None:
            return []
        owner_id = assignment.teacher_id
    return list_selected_documents(scope, owner_id)
