#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import socket
from typing import Dict

from bzss_parser.helpers import to_json_line


class UdpSender:
    def __init__(self, enabled: bool, host: str, port: int, max_payload_bytes: int) -> None:
        self.enabled = enabled
        self.host = host
        self.port = int(port)
        self.max_payload_bytes = int(max_payload_bytes)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def send(self, event: Dict[str, str]) -> None:
        if not self.enabled:
            return

        payload = to_json_line(event).encode("utf-8")

        if len(payload) > self.max_payload_bytes:
            event = dict(event)
            event["Raw"] = "[RAW_REMOVED_BECAUSE_UDP_PAYLOAD_TOO_LARGE]"
            event["RawTruncated"] = "true"
            payload = to_json_line(event).encode("utf-8")

        if len(payload) > self.max_payload_bytes:
            print(f"[WARN] UDP payload still too large. Event skipped. Event={event.get('Event')}")
            return

        try:
            self.sock.sendto(payload, (self.host, self.port))
        except OSError as e:
            print(f"[WARN] UDP send failed: {e}")
