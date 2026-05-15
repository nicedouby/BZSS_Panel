#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import re
from typing import List, Optional, Tuple

from bzss_parser.helpers import clean_value


KNOWN_GAME_MODES = (
    "AAS",
    "RAAS",
    "Invasion",
    "Seed",
    "Skirmish",
    "TC",
    "Insurgency",
    "Destruction",
    "Training",
)

MODE_LOOKUP = {mode.upper(): mode.upper() for mode in KNOWN_GAME_MODES}
WORLD_BRING_UP_PATTERN = re.compile(
    r"^\[(?P<logLineTime>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}:\d{3})\]\[\s*(?P<frame>\d+)\]"
    r"LogWorld:\s+Bringing World\s+(?P<worldPath>.+?)\s+up for play\s+\(max tick rate\s+(?P<maxTickRate>\d+)\)"
    r"\s+at\s+(?P<serverPlayAt>\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})\s*$",
    re.IGNORECASE,
)


class WorldBringUpMatcher:
    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        text = str(line or "")
        if not self.is_world_bring_up(text):
            return None

        parsed = self.parse_world_bring_up(text)
        if not parsed:
            return None

        params = [
            ("logLineTime", parsed["logLineTime"]),
            ("frame", parsed["frame"]),
            ("worldPath", parsed["worldPath"]),
            ("layerName", parsed["layerName"]),
            ("mapName", parsed["mapName"]),
            ("gameMode", parsed["gameMode"]),
            ("maxTickRate", parsed["maxTickRate"]),
            ("serverPlayAt", parsed["serverPlayAt"]),
        ]

        return "round.world_bring_up", params

    @staticmethod
    def is_world_bring_up(line: str) -> bool:
        text = str(line or "")
        return (
            "LogWorld: Bringing World" in text
            and "up for play" in text
            and "max tick rate" in text
        )

    def parse_world_bring_up(self, line: str) -> Optional[dict[str, str]]:
        match = WORLD_BRING_UP_PATTERN.match(str(line or "").strip())
        if not match:
            return None

        world_path = clean_value(match.group("worldPath"))
        layer_name = extract_layer_name(world_path)
        map_name, game_mode = parse_map_and_mode(layer_name)

        return {
            "logLineTime": clean_value(match.group("logLineTime")),
            "frame": clean_value(match.group("frame")),
            "worldPath": world_path,
            "layerName": layer_name,
            "mapName": map_name,
            "gameMode": game_mode,
            "maxTickRate": clean_value(match.group("maxTickRate")),
            "serverPlayAt": clean_value(match.group("serverPlayAt")),
        }


def extract_layer_name(world_path: str) -> str:
    text = clean_value(world_path)
    if not text:
        return ""

    last_segment = text.rsplit("/", 1)[-1]
    return last_segment.rsplit(".", 1)[0].strip()


def parse_map_and_mode(layer_name: str) -> Tuple[str, str]:
    text = clean_value(layer_name)
    if not text:
        return "", ""

    tokens = [token for token in text.split("_") if token]
    if len(tokens) < 2:
        return "", ""

    mode_index = find_mode_index(tokens)
    if mode_index < 1:
        return "", ""

    map_name = "_".join(tokens[:mode_index]).strip()
    game_mode = MODE_LOOKUP.get(tokens[mode_index].upper(), tokens[mode_index].upper())
    return map_name, game_mode


def find_mode_index(tokens: List[str]) -> int:
    end = len(tokens)
    while end > 0 and is_version_token(tokens[end - 1]):
        end -= 1

    for index in range(end - 1, 0, -1):
        if tokens[index].upper() in MODE_LOOKUP:
            return index

    return -1


def is_version_token(token: str) -> bool:
    text = clean_value(token)
    return bool(re.fullmatch(r"v?\d+", text, re.IGNORECASE))
