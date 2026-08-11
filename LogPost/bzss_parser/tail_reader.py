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
        read_chunk_bytes: int = 1024 * 1024,
        max_recovery_bytes: int = 8 * 1024 * 1024,
        max_line_bytes: int = 1024 * 1024,
    ) -> None:
        self.log_path = Path(log_file)
        self.from_end = from_end
        self.reopen_on_truncate = reopen_on_truncate
        self.state_store = state_store
        self.read_chunk_bytes = max(4096, int(read_chunk_bytes))
        self.max_recovery_bytes = max(0, int(max_recovery_bytes))
        self.max_line_bytes = max(4096, int(max_line_bytes))

        self.file: Optional[BinaryIO] = None
        self.position = 0
        self.partial = b""
        self.partial_offset = 0
        self._oversized_line_prefix = b""
        self._oversized_line_offset = 0
        self._discarding_oversized_line = False
        self._last_missing_warn = 0.0
        self.file_id = ""
        self.last_rotate_reason = ""
        self._pending_reopen_reason = ""
        self._reopen_ready = False
        self.last_recovery_skipped_bytes = 0
        self.current_mode = "live"
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
        self.current_mode = "live"

        saved_offset = int(self.state.get("offset", 0) or 0)
        saved_source = str(self.state.get("sourcePath", "") or "")
        saved_file_id = str(self.state.get("fileId", "") or "")

        same_source = saved_source == str(self.log_path)
        same_file = not saved_file_id or self._file_ids_match(saved_file_id, self.file_id)

        if same_source and saved_offset > 0:
            if not same_file:
                self.last_rotate_reason = "file_replaced"
                self.current_mode = "recovery"
                self._seek_recovery_window(current_size)
            elif current_size < saved_offset:
                self.last_rotate_reason = "truncated_or_rotated"
                self.current_mode = "recovery"
                self._seek_recovery_window(current_size)
            elif self.max_recovery_bytes and current_size - saved_offset > self.max_recovery_bytes:
                self.last_rotate_reason = "checkpoint_too_old"
                self.current_mode = "recovery"
                self._seek_recovery_window(current_size)
            else:
                self.file.seek(saved_offset, os.SEEK_SET)
                restored = True
        elif self.from_end:
            self.file.seek(0, os.SEEK_END)
        else:
            self.file.seek(0, os.SEEK_SET)
            restored = True

        self.position = self.file.tell()
        self.partial = b""
        self.partial_offset = self.position
        self._reset_oversized_line()

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
        # A replaced path can still have unread bytes in the old open handle.
        # Reopen only on the call after those records have been returned, so
        # their checkpoints are persisted with the old file identity.
        if self._reopen_ready:
            reason = self._pending_reopen_reason or "file_replaced"
            self._pending_reopen_reason = ""
            self._reopen_ready = False
            self.close()
            self.open()
            self.last_rotate_reason = reason
            return []

        if self.file is None:
            if not self.open():
                return []

        if self.file is None:
            return []

        if self._pending_reopen_reason:
            try:
                current_size = os.fstat(self.file.fileno()).st_size
            except OSError:
                self._reopen_ready = True
                return []
            replaced = True
        else:
            try:
                current_stat = self.log_path.stat()
                current_size = current_stat.st_size
            except FileNotFoundError:
                self.close()
                return []

            current_file_id = self._make_file_id(current_stat)
            replaced = bool(self.file_id and current_file_id != self.file_id)
        truncated = current_size < self.position
        if self.reopen_on_truncate and replaced:
            if not self._pending_reopen_reason:
                print("[INFO] Log file recreated. Draining unread bytes before reopening.")
                self._pending_reopen_reason = "file_replaced"
                try:
                    current_size = os.fstat(self.file.fileno()).st_size
                except OSError:
                    current_size = self.position
            if current_size <= self.position:
                self._reopen_ready = True
                return []
        elif self.reopen_on_truncate and truncated:
            print("[INFO] Log file truncated or recreated. Reopening.")
            self.last_rotate_reason = "truncated_or_rotated"
            self.close()
            self.open()
            return []

        self.file.seek(self.position)
        start_offset = self.position
        data = self.file.read(self.read_chunk_bytes)
        self.position = self.file.tell()

        if not data:
            if self.current_mode == "recovery":
                self.current_mode = "live"
            return []

        records: List[Dict[str, Any]] = []
        if self._discarding_oversized_line:
            newline_index = data.find(b"\n")
            if newline_index < 0:
                return []
            records.append(self._make_record(
                self._oversized_line_prefix,
                self._oversized_line_offset,
                start_offset + newline_index + 1,
                truncated=True,
            ))
            data = data[newline_index + 1:]
            start_offset += newline_index + 1
            self._reset_oversized_line()

        blob = self.partial + data
        blob_start = self.partial_offset if self.partial else start_offset
        cursor = 0

        while True:
            newline_index = blob.find(b"\n", cursor)
            if newline_index < 0:
                break

            line_bytes = blob[cursor:newline_index]
            if line_bytes.endswith(b"\r"):
                line_bytes = line_bytes[:-1]
            line_offset = blob_start + cursor
            cursor = newline_index + 1
            if not line_bytes.strip():
                continue
            records.append(self._make_record(
                line_bytes[:self.max_line_bytes],
                line_offset,
                blob_start + cursor,
                truncated=len(line_bytes) > self.max_line_bytes,
            ))

        if cursor >= len(blob):
            self.partial = b""
            self.partial_offset = self.position
        else:
            self.partial = blob[cursor:]
            self.partial_offset = blob_start + cursor
            if len(self.partial) > self.max_line_bytes:
                self._oversized_line_prefix = self.partial[:self.max_line_bytes]
                self._oversized_line_offset = self.partial_offset
                self._discarding_oversized_line = True
                self.partial = b""

        if self._pending_reopen_reason and self.position >= current_size:
            self._reopen_ready = True

        return records

    def persist_state(
        self,
        seq: int,
        offset: Optional[int] = None,
        *,
        last_raw_line_hash: str = "",
        last_log_time: str = "",
        file_size: Optional[int] = None,
        file_mtime_ms: Optional[int] = None,
        mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not self.state_store:
            return {}

        commit_offset = self.position if offset is None else max(0, int(offset))
        self.state = self.state_store.save(
            source_path=str(self.log_path),
            file_id=self.file_id,
            offset=commit_offset,
            seq=seq,
            mode=str(mode or self.current_mode or "live"),
            file_size=file_size,
            file_mtime_ms=file_mtime_ms,
            last_raw_line_hash=last_raw_line_hash,
            last_log_time=last_log_time,
        )
        return self.state

    def rewind_to_offset(self, offset: int) -> None:
        if self.file is None:
            return
        self.file.seek(max(0, int(offset)), os.SEEK_SET)
        self.position = self.file.tell()
        self.partial = b""
        self.partial_offset = self.position
        self._reset_oversized_line()

    def consume_rotate_reason(self) -> str:
        reason = self.last_rotate_reason
        self.last_rotate_reason = ""
        return reason

    @staticmethod
    def _make_file_id(stat_result: os.stat_result) -> str:
        inode = getattr(stat_result, "st_ino", 0)
        dev = getattr(stat_result, "st_dev", 0)
        if inode:
            return f"{dev}:{inode}"
        ctime_ns = getattr(stat_result, "st_ctime_ns", int(stat_result.st_ctime * 1_000_000_000))
        return f"{dev}:0:{ctime_ns}"

    def _seek_recovery_window(self, current_size: int) -> None:
        if self.file is None:
            return
        self.last_recovery_skipped_bytes = 0
        if not self.max_recovery_bytes or current_size <= self.max_recovery_bytes:
            self.file.seek(0, os.SEEK_SET)
            return

        self.file.seek(current_size - self.max_recovery_bytes, os.SEEK_SET)
        # The recovery window can start in the middle of an UTF-8 log line.
        # Drop only that incomplete line; every complete line after it is kept.
        while True:
            fragment = self.file.readline(self.max_line_bytes)
            if not fragment or fragment.endswith(b"\n"):
                break
        self.last_recovery_skipped_bytes = self.file.tell()

    def _make_record(
        self,
        line_bytes: bytes,
        offset: int,
        next_offset: int,
        *,
        truncated: bool = False,
    ) -> Dict[str, Any]:
        line = line_bytes.decode("utf-8", errors="replace")
        if truncated:
            line += "...[LINE_TRUNCATED]"
        return {
            "line": line,
            "offset": offset,
            "next_offset": next_offset,
            "sourcePath": str(self.log_path),
            "fileId": self.file_id,
            "sourceMode": self.current_mode,
            "lineTruncated": truncated,
        }

    def _reset_oversized_line(self) -> None:
        self._oversized_line_prefix = b""
        self._oversized_line_offset = 0
        self._discarding_oversized_line = False

    @staticmethod
    def _file_ids_match(saved_file_id: str, current_file_id: str) -> bool:
        if saved_file_id == current_file_id:
            return True
        # Before v2, ctime was appended to dev:inode. Accept that state once so
        # deployment does not replay the recovery window solely due to upgrade.
        return bool(current_file_id and saved_file_id.startswith(current_file_id + ":"))
