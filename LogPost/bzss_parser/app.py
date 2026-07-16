#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import re
import time
from collections import deque
from typing import Any, Dict, List, Optional, Tuple

from bzss_parser.blacklist import BlacklistFilter
from bzss_parser.console_printer import ConsolePrinter
from bzss_parser.event_builder import EventBuilder
from bzss_parser.helpers import extract_log_time, make_session_id, sha1_hex
from bzss_parser.identity_cache import IdentityCache
from bzss_parser.logpost_writer import LogPostWriter
from bzss_parser.matchers.auxiliary_identity_matcher import AuxiliaryIdentityMatcher
from bzss_parser.matchers.combat_matcher import CombatMatcher
from bzss_parser.matchers.login_matcher import LoginMatcher
from bzss_parser.matchers.round_end_matcher import RoundEndMatcher
from bzss_parser.matchers.server_tick_rate_matcher import ServerTickRateMatcher
from bzss_parser.matchers.spawn_matcher import SpawnMatcher
from bzss_parser.matchers.squad_matcher import SquadMatcher
from bzss_parser.matchers.world_bring_up_matcher import WorldBringUpMatcher
from bzss_parser.preserve_filter import PreserveFilter
from bzss_parser.raw_archive_writer import RawArchiveWriter
from bzss_parser.raw_input_writer import RawInputWriter
from bzss_parser.source_state_store import SourceStateStore
from bzss_parser.tail_reader import TailReader
from bzss_parser.udp_sender import UdpSender


MatchedEvent = Tuple[str, List[Tuple[str, str]]]

BZSS_CORE_RUNTIME_LINE_RE = re.compile(r"\{\s*ID\s*:\s*-?\d+\s*,\s*Pos\s*:", re.IGNORECASE)
BZSS_CORE_SCOREBOARD_LINE_RE = re.compile(r"\bPlayerScoreboard\s*\{", re.IGNORECASE)

def is_bzss_core_runtime_line(line: str) -> bool:
    return bool(BZSS_CORE_RUNTIME_LINE_RE.search(str(line or "")))

def is_bzss_core_scoreboard_line(line: str) -> bool:
    return bool(BZSS_CORE_SCOREBOARD_LINE_RE.search(str(line or "")))


