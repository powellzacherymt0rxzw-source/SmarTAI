"""
File processing tool: extract text files from archives (.zip, .rar, .7z, .tar.*)
or handle a single file.

Migrated from backend/utils.py with no behavior change — just relocated to
the tools/ namespace so it's discoverable as a "predefined tool" per docs §4.2.1.
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
from pathlib import Path
import sys
import tarfile
import threading
import zipfile
from typing import List, Dict, Optional

try:
    import rarfile
except ImportError:
    rarfile = None

try:
    import py7zr
except ImportError:
    py7zr = None

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

from fastapi import HTTPException

logger = logging.getLogger(__name__)

PDF_MAX_PAGES = 100
PDF_MAX_CHARACTERS = 500_000
PDF_EXTRACTION_TIMEOUT_SECONDS = 10.0
PDF_EXTRACTION_MAX_WORKERS = 2
_PDF_EXTRACTION_SLOTS = threading.BoundedSemaphore(PDF_EXTRACTION_MAX_WORKERS)
_PDF_WORKER_PATH = Path(__file__).with_name("_pdf_worker.py")


async def decode_text_bytes(text_bytes: bytes) -> str:
    """Try UTF-8 then GBK; raise 400 if both fail."""
    try:
        return text_bytes.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return text_bytes.decode("gbk")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=400,
                detail="Unable to decode file; please ensure UTF-8 or GBK encoding.",
            )


async def extract_text_from_pdf(
    pdf_bytes: bytes,
    *,
    max_pages: int = PDF_MAX_PAGES,
    max_characters: int = PDF_MAX_CHARACTERS,
    timeout_seconds: float = PDF_EXTRACTION_TIMEOUT_SECONDS,
) -> str:
    """Extract PDF text in a killable subprocess with hard resource ceilings."""

    if fitz is None:
        raise HTTPException(
            status_code=501,
            detail="PDF processing requires 'PyMuPDF'; pip install PyMuPDF"
        )
    if not _PDF_EXTRACTION_SLOTS.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail={"code": "pdf_extraction_busy"},
        )
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            str(_PDF_WORKER_PATH),
            str(max_pages),
            str(max_characters),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            stdout, _ = await asyncio.wait_for(
                process.communicate(pdf_bytes),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.wait()
            logger.warning("PDF extraction timed out")
            raise HTTPException(
                status_code=408,
                detail={
                    "code": "pdf_extraction_timeout",
                    "timeout_seconds": timeout_seconds,
                },
            ) from exc

        try:
            payload = json.loads(stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=400,
                detail={"code": "pdf_extraction_failed"},
            ) from exc
        worker_status = payload.get("status")
        if worker_status == "ok":
            return str(payload.get("text", ""))
        if worker_status == "page_limit":
            raise HTTPException(
                status_code=413,
                detail={"code": "pdf_page_limit_exceeded", "max_pages": max_pages},
            )
        if worker_status == "character_limit":
            raise HTTPException(
                status_code=413,
                detail={
                    "code": "pdf_character_limit_exceeded",
                    "max_characters": max_characters,
                },
            )
        raise HTTPException(
            status_code=400,
            detail={"code": "pdf_extraction_failed"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        logger.warning(
            "PDF extraction failed; exception_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status_code=400,
            detail={"code": "pdf_extraction_failed"},
        ) from exc
    finally:
        _PDF_EXTRACTION_SLOTS.release()


def _is_valid_file(name: str) -> bool:
    """Filter out OS junk files."""
    return not (name.startswith("__MACOSX") or ".DS_Store" in name)


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _looks_like_cp437_mojibake(text: str) -> bool:
    return any(0x2500 <= ord(ch) <= 0x259F for ch in text)


def _repair_zip_member_name(name: str) -> str:
    """Repair GBK zip member names that Python decoded as CP437 mojibake."""
    if _has_cjk(name) or not _looks_like_cp437_mojibake(name):
        return name
    try:
        repaired = name.encode("cp437").decode("gbk")
    except UnicodeError:
        return name
    return repaired if _has_cjk(repaired) else name


async def extract_files_from_archive(file_bytes: bytes, filename: str) -> List[Dict[str, str]]:
    """
    Extract all text files from an archive (zip/rar/7z/tar.*) or wrap a single
    file into the same [{"filename": ..., "content": ...}] format.
    """
    files_data: List[Dict[str, str]] = []
    file_in_memory = io.BytesIO(file_bytes)
    lower = filename.lower()

    if lower.endswith(".zip"):
        with zipfile.ZipFile(file_in_memory, "r") as zf:
            valid = [i for i in zf.infolist() if not i.is_dir() and _is_valid_file(i.filename)]

            async def process(info):
                clean = _repair_zip_member_name(info.filename).split("/")[-1]
                content = await decode_text_bytes(zf.read(info.filename))
                return {"filename": clean, "content": content}

            files_data.extend(await asyncio.gather(*[process(i) for i in valid]))

    elif lower.endswith(".rar"):
        if rarfile is None:
            raise ValueError("Processing .rar files requires 'rarfile'; pip install rarfile")
        try:
            with rarfile.RarFile(file_in_memory, "r") as rf:
                valid = [i for i in rf.infolist() if not i.is_dir() and _is_valid_file(i.filename)]

                async def process(info):
                    clean = info.filename.split("/")[-1]
                    content = await decode_text_bytes(rf.read(info.filename))
                    return {"filename": clean, "content": content}

                files_data.extend(await asyncio.gather(*[process(i) for i in valid]))
        except rarfile.UNRARError as e:
            raise RuntimeError(
                f"RAR extraction failed: {e}. Ensure 'unrar' CLI is installed on the server."
            )

    elif lower.endswith(".7z"):
        if py7zr is None:
            raise ValueError("Processing .7z files requires 'py7zr'; pip install py7zr")
        with py7zr.SevenZipFile(file_in_memory, "r") as szf:
            all_files = szf.readall()
            valid = {n: bio for n, bio in all_files.items() if _is_valid_file(n)}

            async def process(item):
                n, bio = item
                clean = n.split("/")[-1]
                content = await decode_text_bytes(bio.read())
                return {"filename": clean, "content": content}

            files_data.extend(await asyncio.gather(*[process(i) for i in valid.items()]))

    elif lower.endswith((".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2")):
        with tarfile.open(fileobj=file_in_memory, mode="r:*") as tf:
            valid = [m for m in tf.getmembers() if m.isfile() and _is_valid_file(m.name)]

            async def process(member):
                clean = member.name.split("/")[-1]
                obj = tf.extractfile(member)
                if obj is None:
                    return None
                content = await decode_text_bytes(obj.read())
                return {"filename": clean, "content": content}

            results = await asyncio.gather(*[process(m) for m in valid])
            files_data.extend([r for r in results if r is not None])

    else:
        if lower.endswith(".txt"):
            files_data.append({
                "filename": filename,
                "content": await decode_text_bytes(file_bytes),
            })
        else:
            logger.warning(f"Ignoring unsupported single-file type: {filename}")

    return files_data
