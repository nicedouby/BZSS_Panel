#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path
from typing import Dict

from bzss_parser.helpers import extract_log_time, now_time_string, today_string, to_json_line


class LogPostWriter:
    def __init__(self, output_dir: str) -> None:
        self.output_dir = Path(output_dir)

    def write_event(self, event: Dict[str, str]) -> None:
        date_dir = self.output_dir / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)

        event_name = event.get("Event", "Unknown")
        line = to_json_line(event) + "\n"

        self._append(date_dir / "All.jsonl", line)
        self._append(date_dir / f"{event_name}.jsonl", line)

    def write_unknown(self, raw: str) -> None:
        date_dir = self.output_dir / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)

        obj = {
            "Version": "1",
            "Event": "Unknown",
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "Raw": raw,
        }

        self._append(date_dir / "Unknown.jsonl", to_json_line(obj) + "\n")

    def write_parse_error(self, raw: str, error: str) -> None:
        date_dir = self.output_dir / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)

        obj = {
            "Version": "1",
            "Event": "ParseError",
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "Error": error,
            "Raw": raw,
        }

        self._append(date_dir / "ParseError.jsonl", to_json_line(obj) + "\n")

    @staticmethod
    def _append(path: Path, text: str) -> None:
        with path.open("a", encoding="utf-8", newline="") as f:
            f.write(text)
            f.flush()
