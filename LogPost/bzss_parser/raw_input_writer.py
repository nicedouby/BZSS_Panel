#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path

from bzss_parser.helpers import now_time_string, today_string, to_json_line


class RawInputWriter:
    """
    保存 TailReader 实际收到的日志行。

    这和 LogPost 不同：
    - LogPost 保存“解析后的事件”
    - ReceivedLogs 保存“脚本实际收到的原始日志”

    format:
    - raw:   原样写入每一行日志
    - jsonl: {"Time":"...","Raw":"..."}
    """

    def __init__(self, enabled: bool, output_dir: str, file_name: str, fmt: str) -> None:
        self.enabled = enabled
        self.output_dir = Path(output_dir)
        self.file_name = file_name or "Received.log"
        self.fmt = fmt if fmt in ("raw", "jsonl") else "raw"

    def write(self, raw: str) -> None:
        if not self.enabled:
            return

        date_dir = self.output_dir / today_string()
        date_dir.mkdir(parents=True, exist_ok=True)

        if self.fmt == "jsonl":
            line = to_json_line({
                "Time": now_time_string(),
                "Raw": raw,
            }) + "\n"
        else:
            line = raw + "\n"

        with (date_dir / self.file_name).open("a", encoding="utf-8", newline="") as f:
            f.write(line)
            f.flush()
