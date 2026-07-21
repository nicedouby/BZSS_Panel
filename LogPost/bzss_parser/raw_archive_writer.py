#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path
import time
from typing import Any, Dict

from bzss_parser.buffered_file_writer import BufferedWriterRegistry, write_text_atomic
from bzss_parser.helpers import extract_log_time, now_time_string, sha1_hex, today_string, to_json_line


class RawArchiveWriter:
    def __init__(
        self,
        output_dir: str,
        *,
        write_v2_raw_archive: bool = True,
        write_legacy_raw_archive: bool = False,
        flush_interval_ms: int = 75,
        batch_bytes: int = 128 * 1024,
        index_interval_ms: int = 5000,
        index_batch_bytes: int = 1024 * 1024,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.write_v2_raw_archive = bool(write_v2_raw_archive)
        self.write_legacy_raw_archive = bool(write_legacy_raw_archive)
        self._writers = BufferedWriterRegistry(flush_interval_ms=flush_interval_ms, batch_bytes=batch_bytes)
        self.index_interval_s = max(0.1, int(index_interval_ms) / 1000.0)
        self.index_batch_bytes = max(4096, int(index_batch_bytes))
        self._index_path = None
        self._index_dirty = False
        self._segment_bytes = 0
        self._last_index_write = 0.0

    def write(
        self,
        *,
        seq: int,
        offset: int,
        raw_line: str,
        source_path: str,
        source_mode: str = "live",
        log_time: str | None = None,
        raw_line_hash: str | None = None,
    ) -> Dict[str, Any]:
        read_at = now_time_string()
        entry = {
            "schema": "logpost.raw.v2",
            "seq": max(0, int(seq)),
            "offset": max(0, int(offset)),
            "readAt": read_at,
            "logTime": str(log_time) if log_time is not None else extract_log_time(raw_line),
            "rawLine": str(raw_line or ""),
            "rawLineHash": str(raw_line_hash) if raw_line_hash is not None else sha1_hex(raw_line),
            "sourcePath": str(source_path or ""),
            "sourceMode": str(source_mode or "live"),
        }

        line = to_json_line(entry) + "\n"
        if self.write_legacy_raw_archive:
            date_dir = self.output_dir / "Raw" / today_string()
            self._writers.get(date_dir / "all.jsonl").write(line)

        if self.write_v2_raw_archive:
            v2_dir = self.output_dir / "raw" / today_string()
            segment_path = v2_dir / "segment-000001.jsonl"
            index_path = v2_dir / "index.json"
            if self._index_path != index_path:
                self._index_path = index_path
                self._segment_bytes = 0
                self._last_index_write = 0.0
            self._writers.get(segment_path).write(line)
            self._segment_bytes += len(line.encode("utf-8"))
            self._index_dirty = True

        return entry

    def _write_index_if_needed(self, *, force: bool) -> None:
        if not self._index_dirty or self._index_path is None:
            return
        now = time.monotonic()
        if not force and now - self._last_index_write < self.index_interval_s and self._segment_bytes < self.index_batch_bytes:
            return

        self._index_path.parent.mkdir(parents=True, exist_ok=True)
        payload = to_json_line({
            "schema": "logpost.raw.index.v2",
            "updatedAt": now_time_string(),
            "segments": [{
                "fileName": "segment-000001.jsonl",
                "countHint": None,
                "sizeBytes": self._segment_bytes,
            }],
        }) + "\n"
        write_text_atomic(self._index_path, payload)
        self._index_dirty = False
        self._last_index_write = now

    def flush_data(self, force: bool = False) -> None:
        """Flush raw segment data without rewriting the index."""
        self._writers.flush_all(force=force)

    def flush_index(self, force: bool = False) -> None:
        """Write the small index file on its own cadence."""
        self._write_index_if_needed(force=force)

    def flush_all(self, force: bool = False) -> None:
        # Compatibility API for callers outside the parser.
        self.flush_data(force=force)
        self.flush_index(force=force)

    def close(self) -> None:
        self.flush_data(force=True)
        self.flush_index(force=True)
        self._writers.close()
