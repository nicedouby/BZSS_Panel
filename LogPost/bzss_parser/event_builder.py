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

    def build(
        self,
        event_name: str,
        params: List[Tuple[str, Any]],
        raw: str,
    ) -> Dict[str, str]:
        self.seq += 1

        raw_value, raw_truncated = truncate_raw(raw, self.max_raw_chars)

        event: Dict[str, str] = {
            "Version": "1",
            "ServerID": self.server_id,
            "SessionID": self.session_id,
            "Seq": str(self.seq),
            "Event": event_name,
            "Time": now_time_string(),
            "LogTime": extract_log_time(raw),
            "RawTruncated": raw_truncated,
        }

        for index, (param_name, param_value) in enumerate(params, start=1):
            event[f"Param{index}_{safe_param_name(param_name)}"] = clean_param_value(param_name, param_value)

        event["Raw"] = raw_value
        return event

    def build_raw_log_line(
        self,
        raw: str,
        source: str = "Squad.log",
    ) -> Dict[str, str]:
        self.seq += 1

        raw_value, raw_truncated = truncate_raw(raw, self.max_raw_chars)

        return {
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
            "Raw": raw_value,
        }


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
