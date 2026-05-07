#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List, Optional, Tuple

from bzss_parser.matchers.helpers import parse_status_from_params
from bzss_parser.helpers import clean_value, regex_get


class ServerTickRateMatcher:
    def __init__(self, config: dict | None = None) -> None:
        safe_config = config or {}
        self.expected = float(safe_config.get("expected", 30))
        self.warning_below = float(safe_config.get("warning_below", 28))
        self.critical_below = float(safe_config.get("critical_below", 20))

    @staticmethod
    def is_server_tick_rate_updated(line: str) -> bool:
        return "USQGameState: Server Tick Rate:" in line

    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        if not self.is_server_tick_rate_updated(line):
            return None

        tick_rate = regex_get(r"Server Tick Rate:\s*([-+]?\d+(?:\.\d+)?)", line)
        if not tick_rate:
            return None

        params = [
            ("TickRate", tick_rate),
            ("Unit", "TPS"),
            ("Status", self._resolve_status(tick_rate)),
            ("Expected", self._format_number(self.expected)),
            ("WarningBelow", self._format_number(self.warning_below)),
            ("CriticalBelow", self._format_number(self.critical_below)),
        ]
        params.append(("ParseStatus", parse_status_from_params(params)))
        return "On_ServerTickRateUpdated", params

    def _resolve_status(self, tick_rate: str) -> str:
        value = float(clean_value(tick_rate) or 0)

        if value < self.critical_below:
            return "critical"

        if value < self.warning_below:
            return "warning"

        return "good"

    @staticmethod
    def _format_number(value: float) -> str:
        return f"{value:.2f}"
