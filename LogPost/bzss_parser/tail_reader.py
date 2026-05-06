#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import BinaryIO, List, Optional


class TailReader:
    def __init__(self, log_file: str, from_end: bool, reopen_on_truncate: bool) -> None:
        self.log_path = Path(log_file)
        self.from_end = from_end
        self.reopen_on_truncate = reopen_on_truncate

        self.file: Optional[BinaryIO] = None
        self.position = 0
        self.partial = ""
        self._last_missing_warn = 0.0

    def open(self) -> bool:
        if not self.log_path.exists():
            now = time.time()

            if now - self._last_missing_warn > 5:
                print(f"[WARN] Log file not found: {self.log_path}")
                self._last_missing_warn = now

            return False

        self.file = self.log_path.open("rb")

        if self.from_end:
            self.file.seek(0, os.SEEK_END)
        else:
            self.file.seek(0, os.SEEK_SET)

        self.position = self.file.tell()
        self.partial = ""

        print(f"[INFO] Tailing: {self.log_path} from position {self.position}")
        return True

    def close(self) -> None:
        if self.file:
            try:
                self.file.close()
            except Exception:
                pass

        self.file = None

    def read_new_lines(self) -> List[str]:
        if self.file is None:
            if not self.open():
                return []

        if self.file is None:
            return []

        try:
            current_size = self.log_path.stat().st_size
        except FileNotFoundError:
            self.close()
            return []

        if self.reopen_on_truncate and current_size < self.position:
            print("[INFO] Log file truncated or recreated. Reopening.")
            self.close()
            self.open()
            return []

        self.file.seek(self.position)
        data = self.file.read()
        self.position = self.file.tell()

        if not data:
            return []

        text = data.decode("utf-8", errors="replace")
        text = self.partial + text

        if text.endswith("\n"):
            self.partial = ""
            raw_lines = text.splitlines()
        else:
            parts = text.splitlines()

            if not parts:
                return []

            self.partial = parts[-1]
            raw_lines = parts[:-1]

        return [line.rstrip("\r\n") for line in raw_lines if line.strip()]
