#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime
from typing import Any, Dict, Tuple


NULL_VALUES = {
    "",
    "INVALID",
    "None",
    "none",
    "nullptr",
    "NULL",
    "null",
    "N/A",
}


def now_time_string() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def today_string() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def make_session_id() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:8]


def clean_value(value: Any) -> str:
    if value is None:
        return ""

    text = str(value).strip()

    if text in NULL_VALUES:
        return ""

    return text


def truncate_raw(raw: str, max_chars: int) -> Tuple[str, str]:
    if max_chars <= 0:
        return raw, "false"

    if len(raw) <= max_chars:
        return raw, "false"

    return raw[:max_chars] + "...[TRUNCATED]", "true"


def to_json_line(obj: Dict[str, Any]) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def sha1_hex(value: Any) -> str:
    text = str(value if value is not None else "")
    return hashlib.sha1(text.encode("utf-8", errors="replace")).hexdigest()


def regex_get(pattern: str, text: str, group: int | str = 1, flags: int = 0) -> str:
    m = re.search(pattern, text, flags)
    if not m:
        return ""

    try:
        return clean_value(m.group(group))
    except Exception:
        return ""


def safe_param_name(name: str) -> str:
    name = clean_value(name)
    name = re.sub(r"[^A-Za-z0-9_]", "_", name)
    return name or "Value"


def extract_log_time(raw: str) -> str:
    return regex_get(r"^\[(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]", raw)
