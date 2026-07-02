#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import Any, Dict, List, Tuple

from bzss_parser.helpers import (
    clean_value,
    extract_log_time,
    now_time_string,
    safe_param_name,
    truncate_raw,
)


class EventBuilder:
    def __init__(self, server_id: str, session_id: str, max_raw_chars: int) -> None:
        self.server_id = server_id
        self.session_id = session_id
        self.max_raw_chars = max_raw_chars
        self.seq = 0

    def restore_seq(self, value: int) -> None:
        self.seq = max(0, int(value or 0))

    def build(
        self,
        event_name: str,
        params: List[Tuple[str, Any]],
        raw: str,
        source_meta: Dict[str, Any] | None = None,
    ) -> Dict[str, str]:
        self.seq += 1

        raw_value, raw_truncated = truncate_raw(raw, self.max_raw_chars)
        source_seq = clean_value((source_meta or {}).get("source_seq"))
        raw_line_hash = clean_value((source_meta or {}).get("rawLineHash"))
        source_mode = normalize_source_mode((source_meta or {}).get("source_mode"))
        can_trigger_actions = can_trigger_actions_value((source_meta or {}).get("can_trigger_actions"), source_mode)

        event: Dict[str, str] = {
            "Version": "1",
            "ServerID": self.server_id,
            "SessionID": self.session_id,
            "Seq": str(self.seq),
            "Event": event_name,
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "RawTruncated": raw_truncated,
            "SourceMode": source_mode,
            "IsReplay": "true" if source_mode in {"replay", "backfill"} else "false",
            "CanTriggerActions": "true" if can_trigger_actions else "false",
        }

        for index, (param_name, param_value) in enumerate(params, start=1):
            event[f"Param{index}_{safe_param_name(param_name)}"] = clean_param_value(param_name, param_value)

        event["Raw"] = raw_value
        self._apply_source_meta(event, source_meta)
        event["EventId"] = self._build_event_id(event_name, source_seq, raw_line_hash, self.seq)
        return event

    def build_raw_log_line(
        self,
        raw: str,
        source: str = "Squad.log",
        source_meta: Dict[str, Any] | None = None,
    ) -> Dict[str, str]:
        self.seq += 1

        raw_value, raw_truncated = truncate_raw(raw, self.max_raw_chars)
        source_seq = clean_value((source_meta or {}).get("source_seq"))
        raw_line_hash = clean_value((source_meta or {}).get("rawLineHash"))
        source_mode = normalize_source_mode((source_meta or {}).get("source_mode"))
        can_trigger_actions = can_trigger_actions_value((source_meta or {}).get("can_trigger_actions"), source_mode)

        event = {
            "Version": "1",
            "ServerID": self.server_id,
            "SessionID": self.session_id,
            "Seq": str(self.seq),
            "Event": "On_RawLogLine",
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "RawTruncated": raw_truncated,
            "Param1_Source": clean_value(source),
            "Param2_Channel": clean_value(extract_channel(raw)),
            "SourceMode": source_mode,
            "IsReplay": "true" if source_mode in {"replay", "backfill"} else "false",
            "CanTriggerActions": "true" if can_trigger_actions else "false",
            "Raw": raw_value,
        }
        self._apply_source_meta(event, source_meta)
        event["EventId"] = self._build_event_id("On_RawLogLine", source_seq, raw_line_hash, self.seq)
        return event

    @staticmethod
    def _apply_source_meta(event: Dict[str, str], source_meta: Dict[str, Any] | None) -> None:
        if not source_meta:
            return

        source_seq = source_meta.get("source_seq")
        source_offset = source_meta.get("source_offset")
        raw_line_hash = source_meta.get("rawLineHash")

        if source_seq is not None:
            event["SourceSeq"] = clean_value(source_seq)
            event["Param900_SourceSeq"] = clean_value(source_seq)
        if source_offset is not None:
            event["SourceOffset"] = clean_value(source_offset)
            event["Param901_SourceOffset"] = clean_value(source_offset)
        if raw_line_hash:
            event["RawLineHash"] = clean_value(raw_line_hash)
            event["Param902_RawLineHash"] = clean_value(raw_line_hash)

    def _build_event_id(self, event_name: str, source_seq: str, raw_line_hash: str, event_index: int) -> str:
        stable_source_seq = source_seq or "0"
        stable_hash = raw_line_hash or "nohash"
        return f"{self.server_id}:{stable_source_seq}:{stable_hash}:{event_name}:{max(0, int(event_index))}"


def normalize_source_mode(value: Any) -> str:
    text = clean_value(value).lower()
    if text in {"live", "recovery", "replay", "backfill"}:
        return text
    return "live"


def can_trigger_actions_value(value: Any, source_mode: str) -> bool:
    if value is not None and str(value).strip() != "":
        text = str(value).strip().lower()
        if text in {"true", "1", "yes"}:
            return True
        if text in {"false", "0", "no"}:
            return False
    return source_mode == "live"


def clean_param_value(param_name: str, param_value: Any) -> str:
    if str(param_name) in {"FromObject", "CausedBy"} and param_value is not None:
        return str(param_value).strip()
    return clean_value(param_value)


def extract_channel(raw: str) -> str:
    text = str(raw or "")
    start = text.find("Log")

    if start < 0:
        return ""

    end = text.find(":", start)
    if end < 0:
        return ""

    candidate = text[start:end]
    if not candidate.replace("_", "").isalnum():
        return ""

    return candidate