class BzssLogParserApp:
    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config

        self.session_id = make_session_id()
        self.identity_cache = IdentityCache()

        self.auxiliary_identity_matcher = AuxiliaryIdentityMatcher(self.identity_cache)
        self.combat_matcher = CombatMatcher(self.identity_cache)
        self.matchers = [
            LoginMatcher(),
            self.combat_matcher,
            ServerTickRateMatcher(self.config.get("server_tick_rate", {})),
            WorldBringUpMatcher(),
            RoundEndMatcher(),
            SpawnMatcher(self.identity_cache),
            SquadMatcher(self.identity_cache),
        ]

        self.blacklist = BlacklistFilter(self.config.get("blacklist_contains", []))
        self.transport_only = bool(self.config.get("transport_only", False))
        preserve_config = self.config.get("preserve", {})
        self.preserve_enabled = bool(preserve_config.get("enabled", True))
        self.preserve_write_file = bool(preserve_config.get("write_file", True)) and not self.transport_only
        self.preserve_filter = PreserveFilter(preserve_config.get("contains", []))

        self.builder = EventBuilder(
            server_id=str(self.config.get("server_id", "BZSS_Main")),
            session_id=self.session_id,
            max_raw_chars=int(self.config.get("raw", {}).get("max_raw_chars", 4096)),
        )
        storage_config = self.config.get("storage", {})
        flush_interval_ms = int(storage_config.get("flush_interval_ms", 75) or 75)
        batch_bytes = int(storage_config.get("batch_bytes", 128 * 1024) or 128 * 1024)
        index_interval_ms = int(storage_config.get("index_interval_ms", 5000) or 5000)
        index_batch_bytes = int(storage_config.get("index_batch_bytes", 1024 * 1024) or 1024 * 1024)

        self.writer = LogPostWriter(
            output_dir=str(self.config.get("output_dir", "./LogPost")),
            write_v2_events=bool(storage_config.get("write_v2_events", True)),
            write_legacy_events=bool(storage_config.get("write_legacy_events", False)),
            flush_interval_ms=flush_interval_ms,
            batch_bytes=batch_bytes,
        )
        self.raw_archive_writer = RawArchiveWriter(
            output_dir=str(self.config.get("output_dir", "./LogPost")),
            write_v2_raw_archive=bool(storage_config.get("write_v2_raw_archive", True)),
            write_legacy_raw_archive=bool(storage_config.get("write_legacy_raw_archive", False)),
            flush_interval_ms=flush_interval_ms,
            batch_bytes=batch_bytes,
            index_interval_ms=index_interval_ms,
            index_batch_bytes=index_batch_bytes,
        )
        self.writer.preserved_file_name = str(
            preserve_config.get("file_name", "Preserved.jsonl")
        )

        raw_input_config = self.config.get("raw_input_log", {})
        self.raw_input_writer = RawInputWriter(
            enabled=bool(raw_input_config.get("enabled", True)) and not self.transport_only,
            output_dir=str(raw_input_config.get("output_dir", "./ReceivedLogs")),
            file_name=str(raw_input_config.get("file_name", "Received.log")),
            fmt=str(raw_input_config.get("format", "raw")),
            flush_interval_ms=int(raw_input_config.get("flush_interval_ms", flush_interval_ms) or flush_interval_ms),
            batch_bytes=int(raw_input_config.get("batch_bytes", batch_bytes) or batch_bytes),
        )
        raw_log_output_config = self.config.get("raw_log_output", {})
        self.raw_log_output_enabled = bool(raw_log_output_config.get("enabled", False))
        self.raw_log_output_source = str(raw_log_output_config.get("source", "Squad.log"))
        self.raw_log_output_only_preserved = bool(raw_log_output_config.get("only_preserved", False))
        self.raw_log_output_drop_blacklisted = bool(raw_log_output_config.get("drop_blacklisted", True))
        self.raw_log_output_contains = [
            str(token)
            for token in raw_log_output_config.get("contains", [])
            if str(token)
        ]
        self.raw_log_output_max_per_second = max(
            1,
            int(raw_log_output_config.get("max_per_second", 20) or 20),
        )
        self._raw_log_forward_times: deque[float] = deque()

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
            max_payload_bytes=int(udp_config.get("max_payload_bytes", 16384)),
        )

        tail_config = self.config.get("tail", {})
        state_store = SourceStateStore(
            str(
                tail_config.get(
                    "state_path",
                    str(self.writer.output_dir / ".state" / "tailer-state.json"),
                )
            )
        )
        self.tail_reader = TailReader(
            log_file=str(self.config.get("log_file", "./Squad.log")),
            from_end=bool(tail_config.get("from_end", True)),
            reopen_on_truncate=bool(tail_config.get("reopen_on_truncate", True)),
            state_store=state_store,
        )

        self.poll_interval = max(
            0.05,
            int(self.config.get("poll_interval_ms", 200)) / 1000.0,
        )

        self.write_unknown = bool(
            self.config.get("unknown", {}).get("write_unknown", False)
        )
        checkpoint_config = self.config.get("checkpoint", {})
        self.checkpoint_flush_every_lines = max(
            1,
            int(checkpoint_config.get("flush_every_lines", 500) or 500),
        )
        self.checkpoint_flush_every_ms = max(
            1,
            int(checkpoint_config.get("flush_every_ms", 500) or 500),
        )
        self.checkpoint_force_on_event = bool(
            checkpoint_config.get("force_on_event", True)
        )
        self._checkpoint_dirty_lines = 0
        self._last_checkpoint_flush = time.time()
        self._last_checkpoint_record: Optional[Dict[str, Any]] = None
        self._last_checkpoint_mode = "live"

        self._last_cleanup = time.time()
        self._last_stats_report = time.time()
        self.stats = {
            "lines_read": 0,
            "events_matched": 0,
            "lines_preserved": 0,
            "lines_blacklisted": 0,
            "lines_unknown": 0,
            "parse_errors": 0,
        }
        self.source_seq = int(self.tail_reader.state.get("seq", 0) or 0)

    def run(self) -> None:
        self.console.info("BZSS Log Parser started.")
        self.console.info(f"SessionID={self.session_id}")
        self.console.info(f"PollInterval={self.poll_interval}s")
        for rule in self.blacklist.rejected_rules:
            self.console.warn(f"Broad log-channel blacklist rule rejected: {rule}")

        while True:
            try:
                self.tick()
                time.sleep(self.poll_interval)

            except KeyboardInterrupt:
                print("")
                self.console.info("Stopped by user.")
                self.flush_pending_checkpoint(force=True)
                self.flush_storage(force=True)
                self.close_storage()
                self.tail_reader.close()
                break

            except Exception as e:
                self.console.error(f"Main loop error: {e}")
                time.sleep(1.0)

    def tick(self) -> None:
        rotate_reason = self.tail_reader.consume_rotate_reason()
        if rotate_reason:
            self.handle_rotate_event(rotate_reason)

        lines = self.tail_reader.read_new_lines()

        for record in lines:
            if not self.process_line(record):
                break

        now = time.time()

        if now - self._last_cleanup > 300:
            self.identity_cache.cleanup()
            self._last_cleanup = now

        if now - self._last_stats_report >= 60:
            self.report_stats()
            self._last_stats_report = now

        self.flush_pending_checkpoint()
        self.flush_storage(force=False)

    def flush_storage(self, force: bool = False) -> None:
        if self.transport_only:
            return
        self.writer.flush_all(force=force)
        self.raw_archive_writer.flush_all(force=force)
        self.raw_input_writer.flush_all(force=force)

    def close_storage(self) -> None:
        if self.transport_only:
            return
        self.writer.close()
        self.raw_archive_writer.close()
        self.raw_input_writer.close()

    def process_line(self, record: Dict[str, Any]) -> bool:
        line = str(record.get("line", "")).rstrip("\r\n")
        line = line.rstrip("\r\n")

        if not line:
            return True

        source_mode = str(record.get("sourceMode", "live") or "live")
        self.source_seq += 1
        self.stats["lines_read"] += 1

        raw_archive = self.build_raw_meta_only(record, line, source_mode)
        source_meta = self.build_source_meta(raw_archive)
        meta_for_files = {
            "SourceSeq": str(raw_archive.get("seq", "")),
            "SourceOffset": str(raw_archive.get("offset", "")),
            "RawLineHash": str(raw_archive.get("rawLineHash", "")),
            "SourcePath": str(raw_archive.get("sourcePath", "")),
        }

        try:
            chunk_event = self.try_parse_bzss_core_player_chunk(line, source_meta, raw_archive)
            if chunk_event:
                self.udp_sender.send(chunk_event)
                self.stats["events_matched"] += 1
                if self.checkpoint_force_on_event:
                    self.persist_checkpoint(record, source_mode, force=True)
                self.console.event(chunk_event)
                return True

            early_preserved_rule = ""
            if self.preserve_enabled:
                early_preserved_rule = self.preserve_filter.match(line)

            if self.blacklist.is_blacklisted(line) and not early_preserved_rule:
                self.stats["lines_blacklisted"] += 1
                self.persist_checkpoint_only(record, source_mode)
                return True

            if not self.transport_only:
                try:
                    self.raw_archive_writer.write(
                        seq=int(raw_archive.get("seq", 0) or 0),
                        offset=int(raw_archive.get("offset", 0) or 0),
                        raw_line=line,
                        source_path=str(raw_archive.get("sourcePath", "")),
                        source_mode=source_mode,
                    )
                except Exception as e:
                    self.tail_reader.rewind_to_offset(int(record.get("offset", 0) or 0))
                    self.console.warn(f"Raw archive write failed; rewinding: {e}")
                    return False

            self.persist_checkpoint(
                record,
                source_mode,
                last_raw_line_hash=str(raw_archive.get("rawLineHash", "")),
                last_log_time=str(raw_archive.get("logTime", "")),
                force=False,
            )

            if not self.transport_only:
                try:
                    self.raw_input_writer.write(line)
                except Exception as e:
                    self.console.warn(f"Raw input write failed: {e}")

            self.auxiliary_identity_matcher.update(line)

            if looks_like_combat_line(line):
                matched = self.combat_matcher.match(line)
                if matched:
                    self.emit_matched_event(matched, line, source_meta, record, source_mode)
                    return True

            matched = self.match_event(line, meta_for_files)
            if matched:
                self.emit_matched_event(matched, line, source_meta, record, source_mode)
                return True

            preserved_rule = ""
            if self.preserve_enabled:
                preserved_rule = early_preserved_rule or self.preserve_filter.match(line)
            if preserved_rule:
                if self.preserve_write_file:
                    self.writer.write_preserved(line, preserved_rule)
                self.stats["lines_preserved"] += 1
                self.forward_raw_log_line(line, source_meta, preserved_rule=preserved_rule)
                return True

            self.forward_raw_log_line(line, source_meta, preserved_rule="")

            if self.write_unknown and not self.transport_only:
                self.writer.write_unknown(line, meta_for_files)
                self.stats["lines_unknown"] += 1

        except Exception as e:
            if not self.transport_only:
                self.writer.write_parse_error(line, str(e), meta_for_files)
            self.console.warn(f"Parse error: {e}")
            self.stats["parse_errors"] += 1
        return True

    def build_raw_meta_only(self, record: Dict[str, Any], line: str, source_mode: str) -> Dict[str, Any]:
        offset = int(record.get("offset", 0) or 0)
        source_path = str(record.get("sourcePath", ""))
        return {
            "seq": self.source_seq,
            "offset": offset,
            "logTime": extract_log_time(line),
            "rawLineHash": sha1_hex(line),
            "sourcePath": source_path,
            "sourceMode": source_mode,
        }

    @staticmethod
    def build_source_meta(raw_archive: Dict[str, Any]) -> Dict[str, Any]:
        source_mode = str(raw_archive.get("sourceMode", "live") or "live")
        return {
            "source_seq": raw_archive.get("seq"),
            "source_offset": raw_archive.get("offset"),
            "rawLineHash": raw_archive.get("rawLineHash"),
            "source_mode": source_mode,
            "can_trigger_actions": source_mode == "live",
        }

    def try_parse_bzss_core_player_chunk(
        self,
        line: str,
        source_meta: Dict[str, Any],
        raw_archive: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        normalized = self.parse_bzss_core_player_chunk_line(line)
        if not normalized:
            return None

        debug_keep_raw = bool(self.config.get("debug_keep_raw", False))
        return self.builder.build_bzss_core_player_chunk(
            seq=int(raw_archive.get("seq", 0) or 0),
            tick=normalized.get("Tick", ""),
            count=normalized.get("Count", ""),
            players=normalized.get("Players", []),
            source_meta=source_meta,
            raw=line,
            debug_keep_raw=debug_keep_raw,
        )

    @staticmethod
    def parse_bzss_core_player_chunk_line(line: str) -> Optional[Dict[str, Any]]:
        text = str(line or "").strip()
        if not text.startswith("BZSSCORE|PS|v1|"):
            return None

        parts = text.split("|", 5)
        if len(parts) < 6:
            return None

        _, _, version_tag, seq_text, tick_text, payload = parts
        if version_tag != "v1":
            return None

        if not payload.startswith("Count="):
            return None

        count_text, _, players_text = payload.partition("|Players=")
        count = count_text.split("=", 1)[1] if "=" in count_text else ""
        if not players_text:
            return {"Tick": tick_text, "Count": count, "Players": []}

        try:
            players = json.loads(players_text)
        except Exception:
            return None

        if not isinstance(players, list):
            return None

        return {
            "Version": version_tag,
            "Seq": seq_text,
            "Tick": tick_text,
            "Count": count,
            "Players": players,
        }

    def match_event(self, line: str, meta_for_files: Dict[str, str]) -> Optional[MatchedEvent]:
        for matcher in self.matchers:
            try:
                matched = matcher.match(line)
            except Exception as e:
                if not self.transport_only:
                    self.writer.write_parse_error(
                        line,
                        f"{matcher.__class__.__name__}: {e}",
                        meta_for_files,
                    )
                self.console.warn(f"Matcher parse error [{matcher.__class__.__name__}]: {e}")
                self.stats["parse_errors"] += 1
                continue
            if matched:
                return matched

        return None

    def emit_matched_event(
        self,
        matched: MatchedEvent,
        line: str,
        source_meta: Dict[str, Any],
        record: Dict[str, Any],
        source_mode: str,
    ) -> None:
        event_name, params = matched
        event = self.builder.build(event_name, params, line, source_meta=source_meta)
        if not self.transport_only:
            self.writer.write_event(event)
            self.writer.write_outbox("pending", event)
        try:
            self.udp_sender.send(event)
            if not self.transport_only:
                self.writer.write_outbox("send_attempted", event)
        except Exception as e:
            if not self.transport_only:
                self.writer.write_outbox("send_failed", event, str(e))
            self.console.warn(f"UDP send failed: {e}")
        self.stats["events_matched"] += 1
        if event_name in {"On_PlayerDamaged", "On_PlayerWounded", "On_PlayerDied", "On_PlayerRevived"}:
            self.stats["combat_events"] = int(self.stats.get("combat_events", 0)) + 1
        if self.checkpoint_force_on_event:
            self.persist_checkpoint(record, source_mode, force=True)
        self.console.event(event)

    def should_forward_raw_log_line(self, line: str, preserved_rule: str = "") -> bool:
        if not self.raw_log_output_enabled:
            return False

        if self.raw_log_output_drop_blacklisted and self.blacklist.is_blacklisted(line):
            return False

        # BZSS-Core runtime frames are required by the panel position monitor.
        # They are not part of the generic raw output token list because they
        # are emitted as PIE/Error lines, so keep them even when contains is set.
        if is_bzss_core_runtime_line(line) or is_bzss_core_scoreboard_line(line):
            return self.raw_log_rate_limiter_allow()

        if self.raw_log_output_only_preserved:
            return bool(preserved_rule or self.preserve_filter.match(line))

        if self.raw_log_output_contains:
            if not any(token in line for token in self.raw_log_output_contains):
                return False

        return self.raw_log_rate_limiter_allow()

    def raw_log_rate_limiter_allow(self) -> bool:
        now = time.time()
        while self._raw_log_forward_times and now - self._raw_log_forward_times[0] >= 1.0:
            self._raw_log_forward_times.popleft()
        if len(self._raw_log_forward_times) >= self.raw_log_output_max_per_second:
            return False
        self._raw_log_forward_times.append(now)
        return True

    def forward_raw_log_line(
        self,
        line: str,
        source_meta: Dict[str, Any],
        *,
        preserved_rule: str = "",
    ) -> None:
        if not self.should_forward_raw_log_line(line, preserved_rule=preserved_rule):
            return

        try:
            event = self.builder.build_raw_log_line(
                line,
                source=self.raw_log_output_source,
                source_meta=source_meta,
            )
            if not self.transport_only:
                self.writer.write_event(event)
                self.writer.write_outbox("pending", event)
            try:
                self.udp_sender.send(event)
                if not self.transport_only:
                    self.writer.write_outbox("send_attempted", event)
            except Exception as e:
                if not self.transport_only:
                    self.writer.write_outbox("send_failed", event, str(e))
                self.console.warn(f"Raw log UDP send failed: {e}")
            self.stats["rawlog_forwarded"] = int(self.stats.get("rawlog_forwarded", 0)) + 1
        except Exception as e:
            if not self.transport_only:
                self.writer.write_outbox("send_failed", {"EventId": "", "Event": "On_RawLogLine", "SourceSeq": str(source_meta.get("source_seq", "")), "SourceMode": str(source_meta.get("source_mode", "live"))}, str(e))
            self.console.warn(f"Raw log output failed: {e}")

    def persist_checkpoint_only(self, record: Dict[str, Any], source_mode: str) -> None:
        self.persist_checkpoint(record, source_mode, force=False)

    def persist_checkpoint(
        self,
        record: Dict[str, Any],
        source_mode: str,
        *,
        last_raw_line_hash: str = "",
        last_log_time: str = "",
        force: bool = False,
    ) -> None:
        if self.transport_only:
            return
        self._last_checkpoint_record = {
            "record": record,
            "source_mode": source_mode,
            "last_raw_line_hash": last_raw_line_hash,
            "last_log_time": last_log_time,
        }
        self._last_checkpoint_mode = source_mode
        self._checkpoint_dirty_lines += 1
        self.flush_pending_checkpoint(force=force)

    def flush_pending_checkpoint(self, force: bool = False) -> None:
        if self.transport_only:
            return
        if not self._last_checkpoint_record:
            return

        now = time.time()
        elapsed_ms = (now - self._last_checkpoint_flush) * 1000.0
        if (
            not force
            and self._checkpoint_dirty_lines < self.checkpoint_flush_every_lines
            and elapsed_ms < self.checkpoint_flush_every_ms
        ):
            return

        payload = self._last_checkpoint_record
        record = payload["record"]
        commit_offset = record.get("next_offset")
        if commit_offset is None:
            commit_offset = record.get("offset", 0)

        file_size = None
        file_mtime_ms = None
        try:
            file_stat = self.tail_reader.log_path.stat()
            file_size = int(getattr(file_stat, "st_size", 0) or 0)
            file_mtime_ms = int(
                getattr(
                    file_stat,
                    "st_mtime_ns",
                    int(file_stat.st_mtime * 1_000_000_000),
                ) / 1_000_000
            )
        except Exception:
            pass

        self.tail_reader.persist_state(
            self.source_seq,
            int(commit_offset or 0),
            last_raw_line_hash=str(payload.get("last_raw_line_hash", "")),
            last_log_time=str(payload.get("last_log_time", "")),
            file_size=file_size,
            file_mtime_ms=file_mtime_ms,
            mode=str(payload.get("source_mode", self._last_checkpoint_mode)),
        )
        self.writer.write_audit("checkpoint", {
            "sourcePath": str(record.get("sourcePath", "")),
            "offset": int(commit_offset or 0),
            "seq": self.source_seq,
            "sourceMode": str(payload.get("source_mode", self._last_checkpoint_mode)),
            "lastRawLineHash": str(payload.get("last_raw_line_hash", "")),
            "lastLogTime": str(payload.get("last_log_time", "")),
        })
        self._checkpoint_dirty_lines = 0
        self._last_checkpoint_flush = now

    def handle_rotate_event(self, reason: str) -> None:
        try:
            event = self.builder.build(
                "LOGPOST_SOURCE_ROTATED",
                [("Reason", reason), ("SourcePath", str(self.tail_reader.log_path))],
                "",
                source_meta={
                    "source_seq": self.source_seq,
                    "source_offset": self.tail_reader.position,
                    "rawLineHash": "",
                    "source_mode": self.tail_reader.current_mode,
                },
            )
            if not self.transport_only:
                self.writer.write_event(event)
            self.udp_sender.send(event)
            if not self.transport_only:
                self.writer.write_audit("recovery-mode", {
                    "reason": reason,
                    "sourceMode": self.tail_reader.current_mode,
                    "sourcePath": str(self.tail_reader.log_path),
                })
        except Exception as e:
            self.console.warn(f"Rotate event write failed: {e}")

    def report_stats(self) -> None:
        try:
            self.console.info(
                "LogPost stats: "
                f"read={self.stats['lines_read']} "
                f"matched={self.stats['events_matched']} "
                f"preserved={self.stats['lines_preserved']} "
                f"blacklisted={self.stats['lines_blacklisted']} "
                f"unknown={self.stats['lines_unknown']} "
                f"errors={self.stats['parse_errors']}"
            )
        except Exception:
            pass


def looks_like_combat_line(line: str) -> bool:
    return (
        ("ActualDamage=" in line and "Player:" in line and "caused by" in line)
        or ("KillingDamage=" in line and "Player:" in line and "caused by" in line)
        or ("has revived" in line and "Online IDs:" in line)
    )


