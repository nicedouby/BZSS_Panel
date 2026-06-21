#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


PROCESS_VM_READ = 0x0010
PROCESS_VM_WRITE = 0x0020
PROCESS_VM_OPERATION = 0x0008
PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

ERROR_MISSING_LAYOUT = "memory layout is not configured"


class ToolError(RuntimeError):
    pass


@dataclass(frozen=True)
class TicketField:
    address: int | None = None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="squad_ticket_tool.py")
    parser.add_argument("pid", type=int, help="SquadGameServer.exe pid")
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--read", action="store_true", help="Read current ticket values")
    action.add_argument("--watch", action="store_true", help="Watch tickets and emit JSON lines")
    parser.add_argument("--interval", type=float, default=2.0, help="Watch interval in seconds")
    parser.add_argument("--t1", type=str, default=None, help="Set T1 to an absolute value")
    parser.add_argument("--t2", type=str, default=None, help="Set T2 to an absolute value")
    parser.add_argument("--add-t1", type=str, default=None, help="Adjust T1 by a delta")
    parser.add_argument("--add-t2", type=str, default=None, help="Adjust T2 by a delta")
    parser.add_argument("--no-clamp", action="store_true", help="Allow values below zero")
    parser.add_argument("--clamp-max", type=int, default=None, help="Clamp adjusted values to this maximum")
    parser.add_argument("--layout-file", type=str, default=None, help="Path to a JSON memory layout file")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        result = run_tool(args)
        if args.watch:
            for item in result:
                print_json(item)
            return 0

        print_json(result)
        return 0 if result.get("ok", False) else 1
    except Exception as exc:
        print_json({"ok": False, "pid": args.pid, "error": str(exc)})
        return 1


def run_tool(args: argparse.Namespace) -> dict[str, Any] | list[dict[str, Any]]:
    mode = resolve_mode(args)
    layout = load_layout(args.layout_file)

    if args.watch:
        if mode != "read":
            raise ToolError("cannot use --watch with write flags")
        return watch_mode(args.pid, args.interval, layout)

    if mode == "read":
        before = read_tickets(args.pid, layout)
        return {
            "ok": True,
            "pid": args.pid,
            "t1": before["t1"],
            "t2": before["t2"],
        }

    backend = MemoryBackend(args.pid, layout)
    before = backend.read()

    if mode == "set":
        next_t1, next_t2 = apply_absolute_set(before, args)
        backend.write(next_t1, next_t2)
        after = backend.read()
        return {
            "ok": True,
            "pid": args.pid,
            "t1": after["t1"],
            "t2": after["t2"],
        }

    if mode == "adjust":
        delta_t1 = parse_optional_int(args.add_t1, "--add-t1")
        delta_t2 = parse_optional_int(args.add_t2, "--add-t2")
        next_t1 = apply_delta(before["t1"], delta_t1, args.no_clamp, args.clamp_max)
        next_t2 = apply_delta(before["t2"], delta_t2, args.no_clamp, args.clamp_max)
        backend.write(next_t1, next_t2)
        after = backend.read()
        return {
            "ok": True,
            "pid": args.pid,
            "mode": "adjust",
            "before": before,
            "delta": {
                "t1": delta_t1 if delta_t1 is not None else 0,
                "t2": delta_t2 if delta_t2 is not None else 0,
            },
            "after": after,
        }

    raise ToolError("unreachable")


def resolve_mode(args: argparse.Namespace) -> str:
    set_t1 = args.t1 is not None
    set_t2 = args.t2 is not None
    add_t1 = args.add_t1 is not None
    add_t2 = args.add_t2 is not None
    has_set = set_t1 or set_t2
    has_add = add_t1 or add_t2

    if args.watch and has_set:
        raise ToolError("cannot use --watch with write flags")

    if has_set and has_add:
        raise ToolError("cannot use --t1/--t2 with --add-t1/--add-t2")

    if has_add:
        if not add_t1 and not add_t2:
            raise ToolError("at least one of --add-t1 or --add-t2 is required")
        return "adjust"

    if has_set:
        return "set"

    return "read"


def apply_absolute_set(before: dict[str, int | None], args: argparse.Namespace) -> tuple[int | None, int | None]:
    next_t1 = before["t1"]
    next_t2 = before["t2"]
    if args.t1 is not None:
        next_t1 = parse_required_int(args.t1, "--t1")
    if args.t2 is not None:
        next_t2 = parse_required_int(args.t2, "--t2")
    if next_t1 is None and next_t2 is None:
        raise ToolError("at least one of --t1 or --t2 is required")
    return next_t1, next_t2


