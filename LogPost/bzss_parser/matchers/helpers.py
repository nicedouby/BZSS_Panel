#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List, Tuple

from bzss_parser.helpers import clean_value, regex_get


def parse_online_ids(line: str) -> Tuple[str, str]:
    eos = regex_get(r"Online IDs:\s*EOS:\s*(\S+)\s+steam:\s*(\S+)", line, 1)
    steam = regex_get(r"Online IDs:\s*EOS:\s*(\S+)\s+steam:\s*(\S+)", line, 2)

    return eos, steam


def parse_controller_id(line: str) -> str:
    return regex_get(
        r"(?:Player Controller ID|Controller ID|Contoller ID):\s*([^)]+)",
        line,
    )


def parse_caused_by(line: str) -> str:
    return regex_get(r"\scaused by\s*(.+)$", line)


def parse_from_object(line: str) -> str:
    return regex_get(r"\sfrom\s+(\S+)\s+\(", line)


def parse_attacker_name_from_damage(line: str) -> str:
    return regex_get(
        r"ActualDamage=[-+]?\d+(?:\.\d+)?\s+from\s+(.*?)\s*\(Online IDs:",
        line,
    )


def parse_victim_name_for_damage(line: str) -> str:
    return regex_get(
        r"Player:\s*(.*?)\s+ActualDamage=",
        line,
    )


def parse_victim_name_for_killing_event(line: str) -> str:
    return regex_get(
        r"Player:\s*(.*?)\s+KillingDamage=",
        line,
    )


def parse_damage_value(line: str) -> str:
    return regex_get(
        r"ActualDamage=([-+]?\d+(?:\.\d+)?)",
        line,
    )


def parse_killing_damage_value(line: str) -> str:
    return regex_get(
        r"KillingDamage=([-+]?\d+(?:\.\d+)?)",
        line,
    )


def compute_combat_confidence(
    *,
    attacker_eos: str,
    attacker_steam: str,
    attacker_controller: str,
    victim_source: str,
) -> str:
    has_attacker_all = bool(attacker_eos and attacker_steam and attacker_controller)
    has_attacker_any = bool(attacker_eos or attacker_steam or attacker_controller)

    if has_attacker_all and victim_source != "Unknown":
        return "High"

    if has_attacker_all:
        return "Medium"

    if has_attacker_any:
        return "MediumLow"

    return "Low"


def parse_status_from_params(params: List[Tuple[str, str]]) -> str:
    empty_count = 0

    for _, value in params:
        if clean_value(value) == "":
            empty_count += 1

    if empty_count == 0:
        return "Full"

    if empty_count <= 3:
        return "Partial"

    return "Sparse"
