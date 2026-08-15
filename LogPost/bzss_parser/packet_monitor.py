#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import threading
import time
from typing import Any, Dict


class PacketMonitor:
    """Periodically reports the range of business UDP packets handed to the OS.

    The statistics packet itself is deliberately sent through ``send_stat_event``
    so it never advances the business PacketSeq counter.  The receiver can then
    compare FirstSeq/LastSeq with the unique EVENT packets it actually observed.
    """

    def __init__(self, sender: Any, window_seconds: float = 10.0) -> None:
        self.sender = sender
        self.window_seconds = max(1.0, float(window_seconds or 10.0))
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._window_start_ms = int(time.time() * 1000)
        self._last_reported_seq = 0
        self._stat_seq = 0

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(
            target=self._run,
            name="LogPostPacketMonitor",
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def _run(self) -> None:
        while not self._stop_event.wait(self.window_seconds):
            try:
                self.report_once()
            except Exception as exc:
                print(f"[WARN] UDP packet statistics report failed: {exc}")

    def report_once(self) -> bool:
        snapshot = self.sender.get_delivery_snapshot()
        now_ms = int(time.time() * 1000)
        last_seq = max(0, int(snapshot.get("packetSeq", 0) or 0))
        total_sent = max(0, int(snapshot.get("totalSent", 0) or 0))
        sent_packets = max(0, last_seq - self._last_reported_seq)
        first_seq = self._last_reported_seq + 1 if sent_packets > 0 else 0
        self._stat_seq += 1

        event: Dict[str, Any] = {
            "Version": "1",
            "Event": "LOGPOST_PACKET_STAT",
            "PacketType": "STAT",
            "PacketSessionId": str(snapshot.get("packetSessionId", "")),
            "StatSeq": str(self._stat_seq),
            "WindowStartMs": str(self._window_start_ms),
            "WindowEndMs": str(now_ms),
            "WindowSeconds": str(self.window_seconds),
            "FirstSeq": str(first_seq),
            "LastSeq": str(last_seq),
            "SentPackets": str(sent_packets),
            "TotalSent": str(total_sent),
            "Timestamp": str(time.time()),
        }

        sent = bool(self.sender.send_stat_event(event))
        if sent:
            self._last_reported_seq = last_seq
            self._window_start_ms = now_ms
        return sent
