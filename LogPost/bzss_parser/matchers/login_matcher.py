#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List, Optional, Tuple

from bzss_parser.helpers import regex_get
from bzss_parser.matchers.helpers import parse_online_ids, parse_status_from_params


class LoginMatcher:
    def __init__(self) -> None:
        pass

    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        if self.is_post_login(line):
            return self.parse_post_login(line)

        return None

    @staticmethod
    def is_post_login(line: str) -> bool:
        return (
            "PostLogin:" in line 
            and "NewPlayer:" in line 
            and "Online IDs:" in line
        )

    def parse_post_login(self, line: str) -> Tuple[str, List[Tuple[str, str]]]:
        player_name = regex_get(r"NewPlayer:\s*PC=(.*?)\s+\(Online IDs:", line)
        controller = regex_get(r"(BP_PlayerController_C_\d+)", line)
        ip = regex_get(r"\(IP:\s*([^|]+)\|", line)
        eos, steam = parse_online_ids(line)

        params = [
            ("PlayerName", player_name),
            ("ControllerID", controller),
            ("IP", ip),
            ("EOSID", eos),
            ("Steam64ID", steam),
        ]

        params.append(("ParseStatus", parse_status_from_params(params)))

        return "On_PlayerConnected", params
