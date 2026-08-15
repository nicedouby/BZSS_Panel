#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import time
from collections import deque
from typing import Dict, List


class PacketMonitor:
    def __init__(self, window_seconds: int = 10) -> None:
        self.window_seconds = window_seconds
        self.window_packets: deque[int] = deque()
        self.total_sent = 0
        self.history: deque[Dict[str, float]] = deque(maxlen=1440)

    def record_send(self, seq: int) -> None:
        now = int(time.time())
        self.window_packets.append(now)
        self.total_sent += 1
        self._cleanup(now)

    def build_stat_event(self) -> Dict[str, str]:
        now = int(time.time())
        self._cleanup(now)
        count = len(self.window_packets)
        return {
            "Event": "LOGPOST_PACKET_STAT",
            "PacketType": "STAT",
            "WindowSeconds": str(self.window_seconds),
            "SentPackets": str(count),
            "TotalSent": str(self.total_sent),
            "Timestamp": str(now),
        }

    def _cleanup(self, now: int) -> None:
        while self.window_packets and now - self.window_packets[0] > self.window_seconds:
            self.window_packets.popleft()
