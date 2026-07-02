#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from bzss_parser.helpers import now_time_string


class SourceStateStore:
    def __init__(self, state_path: str) -> None:
        self.state_path = Path(state_path)

    def load(self) -> Dict[str, Any]:
        try:
            text = self.state_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        except Exception:
            return {}

        try:
            data = json.loads(text)
        except Exception:
            return {}

        return data if isinstance(data, dict) else {}

    def save(
        self,
        *,
        source_path: str,
        file_id: str,
        offset: int,
        seq: int,
        mode: str = "live",
        file_size: int | None = None,
        file_mtime_ms: int | None = None,
        last_raw_line_hash: str = "",
        last_log_time: str = "",
    ) -> Dict[str, Any]:
        payload = {
            "sourcePath": str(source_path or ""),
            "fileId": str(file_id or ""),
            "offset": max(0, int(offset)),
            "seq": max(0, int(seq)),
            "mode": str(mode or "live"),
            "fileSize": None if file_size is None else max(0, int(file_size)),
            "fileMtimeMs": None if file_mtime_ms is None else max(0, int(file_mtime_ms)),
            "lastRawLineHash": str(last_raw_line_hash or ""),
            "lastLogTime": str(last_log_time or ""),
            "updatedAt": now_time_string(),
        }

        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.state_path.with_suffix(f"{self.state_path.suffix}.tmp")
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(self.state_path)
        return payload
