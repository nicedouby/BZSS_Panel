#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List


class BlacklistFilter:
    def __init__(self, contains_list: List[str]) -> None:
        self.contains_list = [x for x in contains_list if x]

    def is_blacklisted(self, line: str) -> bool:
        return any(token in line for token in self.contains_list)