def watch_mode(pid: int, interval: float, layout: dict[str, Any]) -> list[dict[str, Any]]:
    if interval <= 0:
        raise ToolError("--interval must be greater than 0")

    frames: list[dict[str, Any]] = []
    while True:
        sample = read_tickets(pid, layout)
        sample["ok"] = True
        frames.append(sample)
        print_json(sample)
        sys.stdout.flush()
        time.sleep(interval)
    return frames


def read_tickets(pid: int, layout: dict[str, Any]) -> dict[str, Any]:
    backend = MemoryBackend(pid, layout)
    values = backend.read()
    return {
        "ok": True,
        "pid": pid,
        "t1": values["t1"],
        "t2": values["t2"],
    }


def load_layout(layout_file: str | None) -> dict[str, Any]:
    candidate_paths: list[Path] = []
    if layout_file:
        candidate_paths.append(Path(layout_file))
    env_layout_file = os.environ.get("SQUAD_TICKET_LAYOUT_FILE", "").strip()
    if env_layout_file:
        candidate_paths.append(Path(env_layout_file))
    candidate_paths.append(Path(__file__).with_name("squad_ticket_layout.json"))

    raw_json = os.environ.get("SQUAD_TICKET_LAYOUT_JSON", "").strip()
    if raw_json:
        return json.loads(raw_json)

    for candidate in candidate_paths:
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))

    raise ToolError(ERROR_MISSING_LAYOUT)


def parse_required_int(value: Any, field_name: str) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        return int(str(value).strip(), 10)
    except Exception as exc:  # noqa: BLE001
        raise ToolError(f"{field_name} must be an integer") from exc


def parse_optional_int(value: Any, field_name: str) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    return parse_required_int(value, field_name)


def apply_delta(before_value: int | None, delta: int | None, no_clamp: bool, clamp_max: int | None) -> int | None:
    if delta is None:
        return before_value
    base = before_value or 0
    next_value = base + delta
    if not no_clamp:
        next_value = max(0, next_value)
    if clamp_max is not None:
        next_value = min(clamp_max, next_value)
    return next_value


def print_json(payload: Any) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")


class MemoryBackend:
    def __init__(self, pid: int, layout: dict[str, Any]):
        self.pid = pid
        self.layout = layout
        self.handle = self._open_process(pid)
        self.t1 = self._resolve_field(layout.get("t1"))
        self.t2 = self._resolve_field(layout.get("t2"))
        if self.t1.address is None or self.t2.address is None:
            raise ToolError(ERROR_MISSING_LAYOUT)

    def _open_process(self, pid: int):
        access = PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_VM_OPERATION | PROCESS_QUERY_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION
        handle = ctypes.windll.kernel32.OpenProcess(access, False, int(pid))
        if not handle:
            raise ToolError(f"failed to open process {pid}")
        return handle

    def _resolve_field(self, field: Any) -> TicketField:
        if not isinstance(field, dict):
            return TicketField()
        address = field.get("address")
        if address is None:
            return TicketField()
        try:
            return TicketField(address=int(address))
        except Exception as exc:  # noqa: BLE001
            raise ToolError("ticket field address must be an integer") from exc

    def read(self) -> dict[str, int | None]:
        return {
            "t1": self._read_int(self.t1.address),
            "t2": self._read_int(self.t2.address),
        }

    def write(self, t1: int | None, t2: int | None) -> None:
        if t1 is not None:
            self._write_int(self.t1.address, t1)
        if t2 is not None:
            self._write_int(self.t2.address, t2)

    def close(self) -> None:
        if self.handle:
            ctypes.windll.kernel32.CloseHandle(self.handle)
            self.handle = None

    def _read_int(self, address: int | None) -> int | None:
        if address is None:
            return None
        buffer = wintypes.DWORD()
        read = wintypes.SIZE_T()
        ok = ctypes.windll.kernel32.ReadProcessMemory(
            self.handle,
            ctypes.c_void_p(address),
            ctypes.byref(buffer),
            ctypes.sizeof(buffer),
            ctypes.byref(read),
        )
        if not ok:
            raise ToolError(f"failed to read memory at 0x{address:X}")
        return int(buffer.value)

    def _write_int(self, address: int | None, value: int) -> None:
        if address is None:
            raise ToolError(ERROR_MISSING_LAYOUT)
        written = wintypes.SIZE_T()
        data = wintypes.DWORD(int(value))
        ok = ctypes.windll.kernel32.WriteProcessMemory(
            self.handle,
            ctypes.c_void_p(address),
            ctypes.byref(data),
            ctypes.sizeof(data),
            ctypes.byref(written),
        )
        if not ok:
            raise ToolError(f"failed to write memory at 0x{address:X}")


if __name__ == "__main__":
    raise SystemExit(main())
