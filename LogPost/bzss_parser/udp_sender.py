#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import socket
import time
from typing import Dict

from bzss_parser.helpers import to_json_line


class UdpSender:
    def __init__(self, enabled: bool, host: str, port: int, max_payload_bytes: int) -> None:
        self.enabled = enabled
        self.host = host
        self.port = int(port)
        self.max_payload_bytes = int(max_payload_bytes)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.packet_seq = 0
        self.total_sent = 0

    def send(self, event: Dict[str, str]) -> None:
        if not self.enabled:
            return

        event = dict(event)
        self.packet_seq += 1
        event.setdefault("PacketType", "EVENT")
        event["PacketSeq"] = str(self.packet_seq)
        event["PacketSentAt"] = str(time.time())

        payload = to_json_line(event).encode("utf-8")

        if len(payload) > self.max_payload_bytes:
            event["Raw"] = "[RAW_REMOVED_BECAUSE_UDP_PAYLOAD_TOO_LARGE]"
            event["RawTruncated"] = "true"
            payload = to_json_line(event).encode("utf-8")

        if len(payload) > self.max_payload_bytes:
            print(f"[WARN] UDP payload still too large. Event skipped. Event={event.get('Event')}")
            return

        try:
            self.sock.sendto(payload, (self.host, self.port))
            self.total_sent += 1
        except OSError as e:
            print(f"[WARN] UDP send failed: {e}")
