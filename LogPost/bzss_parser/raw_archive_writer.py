#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from bzss_parser.helpers import extract_log_time, now_time_string, sha1_hex, today_string, to_json_line


class RawArchiveWriter:
    def __init__(self, output_dir: str) -> None:
        self.output_dir = Path(output_dir)

    def write(
        self,
        *,
        seq: int,
        offset: int,
        raw_line: str,
        source_path: str,
    ) -> Dict[str, Any]:
        read_at = now_time_string()
        entry = {
            "seq": max(0, int(seq)),
            "offset": max(0, int(offset)),
            "readAt": read_at,
            "logTime": extract_log_time(raw_line),
            "rawLine": str(raw_line or ""),
            "rawLineHash": sha1_hex(raw_line),
            "sourcePath": str(source_path or ""),
        }

        date_dir = self.output_dir / "Raw" / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)
        with (date_dir / "all.jsonl").open("a", encoding="utf-8", newline="") as f:
            f.write(to_json_line(entry) + "\n")
            f.flush()

        return entry
