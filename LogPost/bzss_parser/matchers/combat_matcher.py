#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import List, Optional, Tuple

from bzss_parser.identity_cache import IdentityCache
from bzss_parser.matchers.helpers import (
    compute_combat_confidence,
    effective_confidence,
    parse_attacker_name_from_damage,
    parse_caused_by,
    parse_confidence_from_status,
    parse_controller_id,
    parse_damage_value,
    parse_from_object,
    parse_killing_damage_value,
    parse_online_ids,
    parse_status_from_params,
    parse_victim_name_for_damage,
    parse_victim_name_for_killing_event,
)


class CombatMatcher:
    """
    战斗事件解析器。

    只处理玩家战斗事件，不订阅 / 不事件化 SQVehicle::OnTakeDamage。
    只要命中玩家事件特征，就生成事件。
    参数提取失败时填空字符串，不丢事件。
    """

    def __init__(self, identity_cache: IdentityCache) -> None:
        self.identity_cache = identity_cache

    def match(self, line: str) -> Optional[Tuple[str, List[Tuple[str, str]]]]:
        if self.is_vehicle_take_damage_noise(line):
            return None

        if self.is_player_damaged(line):
            return self.parse_player_damaged(line)

        if self.is_player_wounded(line):
            return self.parse_player_wounded(line)

        if self.is_player_died(line):
            return self.parse_player_died(line)

        return None

    @staticmethod
    def is_vehicle_take_damage_noise(line: str) -> bool:
        return (
            "SQVehicle::OnTakeDamage" in line
            or "SQVehicle::TakeDamage" in line
        )

    @staticmethod
    def is_player_damaged(line: str) -> bool:
        return (
            "LogSquad:" in line
            and "Player:" in line
            and "ActualDamage=" in line
            and "caused by" in line
        )

    @staticmethod
    def is_player_wounded(line: str) -> bool:
        return (
            "Wound(): Player:" in line
            and "KillingDamage=" in line
            and "caused by" in line
        )

    @staticmethod
    def is_player_died(line: str) -> bool:
        return (
            "Die(): Player:" in line
            and "KillingDamage=" in line
            and "caused by" in line
        )

    def parse_player_damaged(self, line: str) -> Tuple[str, List[Tuple[str, str]]]:
        victim_name = parse_victim_name_for_damage(line)
        actual_damage = parse_damage_value(line)
        attacker_name = parse_attacker_name_from_damage(line)
        attacker_eos, attacker_steam = parse_online_ids(line)
        attacker_controller = parse_controller_id(line)
        caused_by = parse_caused_by(line)

        if attacker_name or attacker_eos or attacker_steam or attacker_controller:
            self.identity_cache.upsert(
                name=attacker_name,
                eos_id=attacker_eos,
                steam64_id=attacker_steam,
                controller_id=attacker_controller,
            )

        victim_identity, victim_source = self.identity_cache.resolve_by_name(victim_name)

        confidence = compute_combat_confidence(
            attacker_eos=attacker_eos,
            attacker_steam=attacker_steam,
            attacker_controller=attacker_controller,
            victim_source=victim_source,
        )
        identity_source = "RawLog+Victim" + victim_source

        params = [
            ("VictimName", victim_name),
            ("ActualDamage", actual_damage),
            ("AttackerName", attacker_name),
            ("AttackerEOSID", attacker_eos),
            ("AttackerSteam64ID", attacker_steam),
            ("AttackerControllerID", attacker_controller),
            ("CausedBy", caused_by),
            ("VictimCachedEOSID", victim_identity.eos_id if victim_identity else ""),
            ("VictimCachedSteam64ID", victim_identity.steam64_id if victim_identity else ""),
            ("IdentityConfidence", confidence),
            ("IdentitySource", identity_source),
        ]

        parse_status = parse_status_from_params(params)
        parse_confidence = parse_confidence_from_status(parse_status)
        params.extend([
            ("ParseStatus", parse_status),
            ("ParseConfidence", parse_confidence),
            ("Confidence", effective_confidence(confidence, parse_confidence)),
        ])

        return "On_PlayerDamaged", params

    def parse_player_wounded(self, line: str) -> Tuple[str, List[Tuple[str, str]]]:
        victim_name = parse_victim_name_for_killing_event(line)
        killing_damage = parse_killing_damage_value(line)
        from_object = parse_from_object(line)
        attacker_eos, attacker_steam = parse_online_ids(line)
        attacker_controller = parse_controller_id(line)
        caused_by = parse_caused_by(line)

        attacker_identity, attacker_source = self.identity_cache.resolve_by_controller(attacker_controller)
        attacker_name = attacker_identity.name if attacker_identity else ""

        if attacker_name or attacker_eos or attacker_steam or attacker_controller:
            self.identity_cache.upsert(
                name=attacker_name,
                eos_id=attacker_eos,
                steam64_id=attacker_steam,
                controller_id=attacker_controller,
            )

        victim_identity, victim_source = self.identity_cache.resolve_by_name(victim_name)

        confidence = compute_combat_confidence(
            attacker_eos=attacker_eos,
            attacker_steam=attacker_steam,
            attacker_controller=attacker_controller,
            victim_source=victim_source,
        )
        identity_source = attacker_source + "+Victim" + victim_source

        params = [
            ("VictimName", victim_name),
            ("KillingDamage", killing_damage),
            ("AttackerName", attacker_name),
            ("AttackerEOSID", attacker_eos),
            ("AttackerSteam64ID", attacker_steam),
            ("AttackerControllerID", attacker_controller),
            ("FromObject", from_object),
            ("CausedBy", caused_by),
            ("VictimCachedEOSID", victim_identity.eos_id if victim_identity else ""),
            ("VictimCachedSteam64ID", victim_identity.steam64_id if victim_identity else ""),
            ("IdentityConfidence", confidence),
            ("IdentitySource", identity_source),
        ]

        parse_status = parse_status_from_params(params)
        parse_confidence = parse_confidence_from_status(parse_status)
        params.extend([
            ("ParseStatus", parse_status),
            ("ParseConfidence", parse_confidence),
            ("Confidence", effective_confidence(confidence, parse_confidence)),
        ])

        return "On_PlayerWounded", params

    def parse_player_died(self, line: str) -> Tuple[str, List[Tuple[str, str]]]:
        victim_name = parse_victim_name_for_killing_event(line)
        killing_damage = parse_killing_damage_value(line)
        from_object = parse_from_object(line)
        attacker_eos, attacker_steam = parse_online_ids(line)
        attacker_controller = parse_controller_id(line)
        caused_by = parse_caused_by(line)

        attacker_identity, attacker_source = self.identity_cache.resolve_by_controller(attacker_controller)
        attacker_name = attacker_identity.name if attacker_identity else ""

        if attacker_name or attacker_eos or attacker_steam or attacker_controller:
            self.identity_cache.upsert(
                name=attacker_name,
                eos_id=attacker_eos,
                steam64_id=attacker_steam,
                controller_id=attacker_controller,
            )

        victim_identity, victim_source = self.identity_cache.resolve_by_name(victim_name)

        confidence = compute_combat_confidence(
            attacker_eos=attacker_eos,
            attacker_steam=attacker_steam,
            attacker_controller=attacker_controller,
            victim_source=victim_source,
        )
        identity_source = attacker_source + "+Victim" + victim_source

        params = [
            ("VictimName", victim_name),
            ("KillingDamage", killing_damage),
            ("AttackerName", attacker_name),
            ("AttackerEOSID", attacker_eos),
            ("AttackerSteam64ID", attacker_steam),
            ("AttackerControllerID", attacker_controller),
            ("FromObject", from_object),
            ("CausedBy", caused_by),
            ("VictimCachedEOSID", victim_identity.eos_id if victim_identity else ""),
            ("VictimCachedSteam64ID", victim_identity.steam64_id if victim_identity else ""),
            ("IdentityConfidence", confidence),
            ("IdentitySource", identity_source),
        ]

        parse_status = parse_status_from_params(params)
        parse_confidence = parse_confidence_from_status(parse_status)
        params.extend([
            ("ParseStatus", parse_status),
            ("ParseConfidence", parse_confidence),
            ("Confidence", effective_confidence(confidence, parse_confidence)),
        ])

        return "On_PlayerDied", params
