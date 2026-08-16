#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import os
import re
from typing import Dict, List, Tuple


ANSI_RESET = "\033[0m"
ANSI_DIM = "\033[2m"
ANSI_GRAY = "\033[90m"
ANSI_GREEN = "\033[92m"
ANSI_YELLOW = "\033[93m"
ANSI_RED = "\033[91m"
ANSI_MAGENTA = "\033[95m"
ANSI_CYAN = "\033[96m"
ANSI_BLUE = "\033[94m"


EVENT_LABELS = {
    "On_PlayerDamaged": "玩家受伤",
    "On_PlayerWounded": "玩家被击倒",
    "On_PlayerDied": "玩家死亡",
    "On_ServerTickRateUpdated": "服务器帧率更新",
    "On_PlayerSpawnRequested": "玩家请求重生",
    "On_SquadCreated": "小队已创建",
}


EVENT_COLORS = {
    "On_PlayerDamaged": ANSI_YELLOW,
    "On_PlayerWounded": ANSI_RED,
    "On_PlayerDied": ANSI_MAGENTA,
    "On_ServerTickRateUpdated": ANSI_GREEN,
    "On_PlayerSpawnRequested": ANSI_CYAN,
    "On_SquadCreated": ANSI_GREEN,
}


class ConsolePrinter:
    def __init__(
        self,
        *,
        enabled: bool = True,
        use_color: bool = True,
        show_params: bool = True,
        max_params: int = 8,
        max_param_chars: int = 36,
        show_log_time: bool = True,
    ) -> None:
        self.enabled = enabled
        self.use_color = use_color
        self.show_params = show_params
        self.max_params = max(0, int(max_params))
        self.max_param_chars = max(8, int(max_param_chars))
        self.show_log_time = show_log_time

        if self.use_color and os.name == "nt":
            try:
                os.system("")
            except Exception:
                pass

    def event(self, event: Dict[str, str]) -> None:
        if not self.enabled:
            return

        event_name = event.get("Event", "")
        seq = event.get("Seq", "")
        log_time = event.get("LogTime", "")
        color = EVENT_COLORS.get(event_name, ANSI_BLUE)

        event_label = EVENT_LABELS.get(event_name, event_name)
        prefix = f"[事件] {event_label} ({event_name}) #{seq}"
        if self.show_log_time and log_time:
            prefix += f" @{log_time}"

        if self.use_color:
            prefix = f"{color}{prefix}{ANSI_RESET}"

        if not self.show_params:
            print(prefix)
            return

        values = self._extract_param_values(event)

        if values:
            param_text = " | ".join(values)
            if self.use_color:
                print(f"{prefix} {ANSI_GRAY}|{ANSI_RESET} {param_text}")
            else:
                print(f"{prefix} | {param_text}")
        else:
            print(prefix)

    def _extract_param_values(self, event: Dict[str, str]) -> List[str]:
        items: List[Tuple[int, str]] = []

        for key, value in event.items():
            m = re.match(r"^Param(\d+)_", key)
            if not m:
                continue

            index = int(m.group(1))
            text = self._format_value(value)
            items.append((index, text))

        items.sort(key=lambda x: x[0])

        values = [v for _, v in items[:self.max_params]]

        total = len(items)
        if total > self.max_params:
            values.append(f"...+{total - self.max_params}")

        return values

    def _format_value(self, value: str) -> str:
        text = str(value or "").strip()

        if not text:
            text = "-"

        text = text.replace("\r", " ").replace("\n", " ")

        if len(text) > self.max_param_chars:
            text = text[: self.max_param_chars - 1] + "…"

        if not self.use_color:
            return text

        if text == "-":
            return f"{ANSI_DIM}-{ANSI_RESET}"

        return text

    def info(self, message: str) -> None:
        if not self.enabled:
            return

        if self.use_color:
            print(f"{ANSI_CYAN}[信息]{ANSI_RESET} {message}")
        else:
            print(f"[信息] {message}")

    def warn(self, message: str) -> None:
        if not self.enabled:
            return

        if self.use_color:
            print(f"{ANSI_YELLOW}[警告]{ANSI_RESET} {message}")
        else:
            print(f"[警告] {message}")

    def error(self, message: str) -> None:
        if not self.enabled:
            return

        if self.use_color:
            print(f"{ANSI_RED}[错误]{ANSI_RESET} {message}")
        else:
            print(f"[错误] {message}")
