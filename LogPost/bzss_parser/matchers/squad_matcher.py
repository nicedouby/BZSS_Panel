#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List, Optional, Tuple

from bzss_parser.helpers import regex_get
from bzss_parser.identity_cache import IdentityCache
from bzss_parser.matchers.helpers import parse_online_ids, parse_status_from_params


class SquadMatcher:
    def __init__(self, identity_cache: IdentityCache) -> None:
        self.identity_cache = identity_cache

    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        if self.is_squad_created(line):
            return self.parse_squad_created(line)

        return None

    @staticmethod
    def is_squad_created(line: str) -> bool:
        return (
            "LogSquad:" in line
            and "has created Squad" in line
            and "Squad Name:" in line
        )

    def parse_squad_created(self, line: str) -> Tuple[str, List[Tuple[str, str]]]:
        player_name = regex_get(r"LogSquad:\s*(.*?)\s+\(Online IDs:", line)
        eos_id, steam64_id = parse_online_ids(line)
        squad_id = regex_get(r"has created Squad\s+(\d+)", line)
        squad_name = regex_get(r"\(Squad Name:\s*(.*?)\)", line)
        faction_name = regex_get(r"\)\s+on\s+(.+)$", line)

        if player_name or eos_id or steam64_id:
            self.identity_cache.upsert(
                name=player_name,
                eos_id=eos_id,
                steam64_id=steam64_id,
            )

        params = [
            ("PlayerName", player_name),
            ("EOSID", eos_id),
            ("Steam64ID", steam64_id),
            ("SquadID", squad_id),
            ("SquadName", squad_name),
            ("FactionName", faction_name),
        ]

        params.append(("ParseStatus", parse_status_from_params(params)))

        return "On_SquadCreated", params
