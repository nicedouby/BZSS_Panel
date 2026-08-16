#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import socket
import threading
import time
import uuid
from typing import Any, Dict

from bzss_parser.helpers import to_json_line
from bzss_parser.packet_monitor import PacketMonitor


class UdpSender:
    def __init__(self, enabled: bool, host: str, port: int, max_payload_bytes: int) -> None:
        self.enabled = enabled
        self.host = host
        self.port = int(port)
        self.max_payload_bytes = int(max_payload_bytes)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

        # PacketSeq is scoped to one parser process.  A session id lets the
        # receiver distinguish a real packet gap from a parser restart/reset.
        self.packet_session_id = uuid.uuid4().hex
        self.packet_seq = 0
        self.total_sent = 0
        self.total_stat_sent = 0
        self.last_business_sent_at_ms = 0
        self._send_lock = threading.Lock()

        self.packet_monitor = PacketMonitor(self, window_seconds=10.0)
        if self.enabled:
            self.packet_monitor.start()

    def send(self, event: Dict[str, Any]) -> bool:
        """Send one business EVENT packet.

        The sequence is committed only after sendto() succeeds.  Locally
        rejected/oversized events therefore do not masquerade as network loss.
        """
        if not self.enabled:
            return False

        with self._send_lock:
            candidate_seq = self.packet_seq + 1
            packet = dict(event)
            packet["PacketType"] = "EVENT"
            packet["PacketSessionId"] = self.packet_session_id
            packet["PacketSeq"] = str(candidate_seq)
            packet["PacketSentAtMs"] = str(int(time.time() * 1000))

            payload = self._serialize_with_raw_fallback(packet)
            if payload is None:
                return False

            try:
                self.sock.sendto(payload, (self.host, self.port))
            except OSError as exc:
                print(f"[警告] UDP 发送失败：{exc}")
                return False

            self.packet_seq = candidate_seq
            self.total_sent += 1
            self.last_business_sent_at_ms = int(time.time() * 1000)
            return True

    def send_stat_event(self, event: Dict[str, Any]) -> bool:
        """Send a control/statistics packet without consuming PacketSeq."""
        if not self.enabled:
            return False

        with self._send_lock:
            packet = dict(event)
            packet["PacketType"] = "STAT"
            packet["PacketSessionId"] = self.packet_session_id
            packet["PacketStatSentAtMs"] = str(int(time.time() * 1000))
            payload = self._serialize_with_raw_fallback(packet)
            if payload is None:
                return False

            try:
                self.sock.sendto(payload, (self.host, self.port))
            except OSError as exc:
                print(f"[警告] UDP 统计信息发送失败：{exc}")
                return False

            self.total_stat_sent += 1
            return True

    def get_delivery_snapshot(self) -> Dict[str, Any]:
        with self._send_lock:
            return {
                "packetSessionId": self.packet_session_id,
                "packetSeq": self.packet_seq,
                "totalSent": self.total_sent,
                "totalStatSent": self.total_stat_sent,
                "lastBusinessSentAtMs": self.last_business_sent_at_ms,
            }

    def close(self) -> None:
        self.packet_monitor.stop()
        try:
            self.sock.close()
        except OSError:
            pass

    def _serialize_with_raw_fallback(self, event: Dict[str, Any]) -> bytes | None:
        payload = to_json_line(event).encode("utf-8")

        if len(payload) > self.max_payload_bytes:
            event = dict(event)
            event["Raw"] = "[RAW_REMOVED_BECAUSE_UDP_PAYLOAD_TOO_LARGE]"
            event["RawTruncated"] = "true"
            payload = to_json_line(event).encode("utf-8")

        if len(payload) > self.max_payload_bytes:
            print(f"[警告] UDP 数据包仍然过大，已跳过事件：Event={event.get('Event')}")
            return None
        return payload
