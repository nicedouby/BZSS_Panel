#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import re
from typing import List


class BlacklistFilter:
    BROAD_CHANNEL_PATTERN = re.compile(r"^Log[A-Za-z0-9_]+:$")

    def __init__(self, contains_list: List[str]) -> None:
        self.rejected_rules: List[str] = []
        self.contains_list: List[str] = []

        for token in contains_list:
            if not token:
                continue
            if self.BROAD_CHANNEL_PATTERN.match(token):
                self.rejected_rules.append(token)
                continue
            self.contains_list.append(token)

    def is_blacklisted(self, line: str) -> bool:
        return any(token in line for token in self.contains_list)
