#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from bzss_parser.helpers import regex_get
from bzss_parser.identity_cache import IdentityCache
from bzss_parser.matchers.helpers import parse_online_ids


class AuxiliaryIdentityMatcher:
    def __init__(self, identity_cache: IdentityCache) -> None:
        self.identity_cache = identity_cache

    def update(self, line: str) -> None:
        self._update_change_state(line)
        self._update_on_possess(line)
        self._update_post_login(line)

    def _update_change_state(self, line: str) -> None:
        if not ("ChangeState():" in line and "PC=" in line and "Online IDs:" in line):
            return

        name = regex_get(r"ChangeState\(\):\s*PC=(.*?)\s+\(Online IDs:", line)
        eos, steam = parse_online_ids(line)

        if name or eos or steam:
            self.identity_cache.upsert(
                name=name,
                eos_id=eos,
                steam64_id=steam,
            )

    def _update_on_possess(self, line: str) -> None:
        if not ("OnPossess():" in line and "PC=" in line and "Online IDs:" in line):
            return

        name = regex_get(r"OnPossess\(\):\s*PC=(.*?)\s+\(Online IDs:", line)
        eos, steam = parse_online_ids(line)

        if name or eos or steam:
            self.identity_cache.upsert(
                name=name,
                eos_id=eos,
                steam64_id=steam,
            )

    def _update_post_login(self, line: str) -> None:
        if not ("PostLogin:" in line and "NewPlayer:" in line and "Online IDs:" in line):
            return

        controller = regex_get(r"(BP_PlayerController_C_\d+)", line)
        ip = regex_get(r"\(IP:\s*([^|]+)\|", line)
        eos, steam = parse_online_ids(line)

        if controller or eos or steam:
            self.identity_cache.upsert(
                controller_id=controller,
                eos_id=eos,
                steam64_id=steam,
                ip=ip,
            )
