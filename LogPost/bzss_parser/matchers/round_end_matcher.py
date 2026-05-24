#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import re
from typing import List, Optional, Tuple

from bzss_parser.helpers import clean_value

MATCH_WINNER_PATTERN = re.compile(
    r"^\[(?P<logLineTime>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]\[\s*(?P<frame>\d+)\]"
    r"LogSquadTrace:\s+\[DedicatedServer\]DetermineMatchWinner\(\):\s+(?P<winner>.+?)\s+won\s+on\s+(?P<mapName>.+)\s*$",
    re.IGNORECASE,
)


class RoundEndMatcher:
    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        text = str(line or "").strip()
        if "DetermineMatchWinner():" not in text:
            return None

        match = MATCH_WINNER_PATTERN.match(text)
        if not match:
            return None

        params = [
            ("logLineTime", clean_value(match.group("logLineTime"))),
            ("frame", clean_value(match.group("frame"))),
            ("winner", clean_value(match.group("winner"))),
            ("mapName", clean_value(match.group("mapName"))),
        ]

        return "round.match_winner", params
