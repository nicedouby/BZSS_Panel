#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List, Optional, Tuple

from bzss_parser.helpers import regex_get
from bzss_parser.identity_cache import IdentityCache
from bzss_parser.matchers.helpers import parse_status_from_params


class SpawnMatcher:
    def __init__(self, identity_cache: IdentityCache) -> None:
        self.identity_cache = identity_cache

    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        if self.is_player_spawn_requested(line):
            return self.parse_player_spawn_requested(line)

        return None

    @staticmethod
    def is_player_spawn_requested(line: str) -> bool:
        return (
            "RestartPlayer():" in line
            and "On Server PC=" in line
            and "DeployRole=" in line
        )

    def parse_player_spawn_requested(self, line: str) -> Tuple[str, List[Tuple[str, str]]]:
        player_name = regex_get(r"RestartPlayer\(\):\s*On Server PC=(.*?)\s+Spawn=", line)
        spawn = regex_get(r"\sSpawn=(\S+)", line)
        deploy_role = regex_get(r"\sDeployRole=(\S+)", line)

        identity, source = self.identity_cache.resolve_by_name(player_name)

        params = [
            ("PlayerName", player_name),
            ("Spawn", spawn),
            ("DeployRole", deploy_role),
            ("CachedEOSID", identity.eos_id if identity else ""),
            ("CachedSteam64ID", identity.steam64_id if identity else ""),
            ("IdentitySource", source),
        ]

        params.append(("ParseStatus", parse_status_from_params(params)))

        return "On_PlayerSpawnRequested", params
