#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List


class PreserveFilter:
    def __init__(self, contains_list: List[str]) -> None:
        self.contains_list = [x for x in contains_list if x]

    def match(self, line: str) -> str:
        if not line:
            return ""

        for token in self.contains_list:
            if token in line:
                return token

        return ""

    def should_preserve(self, line: str) -> bool:
        return bool(self.match(line))
