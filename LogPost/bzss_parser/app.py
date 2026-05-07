#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple

from bzss_parser.blacklist import BlacklistFilter
from bzss_parser.event_builder import EventBuilder
from bzss_parser.console_printer import ConsolePrinter
from bzss_parser.helpers import make_session_id
from bzss_parser.identity_cache import IdentityCache
from bzss_parser.logpost_writer import LogPostWriter
from bzss_parser.raw_input_writer import RawInputWriter
from bzss_parser.tail_reader import TailReader
from bzss_parser.udp_sender import UdpSender
from bzss_parser.matchers.auxiliary_identity_matcher import AuxiliaryIdentityMatcher
from bzss_parser.matchers.combat_matcher import CombatMatcher
from bzss_parser.matchers.server_tick_rate_matcher import ServerTickRateMatcher
from bzss_parser.matchers.spawn_matcher import SpawnMatcher
from bzss_parser.matchers.squad_matcher import SquadMatcher


MatchedEvent = Tuple[str, List[Tuple[str, str]]]


class BzssLogParserApp:
    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config

        self.session_id = make_session_id()
        self.identity_cache = IdentityCache()

        self.auxiliary_identity_matcher = AuxiliaryIdentityMatcher(self.identity_cache)
        self.matchers = [
            CombatMatcher(self.identity_cache),
            ServerTickRateMatcher(self.config.get("server_tick_rate", {})),
            SpawnMatcher(self.identity_cache),
            SquadMatcher(self.identity_cache),
        ]

        self.blacklist = BlacklistFilter(
            self.config.get("blacklist_contains", [])
        )

        self.builder = EventBuilder(
            server_id=str(self.config.get("server_id", "BZSS_Main")),
            session_id=self.session_id,
            max_raw_chars=int(self.config.get("raw", {}).get("max_raw_chars", 4096)),
        )

        self.writer = LogPostWriter(
            output_dir=str(self.config.get("output_dir", "./LogPost"))
        )

        raw_input_config = self.config.get("raw_input_log", {})
        self.raw_input_writer = RawInputWriter(
            enabled=bool(raw_input_config.get("enabled", True)),
            output_dir=str(raw_input_config.get("output_dir", "./ReceivedLogs")),
            file_name=str(raw_input_config.get("file_name", "Received.log")),
            fmt=str(raw_input_config.get("format", "raw")),
        )

        console_config = self.config.get("console", {})
        self.console = ConsolePrinter(
            enabled=bool(console_config.get("enabled", True)),
            use_color=bool(console_config.get("use_color", True)),
            show_params=bool(console_config.get("show_params", True)),
            max_params=int(console_config.get("max_params", 8)),
            max_param_chars=int(console_config.get("max_param_chars", 36)),
            show_log_time=bool(console_config.get("show_log_time", True)),
        )

        udp_config = self.config.get("udp", {})
        self.udp_sender = UdpSender(
            enabled=bool(udp_config.get("enabled", True)),
            host=str(udp_config.get("host", "127.0.0.1")),
            port=int(udp_config.get("port", 7788)),
            max_payload_bytes=int(udp_config.get("max_payload_bytes", 8192)),
        )

        tail_config = self.config.get("tail", {})
        self.tail_reader = TailReader(
            log_file=str(self.config.get("log_file", "./Squad.log")),
            from_end=bool(tail_config.get("from_end", True)),
            reopen_on_truncate=bool(tail_config.get("reopen_on_truncate", True)),
        )

        self.poll_interval = max(
            0.05,
            int(self.config.get("poll_interval_ms", 200)) / 1000.0,
        )

        self.write_unknown = bool(
            self.config.get("unknown", {}).get("write_unknown", False)
        )

        self._last_cleanup = time.time()

    def run(self) -> None:
        self.console.info("BZSS Log Parser started.")
        self.console.info(f"SessionID={self.session_id}")
        self.console.info(f"PollInterval={self.poll_interval}s")

        while True:
            try:
                self.tick()
                time.sleep(self.poll_interval)

            except KeyboardInterrupt:
                print("")
                self.console.info("Stopped by user.")
                self.tail_reader.close()
                break

            except Exception as e:
                self.console.error(f"Main loop error: {e}")
                time.sleep(1.0)

    def tick(self) -> None:
        lines = self.tail_reader.read_new_lines()

        for line in lines:
            self.process_line(line)

        now = time.time()

        if now - self._last_cleanup > 300:
            self.identity_cache.cleanup()
            self._last_cleanup = now

    def process_line(self, line: str) -> None:
        line = line.rstrip("\r\n")

        if not line:
            return

        # 0. 先保存 TailReader 实际收到的原始日志。
        #    这个动作独立于事件解析和黑名单过滤。
        self.raw_input_writer.write(line)

        try:
            # 1. 先更新身份缓存，不转发。
            self.auxiliary_identity_matcher.update(line)

            # 2. 先匹配白名单事件。
            matched = self.match_event(line)

            if matched:
                event_name, params = matched
                event = self.builder.build(event_name, params, line)

                # 先落盘，再 UDP。
                self.writer.write_event(event)
                self.udp_sender.send(event)

                self.console.event(event)

                return

            # 3. 没命中白名单事件，再检查黑名单。
            if self.blacklist.is_blacklisted(line):
                return

            # 4. 未匹配、未黑名单，按配置写 Unknown。
            if self.write_unknown:
                self.writer.write_unknown(line)

        except Exception as e:
            self.writer.write_parse_error(line, str(e))
            self.console.warn(f"Parse error: {e}")

    def match_event(self, line: str) -> Optional[MatchedEvent]:
        for matcher in self.matchers:
            matched = matcher.match(line)
            if matched:
                return matched

        return None
