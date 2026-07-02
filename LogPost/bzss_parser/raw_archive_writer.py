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
        source_mode: str = "live",
    ) -> Dict[str, Any]:
        read_at = now_time_string()
        entry = {
            "schema": "logpost.raw.v2",
            "seq": max(0, int(seq)),
            "offset": max(0, int(offset)),
            "readAt": read_at,
            "logTime": extract_log_time(raw_line),
            "rawLine": str(raw_line or ""),
            "rawLineHash": sha1_hex(raw_line),
            "sourcePath": str(source_path or ""),
            "sourceMode": str(source_mode or "live"),
        }

        date_dir = self.output_dir / "Raw" / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)
        v2_dir = self.output_dir / "raw" / today_string()
        v2_dir.mkdir(parents=True, exist_ok=True)

        line = to_json_line(entry) + "\n"
        with (date_dir / "all.jsonl").open("a", encoding="utf-8", newline="") as f:
            f.write(line)
            f.flush()
        with (v2_dir / "segment-000001.jsonl").open("a", encoding="utf-8", newline="") as f:
            f.write(line)
            f.flush()
        with (v2_dir / "index.json").open("w", encoding="utf-8", newline="") as f:
            f.write(to_json_line({
                "schema": "logpost.raw.index.v2",
                "updatedAt": read_at,
                "segments": [
                    {
                        "fileName": "segment-000001.jsonl",
                        "countHint": None,
                    }
                ],
            }) + "\n")

        return entry
