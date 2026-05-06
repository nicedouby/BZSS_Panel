#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

from bzss_parser.helpers import clean_value


@dataclass
class PlayerIdentity:
    name: str = ""
    eos_id: str = ""
    steam64_id: str = ""
    controller_id: str = ""
    ip: str = ""
    last_seen: float = field(default_factory=time.time)


class IdentityCache:
    """
    轻量身份缓存。

    Steam64ID / EOSID 是强身份。
    ControllerID 是会话身份。
    PlayerName 是弱身份。
    """

    def __init__(self) -> None:
        self.by_name: Dict[str, PlayerIdentity] = {}
        self.by_eos: Dict[str, PlayerIdentity] = {}
        self.by_steam: Dict[str, PlayerIdentity] = {}
        self.by_controller: Dict[str, PlayerIdentity] = {}

    def upsert(
        self,
        *,
        name: str = "",
        eos_id: str = "",
        steam64_id: str = "",
        controller_id: str = "",
        ip: str = "",
    ) -> PlayerIdentity:
        name = clean_value(name)
        eos_id = clean_value(eos_id)
        steam64_id = clean_value(steam64_id)
        controller_id = clean_value(controller_id)
        ip = clean_value(ip)

        identity = self._find_existing(
            name=name,
            eos_id=eos_id,
            steam64_id=steam64_id,
            controller_id=controller_id,
        )

        if identity is None:
            identity = PlayerIdentity()

        if name:
            identity.name = name
        if eos_id:
            identity.eos_id = eos_id
        if steam64_id:
            identity.steam64_id = steam64_id
        if controller_id:
            identity.controller_id = controller_id
        if ip:
            identity.ip = ip

        identity.last_seen = time.time()
        self._index(identity)

        return identity

    def _find_existing(
        self,
        *,
        name: str,
        eos_id: str,
        steam64_id: str,
        controller_id: str,
    ) -> Optional[PlayerIdentity]:
        if steam64_id and steam64_id in self.by_steam:
            return self.by_steam[steam64_id]

        if eos_id and eos_id in self.by_eos:
            return self.by_eos[eos_id]

        if controller_id and controller_id in self.by_controller:
            return self.by_controller[controller_id]

        if name and name in self.by_name:
            return self.by_name[name]

        return None

    def _index(self, identity: PlayerIdentity) -> None:
        if identity.name:
            self.by_name[identity.name] = identity

        if identity.eos_id:
            self.by_eos[identity.eos_id] = identity

        if identity.steam64_id:
            self.by_steam[identity.steam64_id] = identity

        if identity.controller_id:
            self.by_controller[identity.controller_id] = identity

    def resolve_by_name(self, name: str) -> Tuple[Optional[PlayerIdentity], str]:
        name = clean_value(name)

        if not name:
            return None, "Unknown"

        identity = self.by_name.get(name)

        if identity:
            return identity, "CacheByName"

        return None, "Unknown"

    def resolve_by_controller(self, controller_id: str) -> Tuple[Optional[PlayerIdentity], str]:
        controller_id = clean_value(controller_id)

        if not controller_id:
            return None, "Unknown"

        identity = self.by_controller.get(controller_id)

        if identity:
            return identity, "CacheByControllerID"

        return None, "Unknown"

    def cleanup(self, max_age_seconds: int = 6 * 60 * 60) -> None:
        """
        修复点：
        不再把 PlayerIdentity 放入 set，因为 dataclass 默认不可哈希，会导致：
        unhashable type: 'PlayerIdentity'
        """
        now = time.time()
        unique: Dict[int, PlayerIdentity] = {}

        for mapping in (self.by_name, self.by_eos, self.by_steam, self.by_controller):
            for identity in mapping.values():
                unique[id(identity)] = identity

        alive = [
            identity
            for identity in unique.values()
            if now - identity.last_seen <= max_age_seconds
        ]

        self.by_name.clear()
        self.by_eos.clear()
        self.by_steam.clear()
        self.by_controller.clear()

        for identity in alive:
            self._index(identity)
