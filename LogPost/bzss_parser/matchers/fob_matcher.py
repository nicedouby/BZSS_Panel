#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List, Optional, Tuple

from bzss_parser.helpers import regex_get
from bzss_parser.matchers.helpers import parse_confidence_from_status, parse_status_from_required_params


class FobMatcher:
    def __init__(self) -> None:
        pass

    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        if self.is_fob_placed(line):
            return self.parse_fob_placed(line)
        return None

    @staticmethod
    def is_fob_placed(line: str) -> bool:
        text = str(line or "")
        return "has placed FOB Team:" in text and "Squad:" in text

    def parse_fob_placed(self, line: str) -> Tuple[str, List[Tuple[str, str]]]:
        # The player name can be adjacent to "has" in some logs (missing whitespace).
        player_name = regex_get(r"Warning:\s*(.*?)\s*has placed FOB Team:", line)
        team_id = regex_get(r"has placed FOB Team:\s*(\d+)", line)
        squad_id = regex_get(r"\bSquad:\s*(\d+)", line)

        params = [
            ("PlayerName", player_name),
            ("TeamID", team_id),
            ("SquadID", squad_id),
        ]

        parse_status = parse_status_from_required_params(params, ["TeamID", "SquadID"])
        params.append(("ParseStatus", parse_status))
        params.append(("ParseConfidence", parse_confidence_from_status(parse_status)))

        return "On_FobPlaced", params
