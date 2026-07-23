from __future__ import annotations

import struct
import zlib

import pytest

from backend.tools.file_processing import extract_files_from_archive


def _stored_zip(raw_name: bytes, body: bytes) -> bytes:
    crc = zlib.crc32(body) & 0xFFFFFFFF
    local = struct.pack(
        "<IHHHHHIIIHH",
        0x04034B50,
        20,
        0,
        0,
        0,
        0,
        crc,
        len(body),
        len(body),
        len(raw_name),
        0,
    )
    local_block = local + raw_name + body
    central = struct.pack(
        "<IHHHHHHIIIHHHHHII",
        0x02014B50,
        20,
        20,
        0,
        0,
        0,
        0,
        crc,
        len(body),
        len(body),
        len(raw_name),
        0,
        0,
        0,
        0,
        0,
        0,
    )
    central_block = central + raw_name
    end = struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        1,
        1,
        len(central_block),
        len(local_block),
        0,
    )
    return local_block + central_block + end


@pytest.mark.asyncio
async def test_extract_zip_repairs_gbk_name_decoded_as_cp437():
    raw_name = "PB20241669_卫六_作业2.txt".encode("gbk")
    archive = _stored_zip(raw_name, "姓名：卫六\n答案：A\n".encode("utf-8"))

    files = await extract_files_from_archive(archive, "students.zip")

    assert files == [
        {
            "filename": "PB20241669_卫六_作业2.txt",
            "content": "姓名：卫六\n答案：A\n",
        }
    ]


@pytest.mark.asyncio
async def test_extract_7z_with_current_py7zr_api(tmp_path):
    py7zr = pytest.importorskip("py7zr")
    archive_path = tmp_path / "students.7z"
    with py7zr.SevenZipFile(archive_path, "w") as archive:
        archive.writestr("姓名：卫六\n答案：A\n", "PB20241669_卫六.txt")

    files = await extract_files_from_archive(archive_path.read_bytes(), archive_path.name)

    assert files == [
        {
            "filename": "PB20241669_卫六.txt",
            "content": "姓名：卫六\n答案：A\n",
        }
    ]
