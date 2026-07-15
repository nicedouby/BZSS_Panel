#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from typing import Any, Callable, Dict, Optional


DIAGNOSTIC_PREFIX = "[BZSS_DIAG] "
DEFAULT_EMIT_INTERVAL_SECONDS = 1.0


class LogPostRuntimeProbe:
    """Low-overhead in-process probe for the Python LogPost pipeline.

    The probe wraps existing bound methods and only accumulates monotonic-clock
    durations and counters. Once per interval it prints one compact JSON line;
    the Node PythonLogParserManager consumes that line without storing raw logs.
    """

    def __init__(self, app: Any, config: Dict[str, Any]) -> None:
        self.app = app
        self.config = config
        diagnostic_config = config.get("diagnostics", {}) if isinstance(config, dict) else {}
        self.enabled = bool(diagnostic_config.get("enabled", True))
        self.emit_interval_seconds = max(
            0.5,
            float(diagnostic_config.get("emit_interval_seconds", DEFAULT_EMIT_INTERVAL_SECONDS) or DEFAULT_EMIT_INTERVAL_SECONDS),
        )
        self.started_at = time.perf_counter()
        self.window_started_at = self.started_at
        self.counters: Dict[str, int] = defaultdict(int)
        self.durations: Dict[str, float] = defaultdict(float)
        self.max_line_seconds = 0.0
        self.installed = False

    def install(self) -> None:
        if not self.enabled or self.installed:
            return
        self.installed = True

        self._wrap_tail_reader()
        self._wrap_timed(self.app, "process_line", "process_total", count_key="lines_processed", track_max_line=True)
        self._wrap_timed(self.app, "try_parse_bzss_core_player_chunk", "bzss_parse", count_key="bzss_parse_calls")
        self._wrap_timed(self.app, "match_event", "matchers", count_key="matcher_calls")

        self._wrap_timed(self.app.raw_archive_writer, "write", "raw_archive_write", count_key="raw_archive_writes")
        self._wrap_timed(self.app.raw_input_writer, "write", "raw_input_write", count_key="raw_input_writes")
        self._wrap_timed(self.app.writer, "write_event", "event_write", count_key="event_writes")
        self._wrap_timed(self.app.writer, "write_unknown", "event_write", count_key="unknown_writes")
        self._wrap_timed(self.app.writer, "write_preserved", "event_write", count_key="preserved_writes")
        self._wrap_timed(self.app.writer, "write_parse_error", "event_write", count_key="parse_error_writes")
        self._wrap_timed(self.app.writer, "write_outbox", "outbox_write", count_key="outbox_writes")
        self._wrap_timed(self.app.writer, "write_audit", "audit_write", count_key="audit_writes")
        self._wrap_timed(self.app.udp_sender, "send", "udp_send", count_key="udp_send_calls")
        self._wrap_tick()

    def _wrap_tail_reader(self) -> None:
        target = self.app.tail_reader
        original = getattr(target, "read_new_lines", None)
        if not callable(original):
            return

        def wrapped(*args: Any, **kwargs: Any) -> Any:
            before_position = int(getattr(target, "position", 0) or 0)
            started = time.perf_counter()
            try:
                records = original(*args, **kwargs)
                count = len(records) if isinstance(records, list) else 0
                self.counters["lines_read"] += count
                after_position = int(getattr(target, "position", before_position) or before_position)
                self.counters["source_bytes_read"] += max(0, after_position - before_position)
                return records
            finally:
                self.durations["tail_read"] += max(0.0, time.perf_counter() - started)

        setattr(target, "read_new_lines", wrapped)

    def _wrap_timed(
        self,
        target: Any,
        method_name: str,
        duration_key: str,
        *,
        count_key: Optional[str] = None,
        track_max_line: bool = False,
    ) -> None:
        original = getattr(target, method_name, None)
        if not callable(original):
            return

        def wrapped(*args: Any, **kwargs: Any) -> Any:
            started = time.perf_counter()
            try:
                return original(*args, **kwargs)
            finally:
                elapsed = max(0.0, time.perf_counter() - started)
                self.durations[duration_key] += elapsed
                if count_key:
                    self.counters[count_key] += 1
                if track_max_line:
                    self.max_line_seconds = max(self.max_line_seconds, elapsed)

        setattr(target, method_name, wrapped)

    def _wrap_tick(self) -> None:
        original = getattr(self.app, "tick", None)
        if not callable(original):
            return

        def wrapped(*args: Any, **kwargs: Any) -> Any:
            started = time.perf_counter()
            try:
                return original(*args, **kwargs)
            finally:
                self.durations["tick_total"] += max(0.0, time.perf_counter() - started)
                self.counters["ticks"] += 1
                self._emit_if_due()

        setattr(self.app, "tick", wrapped)

    def _emit_if_due(self) -> None:
        now = time.perf_counter()
        elapsed = now - self.window_started_at
        if elapsed < self.emit_interval_seconds:
            return

        payload = self._build_payload(now, elapsed)
        try:
            print(DIAGNOSTIC_PREFIX + json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)
        except Exception:
            pass
        self.window_started_at = now
        self.counters.clear()
        self.durations.clear()
        self.max_line_seconds = 0.0

    def _build_payload(self, now: float, elapsed: float) -> Dict[str, Any]:
        tail_reader = self.app.tail_reader
        source_path = str(getattr(tail_reader, "log_path", "") or "")
        position = int(getattr(tail_reader, "position", 0) or 0)
        source_size = 0
        try:
            source_size = int(os.path.getsize(source_path)) if source_path else 0
        except OSError:
            source_size = 0

        durations_ms = {key: round(value * 1000.0, 3) for key, value in self.durations.items()}
        file_io_seconds = sum(
            self.durations.get(key, 0.0)
            for key in (
                "raw_archive_write",
                "raw_input_write",
                "event_write",
                "outbox_write",
                "audit_write",
            )
        )
        read_seconds = self.durations.get("tail_read", 0.0)
        parse_seconds = self.durations.get("bzss_parse", 0.0) + self.durations.get("matchers", 0.0)
        udp_seconds = self.durations.get("udp_send", 0.0)
        tick_seconds = max(self.durations.get("tick_total", 0.0), 0.000001)
        measured_seconds = read_seconds + parse_seconds + file_io_seconds + udp_seconds
        other_seconds = max(0.0, tick_seconds - measured_seconds)
        shares = {
            "read": read_seconds / tick_seconds,
            "parse": parse_seconds / tick_seconds,
            "fileIo": file_io_seconds / tick_seconds,
            "udp": udp_seconds / tick_seconds,
            "other": other_seconds / tick_seconds,
        }
        slowest_stage = max(shares, key=shares.get) if shares else "unknown"

        return {
            "schema": "bzss.logpost.runtime-diagnostics.v1",
            "sampledAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
            "intervalMs": round(elapsed * 1000.0, 3),
            "uptimeSeconds": round(now - self.started_at, 3),
            "pid": os.getpid(),
            "source": {
                "path": source_path,
                "position": position,
                "sizeBytes": source_size,
                "backlogBytes": max(0, source_size - position),
                "mode": str(getattr(tail_reader, "current_mode", "") or ""),
            },
            "rates": {
                "linesReadPerSec": round(self.counters.get("lines_read", 0) / elapsed, 3),
                "linesProcessedPerSec": round(self.counters.get("lines_processed", 0) / elapsed, 3),
                "sourceBytesReadPerSec": round(self.counters.get("source_bytes_read", 0) / elapsed, 3),
                "eventsWrittenPerSec": round(self.counters.get("event_writes", 0) / elapsed, 3),
                "udpSendsPerSec": round(self.counters.get("udp_send_calls", 0) / elapsed, 3),
            },
            "counts": dict(self.counters),
            "durationsMs": durations_ms,
            "stageShare": {key: round(value, 4) for key, value in shares.items()},
            "slowestStage": slowest_stage,
            "maxLineProcessMs": round(self.max_line_seconds * 1000.0, 3),
        }


def install_runtime_probe(app: Any, config: Dict[str, Any]) -> LogPostRuntimeProbe:
    probe = LogPostRuntimeProbe(app, config)
    probe.install()
    return probe
