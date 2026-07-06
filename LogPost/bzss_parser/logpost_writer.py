#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

from bzss_parser.helpers import extract_log_time, now_time_string, today_string, to_json_line


class LogPostWriter:
    def __init__(
        self,
        output_dir: str,
        *,
        write_v2_events: bool = True,
        write_legacy_events: bool = False,
    ) -> None:
        self.output_dir = Path(output_dir)
        self.preserved_file_name = "Preserved.jsonl"
        self._raw_segment_name = "segment-000001.jsonl"
        self.write_v2_events = bool(write_v2_events)
        self.write_legacy_events = bool(write_legacy_events)

    def write_event(self, event: Dict[str, str]) -> None:
        line = to_json_line(event) + "\n"
        self._write_event_line(line, event)

    def write_unknown(self, raw: str, meta: Dict[str, str] | None = None) -> None:
        obj = {
            "Version": "1",
            "Event": "Unknown",
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "Raw": raw,
        }
        if meta:
            obj.update(meta)

        self._write_event_line(to_json_line(obj) + "\n", obj)

    def write_preserved(self, raw: str, matched_rule: str = "") -> None:
        obj = {
            "Version": "1",
            "Event": "PreservedRawLog",
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "MatchedRule": matched_rule,
            "Raw": raw,
        }

        line = to_json_line(obj) + "\n"
        self._write_event_line(line, obj)
        if self.write_legacy_events:
            date_dir = self.output_dir / today_string()
            date_dir.mkdir(parents=True, exist_ok=True)
            self._append(date_dir / self.preserved_file_name, line)

    def write_parse_error(self, raw: str, error: str, meta: Dict[str, str] | None = None) -> None:
        obj = {
            "Version": "1",
            "Event": "ParseError",
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "Error": error,
            "Raw": raw,
        }
        if meta:
            obj.update(meta)

        self._write_event_line(to_json_line(obj) + "\n", obj)

    def write_rotate_event(
        self,
        *,
        source_path: str,
        file_id: str,
        offset: int,
        reason: str,
    ) -> None:
        date_dir = self.output_dir / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)

        obj = {
            "Version": "1",
            "Event": "TailRotate",
            "Time": now_time_string(),
            "SourcePath": str(source_path or ""),
            "FileId": str(file_id or ""),
            "Offset": max(0, int(offset)),
            "Reason": str(reason or "rotate"),
        }

        line = to_json_line(obj) + "\n"
        self._write_event_line(line, obj)

    def write_raw_archive(self, entry: Dict[str, Any]) -> None:
        v2_dir = self.output_dir / "raw" / today_string()
        v2_dir.mkdir(parents=True, exist_ok=True)
        line = to_json_line(entry) + "\n"
        self._append(v2_dir / self._raw_segment_name, line)
        self._append(v2_dir / "index.json", to_json_line({
            "schema": "logpost.raw.index.v2",
            "updatedAt": now_time_string(),
            "segments": [
                {
                    "fileName": self._raw_segment_name,
                    "countHint": None,
                }
            ],
        }) + "\n")

    def write_outbox(self, status: str, event: Dict[str, Any], error: str = "") -> None:
        date_dir = self.output_dir / "outbox" / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "schema": "logpost.outbox.v2",
            "status": str(status or "pending"),
            "eventId": str(event.get("EventId", "")),
            "eventName": str(event.get("Event", "")),
            "sourceSeq": str(event.get("SourceSeq", "")),
            "sourceMode": str(event.get("SourceMode", "live")),
            "canTriggerActions": str(event.get("CanTriggerActions", "false")),
            "time": str(event.get("Time", now_time_string())),
            "error": str(error or ""),
        }
        self._append(date_dir / f"{payload['status']}.jsonl", to_json_line(payload) + "\n")

    def write_audit(self, kind: str, payload: Dict[str, Any]) -> None:
        date_dir = self.output_dir / "audit" / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "schema": "logpost.audit.v2",
            "kind": str(kind or "unknown"),
            "time": now_time_string(),
            **payload,
        }
        self._append(date_dir / f"{record['kind']}.jsonl", to_json_line(record) + "\n")

    @staticmethod
    def _append(path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8", newline="") as f:
            f.write(text)
            f.flush()

    def _write_event_line(self, line: str, event: Dict[str, Any]) -> None:
        event_name = str(event.get("Event", "Unknown"))
        if self.write_legacy_events:
            date_dir = self.output_dir / today_string()
            date_dir.mkdir(parents=True, exist_ok=True)
            self._append(date_dir / "All.jsonl", line)
            self._append(date_dir / f"{event_name}.jsonl", line)

        if self.write_v2_events:
            v2_dir = self.output_dir / "events" / today_string()
            v2_dir.mkdir(parents=True, exist_ok=True)
            self._append(v2_dir / "all.jsonl", line)
            self._append(v2_dir / "unknown.jsonl" if event_name == "Unknown" else v2_dir / f"{event_name}.jsonl", line)
            if event_name == "PreservedRawLog":
                self._append(v2_dir / "preserved.jsonl", line)
            if event_name == "ParseError":
                self._append(v2_dir / "parse-error.jsonl", line)
