#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import os
import time
import uuid
from pathlib import Path
from typing import Dict, Iterable, Optional, TextIO


def write_text_atomic(path: str | Path, text: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(str(text), encoding="utf-8", newline="")
        temporary.replace(target)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


class BufferedFileWriter:
    """Long-lived append writer used by LogPost hot paths."""

    def __init__(
        self,
        path: str | Path,
        *,
        flush_interval_ms: int = 75,
        batch_bytes: int = 128 * 1024,
        flush_first_write: bool = False,
    ) -> None:
        self.path = Path(path)
        self.flush_interval_s = max(0.01, int(flush_interval_ms) / 1000.0)
        self.batch_bytes = max(4096, int(batch_bytes))
        self.flush_first_write = bool(flush_first_write)
        self.file: Optional[TextIO] = None
        self.pending: list[str] = []
        self.pending_bytes = 0
        self.last_flush = time.monotonic()
        self.writes = 0
        self.flushes = 0
        self.bytes_written = 0

    def write(self, text: str) -> None:
        value = str(text or "")
        if not value:
            return
        self.pending.append(value)
        self.pending_bytes += len(value.encode("utf-8"))
        self.writes += 1
        if self.flush_first_write and self.flushes == 0:
            self.flush(force=True)
        elif self.pending_bytes >= self.batch_bytes:
            self.flush()

    def flush(self, force: bool = False) -> None:
        if not self.pending:
            return
        if not force and time.monotonic() - self.last_flush < self.flush_interval_s:
            return

        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.file is None:
            self.file = self.path.open("a", encoding="utf-8", newline="")

        payload = "".join(self.pending)
        self.pending.clear()
        self.pending_bytes = 0
        self.file.write(payload)
        self.file.flush()
        self.bytes_written += len(payload.encode("utf-8"))
        self.flushes += 1
        self.last_flush = time.monotonic()

    def close(self) -> None:
        self.flush(force=True)
        if self.file is not None:
            self.file.close()
            self.file = None

    def __enter__(self) -> "BufferedFileWriter":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


class BufferedWriterRegistry:
    def __init__(
        self,
        *,
        flush_interval_ms: int = 75,
        batch_bytes: int = 128 * 1024,
        flush_first_write: bool = True,
    ) -> None:
        self.flush_interval_ms = flush_interval_ms
        self.batch_bytes = batch_bytes
        self.flush_first_write = flush_first_write
        self.writers: Dict[str, BufferedFileWriter] = {}

    def get(self, path: str | Path, **kwargs) -> BufferedFileWriter:
        key = str(Path(path))
        writer = self.writers.get(key)
        if writer is None:
            options = {
                "flush_interval_ms": self.flush_interval_ms,
                "batch_bytes": self.batch_bytes,
                "flush_first_write": self.flush_first_write,
                **kwargs,
            }
            writer = BufferedFileWriter(path, **options)
            self.writers[key] = writer
        return writer

    def flush_all(self, force: bool = False) -> None:
        for writer in self.writers.values():
            writer.flush(force=force)

    def close(self) -> None:
        for writer in self.writers.values():
            writer.close()
        self.writers.clear()
