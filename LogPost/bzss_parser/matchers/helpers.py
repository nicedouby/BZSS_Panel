#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import re
from typing import List, Tuple

from bzss_parser.helpers import clean_value, regex_get


def parse_online_ids(line: str) -> Tuple[str, str]:
    eos = regex_get(r"Online IDs:\s*EOS:\s*(\S+)\s+steam:\s*(\S+)", line, 1)
    steam = sanitize_steam64(regex_get(r"Online IDs:\s*EOS:\s*(\S+)\s+steam:\s*(\S+)", line, 2))

    return eos, steam


def parse_controller_id(line: str) -> str:
    return regex_get(
        r"(?:Player Controller ID|Controller ID|Contoller ID):\s*([^)]+)",
        line,
    )


def parse_caused_by(line: str) -> str:
    match = re.search(r"caused by\s*(.+)$", line)
    return match.group(1).strip() if match else ""


def parse_from_object(line: str) -> str:
    match = re.search(r"\sfrom\s+(.+?)\s+\(", line)
    return match.group(1).strip() if match else ""


def parse_controller_id_from_object(value: str) -> str:
    text = str(value or "").strip()
    if re.fullmatch(r"BP_PlayerController_C_\d+", text):
        return text
    return ""


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

    return "Failed"


def parse_status_from_required_params(
    params: List[Tuple[str, str]],
    required_names: List[str],
) -> str:
    data = {name: clean_value(value) for name, value in params}
    present = sum(1 for name in required_names if data.get(name, "") != "")

    if present == len(required_names):
        return "Full"

    if present > 0:
        return "Partial"

    return "Failed"


def parse_confidence_from_status(parse_status: str) -> str:
    status = clean_value(parse_status)

    if status == "Full":
        return "High"

    if status == "Partial":
        return "Medium"

    return "Low"


def effective_confidence(identity_confidence: str, parse_confidence: str) -> str:
    rank = {
        "Low": 0,
        "MediumLow": 1,
        "Medium": 2,
        "High": 3,
    }
    reverse_rank = {
        0: "Low",
        1: "MediumLow",
        2: "Medium",
        3: "High",
    }

    identity_rank = rank.get(clean_value(identity_confidence), 0)
    parse_rank = rank.get(clean_value(parse_confidence), 0)
    return reverse_rank[min(identity_rank, parse_rank)]


def sanitize_steam64(value: str) -> str:
    digits = "".join(ch for ch in clean_value(value) if ch.isdigit())
    if len(digits) == 17:
        return digits
    return ""
