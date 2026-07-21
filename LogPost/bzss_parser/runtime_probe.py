#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import os
import time
from collections import defaultdict, deque
from functools import wraps
from typing import Any, Callable, Dict, Optional


DIAGNOSTIC_PREFIX = "[BZSS_DIAG] "
DEFAULT_EMIT_INTERVAL_SECONDS = 1.0

STAGE_KEYS = (
    "tail_read",
    "record_decode",
    "metadata_build",
    "blacklist_filter",
    "preserve_filter",
    "identity_update",
    "combat_match",
    "generic_matchers",
    "event_build",
    "raw_archive_queue",
    "event_queue",
    "udp_send",
    "checkpoint_prepare",
    "checkpoint_flush_data",
    "checkpoint_save_state",
    "raw_index_write",
    "console_output",
)


class LogPostRuntimeProbe:
    """Low-overhead timing probe for the ordered Python LogPost pipeline."""

    def __init__(self, app: Any, config: Dict[str, Any]) -> None:
        self.app = app
        self.config = config
        diagnostic_config = config.get("diagnostics", {}) if isinstance(config, dict) else {}
        self.enabled = bool(diagnostic_config.get("enabled", True))
        self.emit_interval_seconds = max(
            0.5,
            float(
                diagnostic_config.get(
                    "emit_interval_seconds",
                    DEFAULT_EMIT_INTERVAL_SECONDS,
                )
                or DEFAULT_EMIT_INTERVAL_SECONDS
            ),
        )
        self.started_at = time.perf_counter()
        self.window_started_at = self.started_at
        self.counters: Dict[str, int] = defaultdict(int)
        self.durations: Dict[str, float] = defaultdict(float)
        self.line_samples = deque(maxlen=4096)
        self.checkpoint_samples = deque(maxlen=1024)
        self.installed = False

    def install(self) -> None:
        if not self.enabled or self.installed:
            return
        self.installed = True
        # Let the application expose the probe for future explicit instrumentation.
        setattr(self.app, "runtime_probe", self)

        self._wrap_tail_reader()
        self._wrap_timed(self.app, "process_line", "process_total", count_key="lines_processed", sample="line")
        self._wrap_timed(self.app, "try_parse_bzss_core_player_chunk", "bzss_parse", count_key="bzss_parse_calls", sample="player")
        self._wrap_timed(self.app, "build_raw_meta_only", "record_decode")
        self._wrap_timed(self.app, "build_source_meta", "metadata_build")
        self._wrap_timed(self.app, "match_event", "generic_matchers", count_key="matcher_calls")
        self._wrap_timed(self.app, "persist_checkpoint", "checkpoint_prepare", count_key="checkpoint_prepare_calls")
        self._wrap_timed(self.app, "flush_pending_checkpoint", "checkpoint_total", sample="checkpoint")

        self._wrap_timed(self.app.blacklist, "is_blacklisted", "blacklist_filter")
        self._wrap_timed(self.app.preserve_filter, "match", "preserve_filter")
        self._wrap_timed(self.app.auxiliary_identity_matcher, "update", "identity_update")
        self._wrap_timed(self.app.combat_matcher, "match", "combat_match")

        self._wrap_timed(self.app.raw_archive_writer, "write", "raw_archive_queue", count_key="raw_archive_writes")
        self._wrap_timed(self.app.raw_archive_writer, "flush_data", "checkpoint_flush_data")
        self._wrap_timed(self.app.raw_archive_writer, "flush_index", "raw_index_write")
        self._wrap_timed(self.app.writer, "write_event", "event_queue", count_key="event_writes")
        self._wrap_timed(self.app.writer, "write_unknown", "event_queue", count_key="unknown_writes")
        self._wrap_timed(self.app.writer, "write_preserved", "event_queue", count_key="preserved_writes")
        self._wrap_timed(self.app.writer, "write_parse_error", "event_queue", count_key="parse_error_writes")
        self._wrap_timed(self.app.writer, "write_outbox", "event_queue", count_key="outbox_writes")
        self._wrap_timed(self.app.writer, "flush_all", "checkpoint_flush_data")
        self._wrap_timed(self.app.writer, "write_audit", "event_queue", count_key="audit_writes")
        self._wrap_timed(self.app.tail_reader, "persist_state", "checkpoint_save_state")
        self._wrap_timed(self.app.udp_sender, "send", "udp_send", count_key="udp_send_calls")

        for method_name in ("event", "warn", "info", "error"):
            self._wrap_timed(self.app.console, method_name, "console_output")
        self._wrap_tick()

    def _wrap_tail_reader(self) -> None:
        target = self.app.tail_reader
        original = getattr(target, "read_new_lines", None)
        if not callable(original):
            return

        @wraps(original)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            before_position = int(getattr(target, "position", 0) or 0)
            started = time.perf_counter()
            try:
                records = original(*args, **kwargs)
                if isinstance(records, list):
                    self.counters["lines_read"] += len(records)
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
        sample: Optional[str] = None,
    ) -> None:
        original = getattr(target, method_name, None)
        if not callable(original):
            return

        @wraps(original)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            started = time.perf_counter()
            try:
                return original(*args, **kwargs)
            finally:
                elapsed = max(0.0, time.perf_counter() - started)
                self.durations[duration_key] += elapsed
                if count_key:
                    self.counters[count_key] += 1
                if sample == "line":
                    self.line_samples.append(elapsed * 1000.0)
                elif sample == "checkpoint":
                    self.checkpoint_samples.append(elapsed * 1000.0)
                elif sample == "player":
                    self.counters["player_chunk_parse_calls"] += 1

        setattr(target, method_name, wrapped)

    def _wrap_tick(self) -> None:
        original = getattr(self.app, "tick", None)
        if not callable(original):
            return

        @wraps(original)
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
            print(
                DIAGNOSTIC_PREFIX
                + json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                flush=True,
            )
        except Exception:
            pass

        self.window_started_at = now
        self.counters.clear()
        self.durations.clear()
        self.line_samples.clear()
        self.checkpoint_samples.clear()

    @staticmethod
    def _percentile(values: Any, percentile: float) -> float:
        ordered = sorted(float(value) for value in values if value is not None)
        if not ordered:
            return 0.0
        index = min(len(ordered) - 1, max(0, int(round((percentile / 100.0) * (len(ordered) - 1)))))
        return ordered[index]

    def _queue_stats(self) -> Dict[str, int]:
        pending_items = 0
        pending_bytes = 0
        for owner_name in ("writer", "raw_archive_writer", "raw_input_writer"):
            owner = getattr(self.app, owner_name, None)
            registry = getattr(owner, "_writers", None)
            for writer in getattr(registry, "writers", {}).values():
                pending_items += len(getattr(writer, "pending", []) or [])
                pending_bytes += int(getattr(writer, "pending_bytes", 0) or 0)
        return {"items": pending_items, "bytes": pending_bytes}

    def _build_payload(self, now: float, elapsed: float) -> Dict[str, Any]:
        tail_reader = self.app.tail_reader
        source_path = str(getattr(tail_reader, "log_path", "") or "")
        position = int(getattr(tail_reader, "position", 0) or 0)
        source_size = 0
        try:
            source_size = int(os.path.getsize(source_path)) if source_path else 0
        except OSError:
            pass

        durations_ms = {
            key: round(self.durations.get(key, 0.0) * 1000.0, 3)
            for key in STAGE_KEYS
        }
        durations_ms["process_total"] = round(self.durations.get("process_total", 0.0) * 1000.0, 3)
        durations_ms["bzss_parse"] = round(self.durations.get("bzss_parse", 0.0) * 1000.0, 3)
        durations_ms["matchers"] = durations_ms["generic_matchers"]
        durations_ms["raw_archive_write"] = durations_ms["raw_archive_queue"]
        durations_ms["event_write"] = durations_ms["event_queue"]
        durations_ms["outbox_write"] = durations_ms["event_queue"]
        durations_ms["audit_write"] = durations_ms["event_queue"]

        read_seconds = self.durations.get("tail_read", 0.0)
        parse_seconds = (
            self.durations.get("record_decode", 0.0)
            + self.durations.get("metadata_build", 0.0)
            + self.durations.get("combat_match", 0.0)
            + self.durations.get("generic_matchers", 0.0)
            + self.durations.get("bzss_parse", 0.0)
        )
        file_io_seconds = (
            self.durations.get("raw_archive_queue", 0.0)
            + self.durations.get("event_queue", 0.0)
            + self.durations.get("checkpoint_flush_data", 0.0)
            + self.durations.get("checkpoint_save_state", 0.0)
            + self.durations.get("raw_index_write", 0.0)
        )
        udp_seconds = self.durations.get("udp_send", 0.0)
        measured_seconds = read_seconds + parse_seconds + file_io_seconds + udp_seconds
        tick_seconds = max(self.durations.get("tick_total", 0.0), measured_seconds, 0.000001)
        shares = {
            "read": read_seconds / tick_seconds,
            "parse": parse_seconds / tick_seconds,
            "fileIo": file_io_seconds / tick_seconds,
            "udp": udp_seconds / tick_seconds,
            "other": max(0.0, tick_seconds - measured_seconds) / tick_seconds,
        }
        slowest_stage = max(shares, key=shares.get) if shares else "unknown"
        queue_stats = self._queue_stats()
        line_avg = (
            sum(self.line_samples) / len(self.line_samples)
            if self.line_samples
            else 0.0
        )
        line_p95 = self._percentile(self.line_samples, 95)
        line_p99 = self._percentile(self.line_samples, 99)
        checkpoint_p95 = self._percentile(self.checkpoint_samples, 95)
        checkpoint_max = max(self.checkpoint_samples, default=0.0)
        player_calls = self.counters.get("player_chunk_parse_calls", 0)
        player_ms = (
            self.durations.get("bzss_parse", 0.0) * 1000.0 / player_calls
            if player_calls
            else 0.0
        )

        return {
            "schema": "bzss.logpost.runtime-diagnostics.v2",
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
            "stages": {
                key: {
                    "durationMs": durations_ms[key],
                    "share": round(self.durations.get(key, 0.0) / tick_seconds, 4),
                }
                for key in STAGE_KEYS
            },
            "slowestStage": slowest_stage,
            "maxLineProcessMs": round(max(self.line_samples, default=0.0), 3),
            "processLineAvgMs": round(line_avg, 3),
            "processLineP95Ms": round(line_p95, 3),
            "processLineP99Ms": round(line_p99, 3),
            "checkpointMaxMs": round(checkpoint_max, 3),
            "checkpointP95Ms": round(checkpoint_p95, 3),
            "batchLines": int(self.counters.get("lines_processed", 0)),
            "batchBytes": int(self.counters.get("source_bytes_read", 0)),
            "writerQueueDepth": queue_stats["items"],
            "writerQueueBytes": queue_stats["bytes"],
            "playerChunkParseMs": round(player_ms, 3),
        }


def install_runtime_probe(app: Any, config: Dict[str, Any]) -> LogPostRuntimeProbe:
    probe = LogPostRuntimeProbe(app, config)
    probe.install()
    return probe
