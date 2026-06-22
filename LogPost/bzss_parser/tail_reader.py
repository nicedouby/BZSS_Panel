#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional

from bzss_parser.source_state_store import SourceStateStore


class TailReader:
    def __init__(
        self,
        log_file: str,
        from_end: bool,
        reopen_on_truncate: bool,
        state_store: Optional[SourceStateStore] = None,
    ) -> None:
        self.log_path = Path(log_file)
        self.from_end = from_end
        self.reopen_on_truncate = reopen_on_truncate
        self.state_store = state_store

        self.file: Optional[BinaryIO] = None
        self.position = 0
        self.partial = b""
        self.partial_offset = 0
        self._last_missing_warn = 0.0
        self.file_id = ""
        self.last_rotate_reason = ""
        self.state: Dict[str, Any] = self.state_store.load() if self.state_store else {}

    def open(self) -> bool:
        if not self.log_path.exists():
            now = time.time()

            if now - self._last_missing_warn > 5:
                print(f"[WARN] Log file not found: {self.log_path}")
                self._last_missing_warn = now

            return False

        self.file = self.log_path.open("rb")
        stat = self.log_path.stat()
        current_size = stat.st_size
        self.file_id = self._make_file_id(stat)
        restored = False

        saved_offset = int(self.state.get("offset", 0) or 0)
        saved_source = str(self.state.get("sourcePath", "") or "")
        saved_file_id = str(self.state.get("fileId", "") or "")

        if saved_source == str(self.log_path) and saved_offset > 0:
            if current_size < saved_offset:
                self.last_rotate_reason = "truncated_or_rotated"
                self.file.seek(0, os.SEEK_SET)
            elif saved_file_id and saved_file_id == self.file_id:
                self.file.seek(saved_offset, os.SEEK_SET)
                restored = True
            elif saved_file_id:
                self.last_rotate_reason = "file_replaced"
                self.file.seek(0, os.SEEK_SET)
            elif self.from_end:
                self.file.seek(0, os.SEEK_END)
            else:
                self.file.seek(saved_offset, os.SEEK_SET)
                restored = True
        elif self.from_end:
            self.file.seek(0, os.SEEK_END)
        else:
            self.file.seek(0, os.SEEK_SET)

        self.position = self.file.tell()
        self.partial = b""
        self.partial_offset = self.position

        print(
            f"[INFO] Tailing: {self.log_path} from position {self.position}"
            f"{' (restored)' if restored else ''}"
        )
        return True

    def close(self) -> None:
        if self.file:
            try:
                self.file.close()
            except Exception:
                pass

        self.file = None

    def read_new_lines(self) -> List[Dict[str, Any]]:
        if self.file is None:
            if not self.open():
                return []

        if self.file is None:
            return []

        try:
            current_size = self.log_path.stat().st_size
        except FileNotFoundError:
            self.close()
            return []

        if self.reopen_on_truncate and current_size < self.position:
            print("[INFO] Log file truncated or recreated. Reopening.")
            self.last_rotate_reason = "truncated_or_rotated"
            self.close()
            self.open()
            return []

        self.file.seek(self.position)
        start_offset = self.position
        data = self.file.read()
        self.position = self.file.tell()

        if not data:
            return []

        blob = self.partial + data
        blob_start = self.partial_offset if self.partial else start_offset
        records: List[Dict[str, Any]] = []
        cursor = 0

        while True:
            newline_index = blob.find(b"\n", cursor)
            if newline_index < 0:
                break

            line_bytes = blob[cursor:newline_index]
            if line_bytes.endswith(b"\r"):
                line_bytes = line_bytes[:-1]

            line = line_bytes.decode("utf-8", errors="replace")
            line_offset = blob_start + cursor
            cursor = newline_index + 1
            if not line.strip():
                continue
            records.append({
                "line": line,
                "offset": line_offset,
                "sourcePath": str(self.log_path),
                "fileId": self.file_id,
            })

        if cursor >= len(blob):
            self.partial = b""
            self.partial_offset = self.position
        else:
            self.partial = blob[cursor:]
            self.partial_offset = blob_start + cursor

        return records

    def persist_state(self, seq: int) -> Dict[str, Any]:
        if not self.state_store:
            return {}

        self.state = self.state_store.save(
            source_path=str(self.log_path),
            file_id=self.file_id,
            offset=self.position,
            seq=seq,
        )
        return self.state

    def rewind_to_offset(self, offset: int) -> None:
        if self.file is None:
            return
        self.file.seek(max(0, int(offset)), os.SEEK_SET)
        self.position = self.file.tell()
        self.partial = b""
        self.partial_offset = self.position

    def consume_rotate_reason(self) -> str:
        reason = self.last_rotate_reason
        self.last_rotate_reason = ""
        return reason

    @staticmethod
    def _make_file_id(stat_result: os.stat_result) -> str:
        inode = getattr(stat_result, "st_ino", 0)
        dev = getattr(stat_result, "st_dev", 0)
        ctime_ns = getattr(stat_result, "st_ctime_ns", int(stat_result.st_ctime * 1_000_000_000))
        return f"{dev}:{inode}:{ctime_ns}"
